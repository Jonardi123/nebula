#!/usr/bin/env python3
"""Build a secret-checked Qwen3 4B QLoRA upload bundle."""

from __future__ import annotations

import argparse
import re
import zipfile
from pathlib import Path


SECRET = re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b|BEGIN [A-Z ]*PRIVATE KEY|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=root / "training/nebula-qwen3-4b-cyber-colab-bundle.zip")
    args = parser.parse_args()
    files = [
        root / "training/configs/qwen3-4b-nebula-cyber-qlora.json",
        root / "training/evals/qwen_coder_behavior.jsonl",
        root / "training/evals/qwen_coder_stress.jsonl",
        root / "training/evals/qwen3_cyber_behavior.jsonl",
        root / "training/qwen3/data/train.jsonl",
        root / "training/qwen3/data/validation.jsonl",
        root / "training/qwen3/data/audit.json",
        root / "training/qwen3/data/validation-report.json",
        root / "training/scripts/train_qlora.py",
        root / "training/scripts/evaluate_adapter.py",
        root / "training/scripts/merge_adapter.py",
        root / "training/scripts/compare_eval_reports.py",
        root / "training/scripts/validate_dataset.py",
        root / "training/requirements-qlora.txt",
        root / "training/qwen3/README.md",
        root / "training/Nebula_Qwen3_4B_Cyber_QLoRA_Colab.ipynb",
    ]
    for path in files:
        if not path.is_file():
            raise SystemExit(f"Required bundle file is missing: {path}")
        if path.suffix in {".json", ".jsonl", ".md", ".py", ".txt"} and SECRET.search(path.read_text(encoding="utf-8")):
            raise SystemExit(f"Refusing to bundle a secret-like value in {path}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            archive.write(path, path.relative_to(root).as_posix())
    print(f"Created {args.output} with {len(files)} validated files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
