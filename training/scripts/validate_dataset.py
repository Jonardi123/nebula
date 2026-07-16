#!/usr/bin/env python3
"""Static safety and structure checks for Nebula Gemma JSONL datasets."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


SAFE_TOOLS = {"get_current_time", "get_system_info", "list_files", "read_file", "search_memory", "web_fetch", "web_search"}
SECRET = re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b|BEGIN [A-Z ]*PRIVATE KEY|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")
IDENTITY_LEAK = re.compile(r"\b(?:i am|i'm|my (?:underlying )?model is|i run on|as an?)\s+(?:google'?s?\s+|alibaba'?s?\s+|openai'?s?\s+)?(?:gemma|qwen|gpt(?:-?oss)?|llama|mistral|claude)\b", re.I)


def fingerprint(messages: list[dict[str, Any]]) -> str:
    return hashlib.sha256(json.dumps(messages, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def validate(path: Path, safe_tools: set[str] | None = None) -> tuple[set[str], dict[str, Any]]:
    allowed_tools = safe_tools or SAFE_TOOLS
    fingerprints: set[str] = set()
    report: dict[str, Any] = {"file": str(path), "examples": 0, "errors": [], "categories": {}}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        report["examples"] += 1
        try:
            item = json.loads(line)
        except json.JSONDecodeError as error:
            report["errors"].append(f"line {line_number}: invalid JSON: {error}")
            continue
        messages = item.get("messages") if isinstance(item, dict) else None
        if not isinstance(messages, list) or len(messages) < 3:
            report["errors"].append(f"line {line_number}: missing conversation messages")
            continue
        if messages[0].get("role") != "system" or "You are Nebula" not in str(messages[0].get("content", "")):
            report["errors"].append(f"line {line_number}: canonical Nebula system prompt is missing")
        if not any(message.get("role") == "user" for message in messages) or not any(message.get("role") == "assistant" for message in messages):
            report["errors"].append(f"line {line_number}: user or assistant turn is missing")
        pending_tool = False
        for message in messages:
            role = message.get("role")
            content = message.get("content")
            if role not in {"system", "user", "assistant", "tool"} or not isinstance(content, str) or not content.strip():
                report["errors"].append(f"line {line_number}: invalid message")
                continue
            if SECRET.search(content):
                report["errors"].append(f"line {line_number}: unredacted secret pattern")
            if role == "assistant" and IDENTITY_LEAK.search(content):
                report["errors"].append(f"line {line_number}: underlying model identity leak")
            if role == "assistant" and content.lstrip().startswith("{"):
                try:
                    request = json.loads(content)
                    tool = request.get("tool") if isinstance(request, dict) else None
                    args = request.get("args") if isinstance(request, dict) else None
                    if tool not in allowed_tools or not isinstance(args, dict):
                        raise ValueError("invalid or unsafe tool")
                    pending_tool = True
                except (json.JSONDecodeError, ValueError):
                    report["errors"].append(f"line {line_number}: malformed or unsafe tool JSON")
            elif role == "tool":
                if not pending_tool:
                    report["errors"].append(f"line {line_number}: orphan tool result")
                pending_tool = False
        # A final assistant tool request is a valid first-turn example. Nebula's
        # runtime supplies the tool result after the model emits this JSON.
        fp = fingerprint(messages)
        if fp in fingerprints:
            report["errors"].append(f"line {line_number}: duplicate example")
        fingerprints.add(fp)
        metadata = item.get("metadata", {})
        for category in metadata.get("tags", []):
            report["categories"][category] = report["categories"].get(category, 0) + 1
    return fingerprints, report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", required=True, type=Path)
    parser.add_argument("--validation", required=True, type=Path)
    parser.add_argument("--minimum-examples", type=int, default=300)
    parser.add_argument("--report", type=Path)
    parser.add_argument(
        "--allow-tool",
        action="append",
        default=[],
        help="Additional tool allowed for this dataset validation; may be repeated.",
    )
    args = parser.parse_args()
    safe_tools = SAFE_TOOLS | set(args.allow_tool)
    train_fingerprints, train_report = validate(args.train, safe_tools)
    validation_fingerprints, validation_report = validate(args.validation, safe_tools)
    overlap = train_fingerprints & validation_fingerprints
    total = train_report["examples"] + validation_report["examples"]
    report = {
        "total": total,
        "minimum": args.minimum_examples,
        "overlap": len(overlap),
        "train": train_report,
        "validation": validation_report,
        "passed": total >= args.minimum_examples and not overlap and not train_report["errors"] and not validation_report["errors"],
    }
    if total < args.minimum_examples:
        train_report["errors"].append(f"combined dataset has {total} examples; minimum is {args.minimum_examples}")
    if overlap:
        train_report["errors"].append(f"train/validation overlap contains {len(overlap)} examples")
    report["passed"] = not train_report["errors"] and not validation_report["errors"]
    output = json.dumps(report, indent=2)
    print(output)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output, encoding="utf-8")
    return 0 if report["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
