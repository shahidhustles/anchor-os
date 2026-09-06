"""Offline JSON-lines interface. One request per stdin line; one result per stdout line."""
import argparse
import json
import os
import sys

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from common import prompt, validate_output


class Router:
    def __init__(self, path):
        self.tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True)
        self.model = AutoModelForCausalLM.from_pretrained(path, local_files_only=True,
            torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
            attn_implementation='sdpa').to('cuda' if torch.cuda.is_available() else 'cpu').eval()

    def generate(self, request):
        inputs = self.tokenizer(prompt(self.tokenizer, request), return_tensors='pt', add_special_tokens=False).to(self.model.device)
        if inputs.input_ids.shape[1] + 96 > self.model.config.max_position_embeddings:
            raise ValueError('Routing request exceeds router context')
        with torch.inference_mode():
            output = self.model.generate(**inputs, max_new_tokens=96, do_sample=False,
                temperature=None, top_p=None, top_k=None,
                pad_token_id=self.tokenizer.eos_token_id)
        return self.tokenizer.decode(output[0,inputs.input_ids.shape[1]:], skip_special_tokens=True).strip()

    def route(self, request):
        return validate_output(self.generate(request), request)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    args = parser.parse_args()
    router = Router(args.model)
    for line in sys.stdin:
        try:
            print(json.dumps(router.route(json.loads(line))), flush=True)
        except (ValueError, KeyError, TypeError, RuntimeError) as error:
            print(json.dumps({'error':str(error)}), file=sys.stderr, flush=True)
            sys.exit(1)
