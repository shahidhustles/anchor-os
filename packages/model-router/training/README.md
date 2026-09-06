# Qwen3 router fine-tuning

This workflow trains Qwen3-0.6B with LoRA to read a task and candidate profiles and emit exactly `model_slug` and `confidence`. It is independent of EVE. The existing TypeScript router remains a separate heuristic prototype until the learned model passes evaluation and the app integration is implemented.

## Data and limits

Run commands below from the repository root. `generate_data.py` creates 6,400 training, 800 validation and 800 held-out test examples. Task subfamilies are disjoint between splits. About half use anonymous names. Candidate order, subsets and synthetic profile variations change across examples.

The seven PRD categories retain the requested proportions. There are 42 authored task templates, six per category, with different equipment references. This is an initial synthetic dataset, not 8,000 independently authored work requests. Add independently reviewed prompts before treating held-out results as evidence of broad language generalization.

`training-profiles.json` snapshots the six placeholder profiles in `profiles.ts`. No capability or hardware number claims measured performance. Export a new snapshot and regenerate the data when those profiles change. Labels use explicit author-assigned demands and a documented policy in `common.py`. Demands remain in audit metadata and never enter the model prompt or target.

The teacher removes candidates that lack mandatory tool calling or sufficient context. Among remaining candidates, it prioritizes sufficient capability, then combines capped capability coverage with speed and memory. Confidence is 0.55 plus the top-two score margin, capped at 0.95. It is an uncalibrated policy estimate. Native vision is never a filter, following the approved assumption that agents receive Vision MCP. This package does not implement Vision MCP.

`requires_tools` and `input_tokens` are optional request metadata for enforceable hard checks. The caller must supply them when known. The wrapper cannot guarantee semantic tool/context requirements omitted by a caller. The model also sees the task text, but a model prediction alone is not a hard constraint validator.

## Install and generate

```powershell
python -m venv packages/model-router/.venv
packages/model-router/.venv/Scripts/python -m pip install torch==2.7.1 --index-url https://download.pytorch.org/whl/cu118
packages/model-router/.venv/Scripts/python -m pip install -r packages/model-router/training/requirements.txt
python packages/model-router/training/generate_data.py
python -m unittest discover -s packages/model-router/training -p test_data.py
```

For a Linux GPU machine, use `.venv/bin/python` in place of `.venv/Scripts/python`. CUDA PyTorch installation must match that machine. Initial dependency and base-checkpoint downloads require internet. Training uses generated local data and disables external experiment reporting. Runtime loads only local files with Hugging Face offline mode enabled.

## Train and export

### Google Colab

Open [`colab.ipynb`](colab.ipynb) in a GPU runtime. The notebook clones the `model-router` branch, regenerates the synthetic dataset, accepts a zipped local checkpoint, resumes with the original batch settings, runs the validation gate and downloads the resulting artifacts. Do not upload confidential MRPL data. Colab is a hosted service.

First measure a short run. Its artifact is only a training smoke test.

```powershell
packages/model-router/.venv/Scripts/python packages/model-router/training/train.py --max-steps 3 --limit 32 --accumulation 1 --output packages/model-router/artifacts/smoke
```

Then run the complete training set:

```powershell
packages/model-router/.venv/Scripts/python packages/model-router/training/train.py
```

To run training and the evaluation gates sequentially with progress recorded on disk:

```powershell
packages/model-router/.venv/Scripts/python -u packages/model-router/training/run_pipeline.py --model packages/model-router/artifacts/base-qwen3
```

The local base directory above must already contain the downloaded checkpoint. Omit `--model` to download the pinned base checkpoint through Hugging Face. Progress is in `artifacts/qwen3-router/pipeline-status.json`, with separate stage logs. A failed stage stops the workflow. Validation below 90% policy agreement or below 100% accepted outputs stops before the held-out test. Passing those aggregate gates still requires reviewing the per-family, order and candidate-removal results.

The RTX 2050 smoke runs completed real updates and exported local models. Batch size one used about 1.35 GB of allocated GPU memory. Batch size eight used about 4.03 GB and gave little throughput benefit. Use the default batch size one on this 4 GB card. Short-run throughput suggests roughly 4 to 5 hours for two full epochs, excluding evaluation. This is an estimate, not a completed full-run measurement.

Defaults are rank 8 LoRA on attention projections, learning rate 0.0002, two epochs, batch size one, accumulation 16, fp16 and gradient checkpointing. Loss is computed only on the JSON answer, with next-token alignment. Vocabulary logits are restricted to answer prediction positions to reduce GPU memory. Overlong examples raise an error instead of truncating profiles or targets. The base checkpoint revision is pinned in the script.

The output directory contains resumable checkpoints, `adapter/`, `merged/`, and `training-report.json`. The merged directory includes weights, configuration and tokenizer. Resume an interrupted run with `--resume <checkpoint-directory>` and the same settings. Dataset hashes and the resolved base revision are recorded in the report. Model binaries and generated datasets stay out of Git; the scripts regenerate the data.

## Evaluate before using Auto

```powershell
packages/model-router/.venv/Scripts/python packages/model-router/training/evaluate.py --model packages/model-router/artifacts/qwen3-router/merged --split validation --report packages/model-router/artifacts/validation-report.json
packages/model-router/.venv/Scripts/python packages/model-router/training/evaluate.py --model packages/model-router/artifacts/qwen3-router/merged --report packages/model-router/artifacts/test-report.json
```

Use validation for iteration. Run the held-out test only after choosing the model. `--limit` makes a partial smoke evaluation and is marked as such in the report. Evaluation generates real model responses. It reports exact routing accuracy, wrapper acceptance, raw invalid slugs, raw constraint violations, per-family results, anonymous-name results, reversed-order results, winner-removal results and latency. Invalid outputs count as failures; the evaluator never replaces a failed generation with the teacher's answer.

The PRD target is at least 90% held-out policy agreement. Wrapper rejection ensures accepted routes obey the supplied hard constraints, but rejection is not successful routing. Do not claim 100% successful routing because invalid results were rejected. Template-policy accuracy does not establish the real candidate models' task success rates.

## Local interface

```powershell
packages/model-router/.venv/Scripts/python packages/model-router/training/infer.py --model packages/model-router/artifacts/qwen3-router/merged
```

Send one JSON request per input line, containing `user_task`, `candidate_models`, `profiles` and, when available, `requires_tools` and `input_tokens`. The profile schema matches `training-profiles.json`, but arbitrary unique slugs are accepted. Each successful response contains only the selected slug and confidence. Malformed, unknown-slug or incompatible results fail explicitly on stderr. There is no automatic retry or hidden heuristic fallback. Model-load fallback, session locking, manual selection and UI integration belong to the host and are not implemented by this training workflow.

## Sources

- [Qwen3-0.6B model card and non-thinking chat template](https://huggingface.co/Qwen/Qwen3-0.6B)
- [Transformers 4.51.3 Trainer](https://huggingface.co/docs/transformers/v4.51.3/en/main_classes/trainer)
- [Qwen3 answer-position logits](https://huggingface.co/docs/transformers/v4.51.3/en/model_doc/qwen3)
- [PEFT LoRA configuration](https://huggingface.co/docs/peft/v0.15.0/en/package_reference/lora)
