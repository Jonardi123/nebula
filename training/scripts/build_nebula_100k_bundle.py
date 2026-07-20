#!/usr/bin/env python3
"""Build a validated staged Colab bundle for Nebula Unified 100K."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path


SECRET = re.compile(rb"\bsk-[A-Za-z0-9_-]{16,}\b|BEGIN [A-Z ]*PRIVATE KEY|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bghp_[A-Za-z0-9]{20,}\b")
STAGES = {5_000: 500, 20_000: 2_000, 50_000: 5_000, 90_000: 5_000}


def notebook_document() -> dict[str, object]:
    def code(source: str) -> dict[str, object]:
        return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": [line + "\n" for line in source.strip().splitlines()]}

    def markdown(source: str) -> dict[str, object]:
        return {"cell_type": "markdown", "metadata": {}, "source": [line + "\n" for line in source.strip().splitlines()]}

    return {
        "nbformat": 4,
        "nbformat_minor": 0,
        "metadata": {"colab": {"provenance": [], "gpuType": "T4"}, "kernelspec": {"name": "python3", "display_name": "Python 3"}, "language_info": {"name": "python"}, "accelerator": "GPU"},
        "cells": [
            markdown("""# Nebula Qwen2.5-Coder 7B Unified QLoRA

Use a GPU runtime. Upload one staged `nebula-100k-*-colab-bundle.zip`. Checkpoints are written to Google Drive, and rerunning the training cell resumes from the latest checkpoint. Start with 5K; do not jump directly to 90K."""),
            code("""from google.colab import drive, files
from pathlib import Path
import shutil, zipfile

drive.mount('/content/drive')
uploaded = files.upload()
bundle_name = next((name for name in uploaded if name.endswith('.zip')), None)
if not bundle_name:
    raise RuntimeError('Upload the Nebula 100K Colab bundle zip.')
workspace = Path('/content/nebula-100k')
shutil.rmtree(workspace, ignore_errors=True)
workspace.mkdir(parents=True)
with zipfile.ZipFile(bundle_name) as archive:
    archive.extractall(workspace)
%cd /content/nebula-100k
print('Workspace restored:', workspace)"""),
            code("""!pip uninstall -y -q torchao torchvision || true
!pip install -q -r training/requirements-qlora.txt
import torch, bitsandbytes, transformers, peft
print('PyTorch:', torch.__version__, 'CUDA:', torch.version.cuda)
print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none')
print('bitsandbytes:', bitsandbytes.__version__)
if not torch.cuda.is_available():
    raise RuntimeError('Select a GPU runtime before continuing.')"""),
            code("""from pathlib import Path
import json

stage_files = sorted(Path('training/nebula-100k/stages').glob('train-*.jsonl'))
validation_files = sorted(Path('training/nebula-100k/stages').glob('validation-*.jsonl'))
if len(stage_files) != 1 or len(validation_files) != 1:
    raise RuntimeError(f'Expected one train and validation stage, found {stage_files} and {validation_files}')
train_file, validation_file = stage_files[0], validation_files[0]
train_count = sum(1 for _ in train_file.open(encoding='utf-8'))
validation_count = sum(1 for _ in validation_file.open(encoding='utf-8'))
print('Train:', train_file, train_count)
print('Validation:', validation_file, validation_count)
print(json.loads(Path('training/nebula-100k/manifest.json').read_text())['claim'])"""),
            code("""from pathlib import Path
import subprocess, sys

stage_size = int(train_file.stem.split('-')[-1])
output = Path('/content/drive/MyDrive/NebulaTraining') / f'nebula-qwen2.5-coder-7b-{stage_size}-v1' / 'adapter'
output.mkdir(parents=True, exist_ok=True)
print('Checkpoints:', output)
subprocess.run([
    sys.executable, 'training/scripts/train_qlora.py',
    '--config', 'training/configs/qwen2.5-coder-7b-nebula-100k-qlora.json',
    '--train-file', str(train_file),
    '--validation-file', str(validation_file),
    '--output-dir', str(output),
    '--resume',
], check=True)"""),
            code("""from pathlib import Path
adapter = output
required = ['adapter_config.json', 'adapter_model.safetensors', 'nebula-training-report.json']
missing = [name for name in required if not (adapter / name).exists()]
if missing:
    raise RuntimeError(f'Training did not produce final adapter files: {missing}')
print('Training complete:', adapter)
print((adapter / 'nebula-training-report.json').read_text()[:3000])"""),
            markdown("""## Next gate

Do not merge immediately. First evaluate the adapter against the committed coding, stress, and cyber suites, inspect raw failures, and compare it with the base model. A completed training cell is not proof that the model improved."""),
            code("""from google.colab import files
import shutil
archive = shutil.make_archive(f'/content/nebula-qwen2.5-coder-7b-{stage_size}-adapter', 'zip', adapter)
print('Adapter archive:', archive)
files.download(archive)"""),
        ],
    }


def contains_secret(path: Path) -> bool:
    with path.open("rb") as handle:
        tail = b""
        while chunk := handle.read(1024 * 1024):
            data = tail + chunk
            if SECRET.search(data):
                return True
            tail = data[-128:]
    return False


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", type=int, choices=sorted(STAGES), default=5_000)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--data-dir", type=Path, default=root / "training/nebula-100k-reviewed")
    args = parser.parse_args()
    data = args.data_dir.resolve()
    canonical_data = root / "training/nebula-100k"
    report_path = data / "validation-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.is_file() else {}
    if not report.get("trainingReady"):
        raise SystemExit("Nebula 100K is not training-ready. Complete the diversity/review gate before building a Colab bundle.")

    subprocess.run([
        sys.executable, str(root / "training/scripts/create_nebula_training_stages.py"),
        "--train-file", str(data / "train.jsonl"), "--validation-file", str(data / "validation.jsonl"),
        "--output-dir", str(data / "stages"), "--size", str(args.stage),
    ], check=True)
    validation_size = STAGES[args.stage]
    notebook = root / "training/Nebula_Qwen2_5_Coder_7B_100K_QLoRA_Colab.ipynb"
    notebook.write_text(json.dumps(notebook_document(), indent=2) + "\n", encoding="utf-8")
    files = [
        root / "training/configs/qwen2.5-coder-7b-nebula-100k-qlora.json",
        canonical_data / "manifest.json", data / "validation-report.json",
        data / "stages" / f"train-{args.stage}.jsonl",
        data / "stages" / f"validation-{validation_size}.jsonl",
        root / "training/evals/qwen_coder_behavior.jsonl",
        root / "training/evals/qwen_coder_stress.jsonl",
        root / "training/evals/qwen3_cyber_behavior.jsonl",
        root / "training/scripts/train_qlora.py",
        root / "training/scripts/evaluate_adapter.py",
        root / "training/scripts/merge_adapter.py",
        root / "training/scripts/compare_eval_reports.py",
        root / "training/requirements-qlora.txt",
        canonical_data / "README.md", notebook,
    ]
    for path in files:
        if not path.is_file():
            raise SystemExit(f"Required bundle file is missing: {path}")
        if path.suffix in {".json", ".jsonl", ".md", ".py", ".txt", ".ipynb"} and contains_secret(path):
            raise SystemExit(f"Refusing to bundle a secret-like value in {path}")
    output = args.output or root / f"training/nebula-100k-{args.stage}-colab-bundle.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            archive.write(path, path.relative_to(root).as_posix())
    print(f"Created {output} ({output.stat().st_size / 1024 / 1024:.2f} MiB) for the {args.stage}-row stage.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
