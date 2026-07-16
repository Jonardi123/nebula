#!/usr/bin/env python3
"""Build a secret-checked upload bundle for the Nebula Gemma Colab notebook."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


SECRET = re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b|BEGIN [A-Z ]*PRIVATE KEY|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def add_tree(archive: zipfile.ZipFile, source: Path, root: Path) -> None:
    for path in sorted(source.rglob("*")):
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
            archive.write(path, path.relative_to(root).as_posix())


def main() -> int:
    root = project_root()
    parser = argparse.ArgumentParser()
    parser.add_argument("--exports-dir", type=Path, default=root / "training/exports")
    parser.add_argument("--output", type=Path, default=root / "training/nebula-gemma-colab-bundle.zip")
    args = parser.parse_args()
    exported = sorted(args.exports_dir.glob("*.jsonl")) if args.exports_dir.exists() else []
    legacy_candidates = sorted((root / "training").glob("*.jsonl"))
    candidate_files = list(dict.fromkeys([*exported, *legacy_candidates]))
    for path in candidate_files:
        if SECRET.search(path.read_text(encoding="utf-8")):
            raise SystemExit(f"Refusing to bundle an unredacted secret pattern in {path}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="nebula-training-") as temporary:
        synthetic = Path(temporary) / "synthetic-gemma-v1.jsonl"
        subprocess.run([sys.executable, str(root / "training/scripts/generate_synthetic_dataset.py"), "--output", str(synthetic)], check=True)
        with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for directory in ("configs", "scripts", "evals"):
                add_tree(archive, root / "training" / directory, root)
            for filename in ("requirements-qlora.txt", "README.md"):
                path = root / "training" / filename
                archive.write(path, path.relative_to(root).as_posix())
            archive.write(synthetic, "training/data/synthetic-gemma-v1.jsonl")
            for export in candidate_files:
                archive.write(export, f"training/exports/{export.name}")
    print(f"Created {args.output} with {len(candidate_files)} local candidate trace file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
