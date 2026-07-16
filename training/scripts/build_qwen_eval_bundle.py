#!/usr/bin/env python3
"""Build the small post-training Qwen evaluation bundle."""

from __future__ import annotations

import argparse
import zipfile
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=root / "training/nebula-qwen-eval-bundle.zip")
    args = parser.parse_args()
    files = [
        root / "training/scripts/evaluate_adapter.py",
        root / "training/configs/nebula-qwen-system-prompt.txt",
        root / "training/evals/qwen_coder_behavior.jsonl",
        root / "training/evals/qwen_coder_stress.jsonl",
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            if not path.is_file():
                raise SystemExit(f"Missing evaluation file: {path}")
            archive.write(path, path.relative_to(root).as_posix())
        combined = "".join(
            path.read_text(encoding="utf-8").rstrip() + "\n"
            for path in (
                root / "training/evals/qwen_coder_behavior.jsonl",
                root / "training/evals/qwen_coder_stress.jsonl",
            )
        )
        archive.writestr("training/evals/qwen_all_89.jsonl", combined)
    print(f"Created {args.output} with {len(files)} files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
