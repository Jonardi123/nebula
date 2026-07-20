#!/usr/bin/env python3
"""Streaming structural, safety, split, and sampling audit for Nebula 100K."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from generate_nebula_100k import ALLOWED_TOOLS, CATEGORY_TOTALS, SPLIT_RATIOS, SYSTEM


SECRET = re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b|BEGIN [A-Z ]*PRIVATE KEY|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bghp_[A-Za-z0-9]{20,}\b")
IDENTITY_LEAK = re.compile(r"\b(?:i am|i'm|developed by|made by)\s+(?:qwen|gemma|gpt|llama|mistral|alibaba|google|openai)\b", re.I)
PROHIBITED_OUTPUT = re.compile(r"\b(?:dump credentials|disable (?:defender|antivirus)|erase forensic logs|hide persistence|exfiltrate private|deploy ransomware)\b", re.I)
VALID_ROLES = {"system", "user", "assistant", "tool"}


def normalized(value: str) -> str:
    return " ".join(value.casefold().split())


def validate_tool(content: str) -> str | None:
    if not content.lstrip().startswith("{"):
        return None
    try:
        value = json.loads(content)
    except json.JSONDecodeError:
        return "malformed assistant JSON"
    if set(value) != {"tool", "args"} or value.get("tool") not in ALLOWED_TOOLS or not isinstance(value.get("args"), dict):
        return "unknown or malformed tool request"
    return None


def inspect_file(path: Path, expected_split: str, sample_per_category: int) -> tuple[dict[str, Any], set[str], set[str], set[str], list[dict[str, Any]]]:
    errors: list[str] = []
    categories: Counter[str] = Counter()
    fingerprints: set[str] = set()
    prompts: set[str] = set()
    families: set[str] = set()
    sample_candidates: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    assistant_answers: dict[str, Counter[str]] = {}
    system_hash = hashlib.sha256(SYSTEM.encode()).hexdigest()

    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            try:
                item = json.loads(line)
            except json.JSONDecodeError as error:
                errors.append(f"line {line_number}: invalid JSON: {error}")
                continue
            messages = item.get("messages") if isinstance(item, dict) else None
            metadata = item.get("metadata") if isinstance(item, dict) else None
            if not isinstance(messages, list) or len(messages) < 3 or not isinstance(metadata, dict):
                errors.append(f"line {line_number}: invalid envelope")
                continue
            category = metadata.get("category")
            split = metadata.get("split")
            family = metadata.get("familyId")
            if category not in CATEGORY_TOTALS or split != expected_split or not isinstance(family, str):
                errors.append(f"line {line_number}: invalid category, split, or family")
                continue
            categories[category] += 1
            assistant_answers.setdefault(category, Counter())
            families.add(family)
            if messages[0] != {"role": "system", "content": SYSTEM}:
                errors.append(f"line {line_number}: canonical system prompt mismatch")
            if hashlib.sha256(str(messages[0].get("content", "")).encode()).hexdigest() != system_hash:
                errors.append(f"line {line_number}: system hash mismatch")

            user_messages: list[str] = []
            assistant_messages: list[str] = []
            pending_tool = False
            for message in messages:
                role, content = message.get("role"), message.get("content")
                if role not in VALID_ROLES or not isinstance(content, str) or not content.strip():
                    errors.append(f"line {line_number}: invalid message")
                    continue
                if SECRET.search(content):
                    errors.append(f"line {line_number}: secret-like value")
                if role == "user":
                    user_messages.append(content)
                elif role == "assistant":
                    assistant_messages.append(content)
                    problem = validate_tool(content)
                    if problem:
                        errors.append(f"line {line_number}: {problem}")
                    pending_tool = content.lstrip().startswith("{") and not problem
                    if IDENTITY_LEAK.search(content):
                        errors.append(f"line {line_number}: underlying identity leak")
                    if PROHIBITED_OUTPUT.search(content) and "can't help" not in content.casefold():
                        errors.append(f"line {line_number}: prohibited operational output")
                elif role == "tool":
                    if not pending_tool:
                        errors.append(f"line {line_number}: orphan tool result")
                    pending_tool = False
            if not user_messages or not assistant_messages:
                errors.append(f"line {line_number}: missing user or assistant turn")
                continue
            prompt = normalized(user_messages[-1])
            fp = hashlib.sha256(json.dumps(messages, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            if prompt in prompts:
                errors.append(f"line {line_number}: duplicate user prompt in split")
            if fp in fingerprints:
                errors.append(f"line {line_number}: duplicate conversation in split")
            prompts.add(prompt)
            fingerprints.add(fp)
            joined_answer = "\n".join(assistant_messages)
            assistant_answers[category][normalized(joined_answer)] += 1
            sample = {"split": expected_split, "line": line_number, "category": category, "messages": messages, "metadata": metadata}
            score = hashlib.sha256(f"{expected_split}:{category}:{fp}".encode()).hexdigest()
            bucket = sample_candidates.setdefault(category, [])
            bucket.append((score, sample))
            bucket.sort(key=lambda pair: pair[0])
            del bucket[sample_per_category:]

    diversity = {
        category: {
            "uniqueAnswers": len(values),
            "total": sum(values.values()),
            "uniqueRatio": len(values) / sum(values.values()),
            "largestDuplicateCount": max(values.values()),
        }
        for category, values in assistant_answers.items()
    }
    samples = [sample for category in sorted(sample_candidates) for _, sample in sample_candidates[category]]
    report = {"file": str(path), "total": sum(categories.values()), "categories": dict(categories), "families": len(families), "answerDiversity": diversity, "errors": errors[:200], "errorCount": len(errors)}
    return report, fingerprints, prompts, families, samples


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("training/nebula-100k"))
    parser.add_argument("--report", type=Path)
    parser.add_argument("--sample-per-category", type=int, default=8)
    parser.add_argument("--heldout", action="append", default=[], type=Path)
    args = parser.parse_args()

    split_reports: dict[str, Any] = {}
    split_fingerprints: dict[str, set[str]] = {}
    split_prompts: dict[str, set[str]] = {}
    split_families: dict[str, set[str]] = {}
    samples: list[dict[str, Any]] = []
    errors: list[str] = []
    for split in SPLIT_RATIOS:
        path = args.data_dir / f"{split}.jsonl"
        if not path.is_file():
            raise SystemExit(f"Missing corpus split: {path}")
        report, fingerprints, prompts, families, selected = inspect_file(path, split, args.sample_per_category)
        split_reports[split] = report
        split_fingerprints[split] = fingerprints
        split_prompts[split] = prompts
        split_families[split] = families
        samples.extend(selected)
        errors.extend(f"{split}: {message}" for message in report["errors"])
        for category, total in CATEGORY_TOTALS.items():
            expected = total * SPLIT_RATIOS[split] // 100
            actual = report["categories"].get(category, 0)
            if actual != expected:
                errors.append(f"{split}/{category}: expected {expected}, found {actual}")

    diversity_minimums = {
        "reverse_engineering": 0.10, "tool_agent_workflows": 0.0005, "coding_debugging": 0.10,
        "defensive_cybersecurity": 0.10, "failure_honesty": 0.001, "review_architecture": 0.10,
        "general_chat": 0.05, "memory_context": 0.005, "web_research": 0.003,
        "identity_voice_mobile": 0.002, "planning_routing": 0.05,
    }
    quality_errors: list[str] = []
    for category, minimum in diversity_minimums.items():
        metric = split_reports["train"]["answerDiversity"][category]
        if metric["uniqueRatio"] < minimum:
            quality_errors.append(
                f"train/{category}: answer diversity {metric['uniqueRatio']:.3%} is below {minimum:.1%} "
                f"({metric['uniqueAnswers']} unique across {metric['total']} rows)"
            )

    pairs = (("train", "validation"), ("train", "hidden"), ("validation", "hidden"))
    overlap = {f"{a}:{b}": {"messages": len(split_fingerprints[a] & split_fingerprints[b]), "prompts": len(split_prompts[a] & split_prompts[b]), "families": len(split_families[a] & split_families[b])} for a, b in pairs}
    for pair, values in overlap.items():
        if any(values.values()):
            errors.append(f"split overlap in {pair}: {values}")

    heldout_prompts: set[str] = set()
    for path in args.heldout:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                item = json.loads(line)
                if isinstance(item.get("prompt"), str):
                    heldout_prompts.add(normalized(item["prompt"]))
    corpus_prompts = set().union(*split_prompts.values())
    heldout_overlap = sorted(corpus_prompts & heldout_prompts)
    if heldout_overlap:
        errors.append(f"exact benchmark prompt leakage: {len(heldout_overlap)}")

    result = {
        "passed": not errors,
        "trainingReady": not errors and not quality_errors,
        "total": sum(report["total"] for report in split_reports.values()),
        "splits": split_reports,
        "overlap": overlap,
        "heldoutFiles": [str(path) for path in args.heldout],
        "heldoutExactPromptOverlap": len(heldout_overlap),
        "sampleReviewRows": len(samples),
        "errors": errors[:300],
        "errorCount": len(errors),
        "qualityErrors": quality_errors,
        "qualityErrorCount": len(quality_errors),
    }
    report_path = args.report or args.data_dir / "validation-report.json"
    report_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    (args.data_dir / "sample-review.jsonl").write_text("\n".join(json.dumps(item, ensure_ascii=False) for item in samples) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if result["trainingReady"] else (3 if result["passed"] else 2)


if __name__ == "__main__":
    raise SystemExit(main())
