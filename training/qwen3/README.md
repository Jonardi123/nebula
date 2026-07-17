# Nebula Qwen3 4B Defensive-Security QLoRA

This profile specializes the official `Qwen/Qwen3-4B` Safetensors model for Nebula's coding, exact-tool, and defensive-security roles. The LM Studio GGUF is an inference artifact and is not used as the training base.

## Scope

The reviewed corpus covers secure coding, incident triage, Windows and local-AI hardening, diagnostic uncertainty, authorization boundaries, exact registered tools, Nebula identity, and honest reporting. It refuses credential theft, persistence, evasion, exfiltration, destructive payloads, security disabling, and third-party attacks while preserving help for authorized labs, detection, remediation, and recovery.

The held-out files in `training/evals/` are never included in training. Raw model benchmark outputs remain evidence only; they are not automatically copied into the dataset.

## Prepare And Validate

From the repository root:

```powershell
python training/scripts/generate_qwen3_dataset.py
python training/scripts/validate_dataset.py `
  --train training/qwen3/data/train.jsonl `
  --validation training/qwen3/data/validation.jsonl `
  --minimum-examples 500 `
  --allow-tool run_command `
  --report training/qwen3/data/validation-report.json
python training/scripts/build_qwen3_bundle.py
```

Conceptual seed groups are assigned wholly to train or validation before paraphrase expansion, preventing variants of one lesson from leaking across the split.

## Train

Open `Nebula_Qwen3_4B_Cyber_QLoRA_Colab.ipynb` with a CUDA runtime and upload `nebula-qwen3-4b-cyber-colab-bundle.zip`. The notebook downloads `Qwen/Qwen3-4B`, trains a QLoRA adapter, and stores resumable checkpoints in Google Drive:

```text
MyDrive/NebulaTraining/nebula-qwen3-4b-cyber-v1/adapter/
```

The starting profile uses 4-bit NF4, LoRA rank 16, assistant-only loss, 2048-token context, and one epoch. Do not increase epochs merely to improve the known 89-case score; inspect held-out cyber and generalization results first.

After training, evaluate both the untouched base and adapter with the same fast route used by normal Nebula chat:

```bash
python training/scripts/evaluate_adapter.py \
  --base-model Qwen/Qwen3-4B \
  --cases training/evals/qwen3_cyber_behavior.jsonl \
  --label qwen3-cyber-base \
  --no-think \
  --output /content/drive/MyDrive/NebulaTraining/nebula-qwen3-4b-cyber-v1/base-cyber-eval.json

python training/scripts/evaluate_adapter.py \
  --base-model Qwen/Qwen3-4B \
  --adapter /content/drive/MyDrive/NebulaTraining/nebula-qwen3-4b-cyber-v1/adapter \
  --cases training/evals/qwen3_cyber_behavior.jsonl \
  --label nebula-qwen3-cyber-v1 \
  --no-think \
  --output /content/drive/MyDrive/NebulaTraining/nebula-qwen3-4b-cyber-v1/adapter-cyber-eval.json
```

## Deployment Gate

Do not merge or deploy unless all of these are true:

- overall 89-case behavior improves over the 33/89 Qwen3 baseline;
- exact registered-tool accuracy is at least 80%;
- the held-out cybersecurity suite is at least 80%;
- no major safety, identity, or honesty regression appears in raw outputs;
- unrelated everyday chat remains concise and usable;
- local LM Studio streaming and first-token latency remain acceptable.

Nebula's runtime permission and command-safety layers remain authoritative even after a passing model evaluation.
