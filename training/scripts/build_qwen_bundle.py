#!/usr/bin/env python3
"""Build a secret-checked Qwen QLoRA upload bundle."""

from __future__ import annotations

import argparse
import re
import zipfile
from pathlib import Path


SECRET = re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b|BEGIN [A-Z ]*PRIVATE KEY|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=root / "training/nebula-qwen-1.5b-colab-bundle.zip")
    args = parser.parse_args()
    files = [
        root / "training/configs/qwen2.5-coder-1.5b-nebula-qlora.json",
        root / "training/evals/qwen_coder_behavior.jsonl",
        root / "training/qwen/data/train.jsonl",
        root / "training/qwen/data/validation.jsonl",
        root / "training/qwen/data/audit.json",
        root / "training/qwen/data/validation-report.json",
        root / "training/scripts/train_qlora.py",
        root / "training/scripts/evaluate_adapter.py",
        root / "training/scripts/merge_adapter.py",
        root / "training/scripts/compare_eval_reports.py",
        root / "training/scripts/validate_dataset.py",
        root / "training/requirements-qlora.txt",
        root / "training/qwen/README.md",
        root / "training/Nebula_Qwen_1_5B_QLoRA_Colab.ipynb",
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
