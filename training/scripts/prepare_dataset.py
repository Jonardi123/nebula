#!/usr/bin/env python3
"""Audit, redact, deduplicate, and split Nebula traces for Gemma QLoRA."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


SAFE_TOOLS = {
    "get_current_time",
    "get_system_info",
    "list_files",
    "read_file",
    "search_memory",
    "web_fetch",
    "web_search",
}
VALID_ROLES = {"system", "user", "assistant", "tool"}
IDENTITY_LEAK = re.compile(
    r"\b(?:i am|i'm|my (?:underlying )?model is|i run on|as an?)\s+"
    r"(?:google'?s?\s+|alibaba'?s?\s+|openai'?s?\s+)?"
    r"(?:gemma|qwen|gpt(?:-?oss)?|llama|mistral|claude)\b",
    re.I,
)
PLACEHOLDER_ANSWER = re.compile(r"^\s*(?:\.{3}|loading|thinking)\s*$", re.I)
ERROR_ANSWER = re.compile(r"LM Studio (?:error|request failed)|Failed to fetch|Model is unloaded", re.I)

REDACTION_RULES: tuple[tuple[re.Pattern[str], str, bool], ...] = (
    (re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"), "[REDACTED]", True),
    (re.compile(r"\b(?:ghp|github_pat|xox[baprs]|rk_live|pk_live)_[A-Za-z0-9_-]{8,}\b", re.I), "[REDACTED]", True),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"), "[REDACTED]", True),
    (re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"), "[REDACTED]", True),
    (re.compile(r"\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd)\s*[:=]\s*[^\s,;\"']+", re.I), "[REDACTED]", True),
    (re.compile(r"\b[A-Za-z]:\\Users\\[^\\\s]+", re.I), "[USER_HOME]", False),
    (re.compile(r"\\\\[^\\\s]+\\[^\s]+"), "[NETWORK_PATH]", False),
    (re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I), "[EMAIL]", False),
    (re.compile(r"\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b"), "[PRIVATE_IP]", False),
    (re.compile(r"([?&](?:key|token|secret|signature|sig|auth)=)[^&#\s]+", re.I), r"\1[REDACTED]", True),
)


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def identity_prompt() -> str:
    return (project_root() / "training/configs/nebula-gemma-system-prompt.txt").read_text(encoding="utf-8").strip()


def sanitize(value: str) -> tuple[str, bool, bool]:
    changed = False
    blocked = False
    for pattern, replacement, high_risk in REDACTION_RULES:
        value, count = pattern.subn(replacement, value)
        if count:
            changed = True
            blocked = blocked or high_risk
    return value.strip(), changed, blocked


def parse_tool_call(content: str) -> tuple[str, dict[str, Any]] | None:
    try:
        value = json.loads(content)
    except json.JSONDecodeError:
        return None
    if not isinstance(value, dict) or not isinstance(value.get("tool"), str) or not isinstance(value.get("args"), dict):
        return None
    return value["tool"], value["args"]


def source_role(metadata: dict[str, Any]) -> str:
    explicit = str(metadata.get("sourceModelRole", "")).lower()
    if explicit in {"daily", "code", "review"}:
        return explicit
    legacy = f"{metadata.get('model', '')} {metadata.get('route', '')}".lower()
    if re.search(r"review|gpt-?oss|critic", legacy):
        return "review"
    if re.search(r"qwen|coder|coding|code_review", legacy):
        return "code"
    return "daily" if re.search(r"gemma|daily|fast|nebula", legacy) else "unknown"


def audit_example(item: object) -> tuple[dict[str, Any] | None, list[str], dict[str, int]]:
    flags = {"redacted": 0, "sensitive": 0, "identity_leak": 0, "malformed_tool": 0, "unsafe_tool": 0, "route_mismatch": 0}
    reasons: list[str] = []
    if not isinstance(item, dict) or not isinstance(item.get("messages"), list):
        return None, ["invalid example envelope"], flags

    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    role = source_role(metadata)
    if role in {"code", "review"} and not metadata.get("gemmaApproved"):
        flags["route_mismatch"] = 1
        reasons.append("specialist trace is outside Gemma's daily role")
    if metadata.get("eligible") is False:
        reasons.append("app-side quality gate rejected trace")

    cleaned: list[dict[str, str]] = []
    user_seen = False
    assistant_seen = False
    assistant_tool_pending = False
    for raw_message in item["messages"]:
        if not isinstance(raw_message, dict):
            reasons.append("message is not an object")
            continue
        message_role = raw_message.get("role")
        content = raw_message.get("content")
        if message_role not in VALID_ROLES or not isinstance(content, str) or not content.strip():
            reasons.append("message has an invalid role or empty content")
            continue
        content, changed, blocked = sanitize(content)
        flags["redacted"] |= int(changed)
        flags["sensitive"] |= int(blocked)
        if blocked:
            reasons.append("credential-like content was present")

        if message_role == "assistant":
            assistant_seen = True
            if IDENTITY_LEAK.search(content):
                flags["identity_leak"] = 1
                reasons.append("assistant leaked an underlying model identity")
            if PLACEHOLDER_ANSWER.fullmatch(content) or ERROR_ANSWER.search(content):
                reasons.append("assistant answer is a placeholder or infrastructure error")
            if content.lstrip().startswith("{"):
                parsed = parse_tool_call(content)
                if parsed is None:
                    flags["malformed_tool"] = 1
                    reasons.append("assistant emitted malformed tool JSON")
                else:
                    tool_name, _ = parsed
                    assistant_tool_pending = True
                    if tool_name not in SAFE_TOOLS:
                        flags["unsafe_tool"] = 1
                        reasons.append(f"tool {tool_name} is outside Gemma's safe scope")
        elif message_role == "tool":
            if not assistant_tool_pending:
                reasons.append("tool result has no preceding tool request")
            assistant_tool_pending = False
        elif message_role == "user":
            user_seen = True
        cleaned.append({"role": message_role, "content": content})

    if not user_seen or not assistant_seen:
        reasons.append("example needs both user and assistant turns")
    # A final assistant tool request is a complete first-turn training example.
    # It deliberately has no tool result yet; the runtime supplies that later.
    if len(json.dumps(cleaned, ensure_ascii=False)) > 40000:
        reasons.append("example is too large")

    # Replace old or model-specific system prompts with one canonical Nebula contract.
    cleaned = [message for message in cleaned if message["role"] != "system"]
    cleaned.insert(0, {"role": "system", "content": identity_prompt()})
    normalized_metadata = {
        "source": str(metadata.get("source", "unknown")),
        "sourceModelRole": "daily",
        "qualityScore": int(metadata.get("qualityScore", 100 if metadata.get("source") == "synthetic" else 70)),
        "tags": [str(tag) for tag in metadata.get("tags", []) if isinstance(tag, str)][:20],
    }
    unique_reasons = list(dict.fromkeys(reasons))
    return ({"messages": cleaned, "metadata": normalized_metadata} if not unique_reasons else None), unique_reasons, flags


def input_paths(values: list[Path]) -> list[Path]:
    paths: list[Path] = []
    for value in values:
        if value.is_dir():
            paths.extend(sorted(value.glob("*.jsonl")))
        elif value.exists():
            paths.append(value)
    return list(dict.fromkeys(path.resolve() for path in paths))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", action="append", required=True, type=Path, help="JSONL file or directory; may be repeated")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--validation-percent", type=int, default=15)
    args = parser.parse_args()
    validation_percent = max(5, min(40, args.validation_percent))
    args.output_dir.mkdir(parents=True, exist_ok=True)

    paths = input_paths(args.input)
    if not paths:
        raise SystemExit("No JSONL inputs were found.")

    seen: set[str] = set()
    train: list[str] = []
    validation: list[str] = []
    rejected: list[dict[str, Any]] = []
    audit: dict[str, Any] = {
        "inputs": [str(path) for path in paths],
        "total": 0,
        "accepted": 0,
        "rejected": 0,
        "duplicate": 0,
        "train": 0,
        "validation": 0,
        "redacted": 0,
        "sensitive": 0,
        "identity_leak": 0,
        "malformed_tool": 0,
        "unsafe_tool": 0,
        "route_mismatch": 0,
        "rejection_reasons": {},
    }

    for path in paths:
        for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if not raw_line.strip():
                continue
            audit["total"] += 1
            try:
                raw = json.loads(raw_line)
                example, reasons, flags = audit_example(raw)
            except (json.JSONDecodeError, UnicodeError) as error:
                example, reasons, flags = None, [f"invalid JSON: {error}"], {}
            for key, value in flags.items():
                audit[key] += value
            if not example:
                audit["rejected"] += 1
                for reason in reasons:
                    audit["rejection_reasons"][reason] = audit["rejection_reasons"].get(reason, 0) + 1
                rejected.append({"source": path.name, "line": line_number, "reasons": reasons})
                continue

            fingerprint = json.dumps(example["messages"], ensure_ascii=False, sort_keys=True)
            if fingerprint in seen:
                audit["duplicate"] += 1
                continue
            seen.add(fingerprint)
            audit["accepted"] += 1
            output_line = json.dumps(example, ensure_ascii=False)
            bucket = int(hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:8], 16) % 100
            if bucket < validation_percent:
                validation.append(output_line)
                audit["validation"] += 1
            else:
                train.append(output_line)
                audit["train"] += 1

    (args.output_dir / "train.jsonl").write_text("\n".join(train) + ("\n" if train else ""), encoding="utf-8")
    (args.output_dir / "validation.jsonl").write_text("\n".join(validation) + ("\n" if validation else ""), encoding="utf-8")
    (args.output_dir / "audit.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
    (args.output_dir / "rejected.jsonl").write_text("\n".join(json.dumps(item) for item in rejected) + ("\n" if rejected else ""), encoding="utf-8")
    print(json.dumps(audit, indent=2))
    if not train or not validation:
        print("Warning: train or validation split is empty. Add more accepted examples before training.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
