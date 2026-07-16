#!/usr/bin/env python3
"""Merge a validated Nebula LoRA adapter into its base model."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", default="google/gemma-7b-it")
    parser.add_argument("--adapter", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    args = parser.parse_args()

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    device = "cuda" if args.device == "auto" and torch.cuda.is_available() else args.device
    if device == "auto":
        device = "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        raise SystemExit("CUDA merge requested, but CUDA is not available.")
    load_dtype = torch.float16 if device == "cuda" else torch.float32
    token = os.environ.get("HF_TOKEN") or None
    args.output.mkdir(parents=True, exist_ok=True)
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, token=token)
    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        torch_dtype=load_dtype,
        device_map="auto" if device == "cuda" else {"": "cpu"},
        low_cpu_mem_usage=True,
        token=token,
    )
    model = PeftModel.from_pretrained(model, str(args.adapter))
    merged = model.merge_and_unload(safe_merge=True, progressbar=True)
    if device == "cpu":
        merged = merged.to(dtype=torch.float16)
    merged.save_pretrained(args.output, safe_serialization=True, max_shard_size="4GB")
    tokenizer.save_pretrained(args.output)
    (args.output / "nebula-merge-report.json").write_text(
        json.dumps({"baseModel": args.base_model, "adapter": str(args.adapter), "output": str(args.output), "dtype": "float16", "mergeDevice": device}, indent=2),
        encoding="utf-8",
    )
    print(f"Merged model saved to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
