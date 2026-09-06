"""Completion-only LoRA training, resumable checkpoints and merged local export."""
import argparse
import hashlib
import json
import os
import time
from pathlib import Path

os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
os.environ.setdefault('WANDB_DISABLED', 'true')
import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments, set_seed
from common import prompt

ROOT = Path(__file__).resolve().parents[1]


def encode(tokenizer, path, max_length, limit=0):
    rows = []
    for line in path.read_text(encoding='utf-8').splitlines()[:limit or None]:
        row = json.loads(line)
        prefix = tokenizer.encode(prompt(tokenizer, row['input']), add_special_tokens=False)
        answer = tokenizer.encode(json.dumps(row['output'], separators=(',', ':')) + tokenizer.eos_token,
                                  add_special_tokens=False)
        if len(prefix) + len(answer) > max_length:
            raise ValueError(f'Example needs {len(prefix)+len(answer)} tokens; increase --max-length. Never truncate profiles or targets.')
        rows.append({'input_ids': prefix + answer, 'attention_mask': [1] * (len(prefix)+len(answer)),
                     'labels': [-100] * len(prefix) + answer})
    return rows


class Collator:
    def __init__(self, pad_id):
        self.pad_id = pad_id

    def __call__(self, rows):
        length = max(len(r['input_ids']) for r in rows)
        return {key: torch.tensor([r[key] + [padding] * (length-len(r[key])) for r in rows])
                for key, padding in [('input_ids', self.pad_id), ('attention_mask', 0), ('labels', -100)]}


class CompletionTrainer(Trainer):
    def compute_loss(self, model, inputs, return_outputs=False, num_items_in_batch=None):
        labels = inputs.pop('labels')
        # Only compute vocabulary logits at positions that predict answer tokens.
        # This preserves completion-only loss while avoiding full-prompt logits on 4 GB GPUs.
        positions = (labels[:, 1:] != -100).any(dim=0).nonzero().flatten()
        outputs = model(**inputs, logits_to_keep=positions)
        targets = labels[:, 1:][:, positions]
        loss = torch.nn.functional.cross_entropy(outputs.logits.float().reshape(-1, outputs.logits.shape[-1]),
                                                 targets.reshape(-1))
        return (loss, outputs) if return_outputs else loss


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default='Qwen/Qwen3-0.6B')
    parser.add_argument('--revision', default='c1899de289a04d12100db370d81485cdf75e47ca')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts' / 'qwen3-router')
    parser.add_argument('--max-length', type=int, default=4096)
    parser.add_argument('--epochs', type=float, default=2)
    parser.add_argument('--max-steps', type=int, default=-1)
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--accumulation', type=int, default=16)
    parser.add_argument('--batch-size', type=int, default=1)
    parser.add_argument('--resume', default=None)
    args = parser.parse_args()
    set_seed(26117)
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA GPU unavailable. Install the documented CUDA PyTorch build or use a GPU training machine.')
    tokenizer = AutoTokenizer.from_pretrained(args.model, revision=args.revision)
    tokenizer.pad_token = tokenizer.eos_token
    train_rows = encode(tokenizer, ROOT/'data/train.jsonl', args.max_length, args.limit)
    validation_rows = encode(tokenizer, ROOT/'data/validation.jsonl', args.max_length, 16 if args.limit else 0)
    # RTX 2050 supports fp16. Avoid training frozen weights in fp32 on a 4 GB GPU.
    model = AutoModelForCausalLM.from_pretrained(args.model, revision=args.revision,
        torch_dtype=torch.float16, attn_implementation='sdpa')
    model.config.use_cache = False
    revision = getattr(model.config, '_commit_hash', None)
    local_revision = Path(args.model) / 'source-revision.txt'
    if revision is None and local_revision.is_file():
        revision = local_revision.read_text().strip()
    model = get_peft_model(model, LoraConfig(r=8, lora_alpha=16, lora_dropout=.05,
        target_modules=['q_proj','k_proj','v_proj','o_proj'], task_type='CAUSAL_LM'))
    model.print_trainable_parameters()
    training = TrainingArguments(output_dir=str(args.output), per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=1, gradient_accumulation_steps=args.accumulation,
        num_train_epochs=args.epochs, max_steps=args.max_steps, learning_rate=2e-4,
        warmup_ratio=.03, lr_scheduler_type='cosine', fp16=True,
        gradient_checkpointing=True, gradient_checkpointing_kwargs={'use_reentrant': False},
        logging_steps=1 if args.max_steps > 0 else 10, save_steps=50, save_total_limit=2,
        eval_strategy='no' if args.max_steps > 0 else 'epoch', report_to=[],
        dataloader_pin_memory=False, seed=26117, optim='adamw_torch', label_names=['labels'])
    trainer = CompletionTrainer(model=model, args=training, train_dataset=train_rows,
        eval_dataset=validation_rows, data_collator=Collator(tokenizer.pad_token_id))
    trainer.model_accepts_loss_kwargs = False
    started = time.time()
    result = trainer.train(resume_from_checkpoint=args.resume)
    adapter_norm = sum(p.detach().float().norm().item() for name,p in model.named_parameters() if 'lora_B' in name)
    if not torch.isfinite(torch.tensor(adapter_norm)) or adapter_norm == 0:
        raise RuntimeError('Adapter has no finite learned update; refusing to export a trained model')
    trainer.save_model(str(args.output / 'adapter'))
    tokenizer.save_pretrained(args.output / 'adapter')
    model = model.cpu()
    torch.cuda.empty_cache()
    merged = model.merge_and_unload()
    merged.config.use_cache = True
    merged.save_pretrained(args.output / 'merged', safe_serialization=True)
    tokenizer.save_pretrained(args.output / 'merged')
    report = {'base_model':args.model, 'resolved_revision':revision, 'training_seconds':time.time()-started,
        'train_examples':len(train_rows), 'validation_examples':len(validation_rows),
        'max_sequence_tokens':max(len(r['input_ids']) for r in train_rows),
        'smoke_only':args.max_steps > 0 or args.limit > 0, 'metrics':result.metrics,
        'gpu':torch.cuda.get_device_name(0), 'peak_gpu_bytes':torch.cuda.max_memory_allocated(),
        'adapter_b_norm_sum':adapter_norm,
        'dataset_sha256':hashlib.sha256((ROOT/'data/train.jsonl').read_bytes()).hexdigest(),
        'torch':torch.__version__, 'arguments':{k:str(v) if isinstance(v,Path) else v for k,v in vars(args).items()}}
    (args.output/'training-report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
