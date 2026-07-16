#!/usr/bin/env python3
"""Read-only environment report for the Nebula Gemma Colab QLoRA job."""

from __future__ import annotations

import importlib.metadata
import importlib.util
import json
import platform
import sys


REQUIRED = ("torch", "transformers", "datasets", "peft", "bitsandbytes", "accelerate", "huggingface_hub")


def main() -> int:
    packages: dict[str, object] = {}
    for name in REQUIRED:
        if importlib.util.find_spec(name) is None:
            packages[name] = None
        else:
            try:
                packages[name] = importlib.metadata.version(name.replace("_", "-"))
            except importlib.metadata.PackageNotFoundError:
                packages[name] = "installed"
    report: dict[str, object] = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "packages": packages,
        "cudaAvailable": False,
        "ready": False,
    }
    try:
        import torch

        report["torch"] = torch.__version__
        report["cudaAvailable"] = bool(torch.cuda.is_available())
        if torch.cuda.is_available():
            properties = torch.cuda.get_device_properties(0)
            report["gpu"] = properties.name
            report["vramMb"] = round(properties.total_memory / 1024 / 1024)
            report["bf16"] = bool(torch.cuda.is_bf16_supported())
    except Exception as error:  # pragma: no cover - depends on runtime
        report["torchError"] = str(error)
    report["ready"] = all(packages.values()) and bool(report["cudaAvailable"]) and int(report.get("vramMb", 0)) >= 14000
    report["recommendation"] = (
        "Environment is ready for the conservative Gemma 7B QLoRA config."
        if report["ready"]
        else "Use the included Google Colab notebook with a CUDA GPU offering roughly 16 GB VRAM or more. The local AMD Windows machine is the inference target, not the training host."
    )
    print(json.dumps(report, indent=2))
    return 0 if report["ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
