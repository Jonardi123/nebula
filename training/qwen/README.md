# Nebula Qwen2.5-Coder 1.5B QLoRA

This profile specializes `Qwen/Qwen2.5-Coder-1.5B-Instruct` for Nebula's coding role. The original Q8 GGUF remains the local baseline; training uses the original public Hugging Face safetensors model.

The held-out behavior suite is never included in training. Raw benchmark failures are evidence, not target answers. The generated corpus contains separately written, reviewed examples for Nebula identity, exact registered tools, read-before-edit, strict TypeScript, honest tool-result reporting, scoped edits, review findings, routing, and blocked destructive actions.

## Training

On a CUDA environment, install `training/requirements-qlora.txt`, extract the Qwen bundle, then run:

```bash
python training/scripts/train_qlora.py \
  --config training/configs/qwen2.5-coder-1.5b-nebula-qlora.json \
  --output-dir /content/drive/MyDrive/NebulaTraining/nebula-qwen-1.5b-v1/adapter \
  --resume
```

Use `--resume` only when the output directory already contains a compatible checkpoint. Keep checkpoints on mounted Drive so runtime limits do not erase progress.

After training, rerun the 25-case LM Studio baseline and adapter evaluation. Do not merge or deploy unless tool JSON, safety, coding correctness, and overall pass rate improve without identity regression. The application must continue enforcing tool safety independently of model behavior.
