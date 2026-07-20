#!/usr/bin/env python3
"""Create deterministic, category-stratified pilot files from Nebula 100K."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from generate_nebula_100k import CATEGORY_TOTALS


DEFAULT_STAGES = (5_000, 20_000, 50_000)
TRAIN_TOTAL = 90_000
VALIDATION_TOTAL = 5_000


def quotas(size: int) -> dict[str, int]:
    raw = {category: size * total / 100_000 for category, total in CATEGORY_TOTALS.items()}
    result = {category: int(value) for category, value in raw.items()}
    remaining = size - sum(result.values())
    order = sorted(raw, key=lambda category: (raw[category] - result[category], CATEGORY_TOTALS[category]), reverse=True)
    for category in order[:remaining]:
        result[category] += 1
    return result


def select_stratified(source: Path, destination: Path, size: int, available: dict[str, int]) -> Counter[str]:
    targets = quotas(size)
    selected: list[str] = []
    counts: Counter[str] = Counter()
    seen: Counter[str] = Counter()
    with source.open("r", encoding="utf-8") as handle:
        for line in handle:
            item = json.loads(line)
            category = item["metadata"]["category"]
            previous = seen[category] * targets[category] // available[category]
            current = (seen[category] + 1) * targets[category] // available[category]
            if current > previous:
                selected.append(line.rstrip("\n"))
                counts[category] += 1
            seen[category] += 1
    if sum(counts.values()) != size:
        raise RuntimeError(f"could not fill {destination.name}: {dict(counts)}")
    destination.write_text("\n".join(selected) + "\n", encoding="utf-8")
    return counts


def create_stages(train_file: Path, validation_file: Path, output_dir: Path, sizes: tuple[int, ...]) -> dict[str, object]:
    requested = sorted(set(sizes))
    if not requested or requested[0] <= 0 or requested[-1] > TRAIN_TOTAL:
        raise ValueError(f"stage sizes must be between 1 and {TRAIN_TOTAL}")
    output_dir.mkdir(parents=True, exist_ok=True)
    train_available = {category: total * 9 // 10 for category, total in CATEGORY_TOTALS.items()}
    validation_available = {category: total // 20 for category, total in CATEGORY_TOTALS.items()}
    report: dict[str, object] = {"trainSource": str(train_file), "validationSource": str(validation_file), "stages": {}}
    for size in requested:
        train_path = output_dir / f"train-{size}.jsonl"
        validation_size = min(VALIDATION_TOTAL, max(500, size // 10))
        validation_path = output_dir / f"validation-{validation_size}.jsonl"
        train_counts = select_stratified(train_file, train_path, size, train_available)
        if not validation_path.exists():
            validation_counts = select_stratified(validation_file, validation_path, validation_size, validation_available)
        else:
            validation_counts = Counter(quotas(validation_size))
        report["stages"][str(size)] = {
            "trainFile": str(train_path), "trainTotal": size, "trainCategories": dict(train_counts),
            "validationFile": str(validation_path), "validationTotal": validation_size, "validationCategories": dict(validation_counts),
        }
    (output_dir / "stages.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train-file", type=Path, default=Path("training/nebula-100k/train.jsonl"))
    parser.add_argument("--validation-file", type=Path, default=Path("training/nebula-100k/validation.jsonl"))
    parser.add_argument("--output-dir", type=Path, default=Path("training/nebula-100k/stages"))
    parser.add_argument("--size", action="append", type=int)
    args = parser.parse_args()
    report = create_stages(args.train_file, args.validation_file, args.output_dir, tuple(args.size or DEFAULT_STAGES))
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
