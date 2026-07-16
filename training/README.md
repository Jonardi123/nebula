# Nebula Gemma 7B Fine-Tuning

This directory contains a real, reproducible QLoRA workflow for specializing **Gemma 7B Instruct** as Nebula's daily chat model. Qwen remains the coding model and the existing larger model remains the reviewer.

The installed LM Studio GGUF is an inference artifact and cannot be used as the training base. Training downloads the original gated `google/gemma-7b-it` Hugging Face/Safetensors weights in Google Colab, produces a LoRA adapter, evaluates it, merges it, and converts the passing result to GGUF.

## What Gemma Learns

- Always present the assistant identity as **Nebula**.
- Fast, concise daily chat and voice-friendly replies.
- Honest use of confirmed tool results.
- Exact JSON for safe lightweight tools: memory search, time, system information, read-only files, and web research.
- Internal handoff behavior for coding, writes, terminal work, security review, and architecture work.
- Refusal of destructive/security-sensitive requests.

Changing web facts are not trained into the weights. Gemma learns to use web tools and cite checked sources, while the facts remain in Nebula's retrieval/memory systems where they can be refreshed.

## Data Safety And Quality

Nebula's app exporter and the Python preparation script both audit the data. Every local log is inspected, but only examples passing all gates enter training.

The pipeline:

- redacts user-home paths, private addresses, emails, signed URL parameters, and common credential formats;
- rejects traces that contained credential-like values rather than trusting redaction alone;
- rejects LM Studio errors, placeholders, malformed tool JSON, unsafe tools, and base-model identity leakage;
- excludes Qwen/coding and review-model traces from Gemma's daily-chat dataset;
- replaces old system prompts with one canonical Nebula identity contract;
- deduplicates before a deterministic 85/15 train/validation split;
- validates that no examples overlap between splits.

Rejected examples are represented in `rejected.jsonl` by source file, line, and reason only. Their raw text is not copied into the rejection report.

## Local Preparation

1. In Nebula, open **Training Logs** and export the audit JSONL.
2. Put exported `.jsonl` files in `training/exports/`.
3. Build the upload bundle from the project root:

```powershell
python training/scripts/build_colab_bundle.py
```

The bundle includes 336 deterministic, reviewed-template seed examples plus all local exports. It refuses to package files matching common raw secret patterns.

You can run the data pipeline locally without any ML packages:

```powershell
python training/scripts/generate_synthetic_dataset.py
python training/scripts/prepare_dataset.py `
  --input training/data/synthetic-gemma-v1.jsonl `
  --input training/exports `
  --output-dir training/data `
  --validation-percent 15
python training/scripts/validate_dataset.py `
  --train training/data/train.jsonl `
  --validation training/data/validation.jsonl `
  --minimum-examples 300
```

## Google Colab Training

1. Open `Nebula_Gemma_7B_QLoRA_Colab.ipynb` in Google Colab.
2. Accept the `google/gemma-7b-it` model license on Hugging Face.
3. Add `HF_TOKEN` to Colab Secrets. Never paste it into notebook source or training data.
4. Select a CUDA GPU runtime with about 16 GB VRAM or more.
5. Run the notebook and upload `nebula-gemma-colab-bundle.zip` when prompted.

The notebook mounts Google Drive and writes resumable checkpoints to:

```text
MyDrive/NebulaTraining/nebula-gemma-7b-v1/
```

The conservative starting configuration uses:

- 4-bit NF4 with double quantization;
- BF16 when supported, otherwise FP16;
- LoRA rank 16, alpha 32, dropout 0.05;
- `target_modules="all-linear"`;
- batch size 1 and gradient accumulation 8;
- 1024-token context;
- two epochs with cosine scheduling;
- explicit assistant-only token labels.

The assistant-only masking is intentional: user text, tool results, and the injected system contract receive label `-100`, so loss is calculated only on Nebula assistant turns.

## Evaluation Gate

The fixed suite in `evals/gemma_behavior.jsonl` compares the base model and adapter on identity, concise chat, exact tool JSON, safe handoff, honesty, and blocked actions.

Deployment is blocked unless:

- Nebula identity consistency is at least 95%;
- tool accuracy is at least 80%;
- tool accuracy regresses by no more than two percentage points versus base Gemma;
- handoff accuracy is at least 80%;
- overall accuracy is not worse than the base model.

These thresholds are a first release gate, not proof that the model is universally safe or correct. Read the per-prompt outputs before deployment.

## LM Studio Deployment

Only after the evaluation gate passes, the notebook merges the adapter and creates:

- `nebula-gemma-7b-v1-Q4_K_M.gguf` for the default faster local build;
- `nebula-gemma-7b-v1-Q5_K_M.gguf` as an optional higher-quality build.

Import Q4 into LM Studio first. Keep the original Gemma installed for rollback, run Nebula Bench, and assign the new model to **Daily** only after local chat, identity, tool JSON, and latency smoke tests pass. Model identifiers remain visible in local Settings/Diagnostics, while every user-facing assistant answer remains Nebula.

## References

- [Google Gemma LoRA tuning guide](https://ai.google.dev/gemma/docs/core/lora_tuning)
- [Hugging Face PEFT quantization guide](https://huggingface.co/docs/peft/developer_guides/quantization)
- [Hugging Face PEFT LoRA reference](https://huggingface.co/docs/peft/package_reference/lora)
- [Hugging Face TRL SFTTrainer assistant-only loss documentation](https://huggingface.co/docs/trl/sft_trainer)
- [llama.cpp model conversion and quantization](https://github.com/ggml-org/llama.cpp)

Do not call this adapter fine-tuned until the Colab training, evaluation gate, merge, GGUF conversion, and local LM Studio smoke test have actually completed.
