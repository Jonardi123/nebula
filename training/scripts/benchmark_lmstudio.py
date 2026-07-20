#!/usr/bin/env python3
"""Run deterministic Nebula behavior checks against an LM Studio model."""

from __future__ import annotations

import argparse
import json
import re
import statistics
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SYSTEM_PROMPT = """You are Nebula, a local AI assistant running on Jonard's computer.
Be concise, honest, and practical. Never claim an action succeeded unless a tool result confirms it.
Read files before editing them. When a tool is required, output only valid JSON using
{"tool":"tool_name","args":{}}. Never reveal or adopt underlying model branding.
Destructive or security-disabling actions are blocked."""


def post_json(url: str, payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code}: {body}") from error


def normalized(value: str) -> str:
    return value.casefold().strip()


def score_response(output: str, checks: dict[str, Any]) -> tuple[bool, list[str]]:
    failures: list[str] = []
    folded = normalized(output)

    for item in checks.get("must_contain", []):
        if normalized(item) not in folded:
            failures.append(f"missing required text: {item}")
    for key in ("must_contain_any", "must_contain_any_2"):
        options = checks.get(key, [])
        if options and not any(normalized(item) in folded for item in options):
            failures.append(f"missing one of: {', '.join(options)}")
    for item in checks.get("must_not_contain", []):
        if normalized(item) in folded:
            failures.append(f"contained forbidden text: {item}")
    if checks.get("max_chars") and len(output.strip()) > int(checks["max_chars"]):
        failures.append(f"too long: {len(output.strip())} chars")
    if "exact_json" in checks:
        try:
            parsed = json.loads(output.strip())
            if parsed != checks["exact_json"]:
                failures.append(f"JSON mismatch: {parsed!r}")
        except json.JSONDecodeError as error:
            failures.append(f"invalid JSON: {error.msg}")
    return not failures, failures


def load_cases(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--endpoint", default="http://localhost:1234/v1/chat/completions")
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--no-think", action="store_true", help="Append Qwen's /no_think control to the final user turn.")
    args = parser.parse_args()

    cases = load_cases(args.cases)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    results: list[dict[str, Any]] = []

    for index, case in enumerate(cases, 1):
        messages = [{"role": "system", "content": SYSTEM_PROMPT}, *case.get("messages", [])]
        if "prompt" in case:
            messages.append({"role": "user", "content": case["prompt"]})
        if args.no_think:
            for message in reversed(messages):
                if message.get("role") == "user":
                    message["content"] = f"{message.get('content', '').rstrip()}\n/no_think"
                    break
        payload = {
            "model": args.model,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": case.get("max_tokens", 180),
            "stream": False,
        }
        started = time.perf_counter()
        output = ""
        error = None
        usage: dict[str, Any] = {}
        try:
            response = post_json(args.endpoint, payload, args.timeout)
            response_message = response["choices"][0]["message"]
            visible_output = response_message.get("content") or ""
            reasoning_output = response_message.get("reasoning_content") or ""
            output = visible_output if visible_output.strip() else reasoning_output
            response_channel = "content" if visible_output.strip() else "reasoning_content"
            usage = response.get("usage") or {}
            passed, failures = score_response(output, case.get("checks", {}))
        except Exception as exception:  # Keep the suite running after individual transport/model failures.
            error = str(exception)
            response_channel = "error"
            passed, failures = False, [error]
        duration_ms = round((time.perf_counter() - started) * 1000)
        result = {
            "id": case["id"],
            "category": case["category"],
            "model": args.model,
            "passed": passed,
            "failures": failures,
            "prompt": case.get("prompt"),
            "messages": case.get("messages"),
            "response": output,
            "response_channel": response_channel,
            "duration_ms": duration_ms,
            "usage": usage,
            "error": error,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "training_eligible": False,
        }
        results.append(result)
        print(f"[{index:02}/{len(cases):02}] {'PASS' if passed else 'FAIL'} {case['id']} ({duration_ms} ms)", flush=True)

    by_category: dict[str, list[bool]] = defaultdict(list)
    reasons: Counter[str] = Counter()
    for result in results:
        by_category[result["category"]].append(result["passed"])
        reasons.update(result["failures"])
    durations = [result["duration_ms"] for result in results]
    passed_count = sum(result["passed"] for result in results)
    report = {
        "model": args.model,
        "thinking_mode": "off" if args.no_think else "default",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "total": len(results),
        "passed": passed_count,
        "failed": len(results) - passed_count,
        "pass_rate": round(passed_count / max(1, len(results)), 4),
        "median_latency_ms": round(statistics.median(durations)) if durations else None,
        "categories": {
            category: {"passed": sum(values), "total": len(values), "pass_rate": round(sum(values) / len(values), 4)}
            for category, values in sorted(by_category.items())
        },
        "failure_reasons": reasons.most_common(),
        "failed_case_ids": [result["id"] for result in results if not result["passed"]],
        "note": "Raw model outputs are evaluation evidence, not automatically approved fine-tuning examples.",
    }
    model_slug = re.sub(r"[^a-z0-9]+", "-", args.model.casefold()).strip("-") or "model"
    raw_path = args.output_dir / f"{model_slug}-raw-{stamp}.jsonl"
    report_path = args.output_dir / f"{model_slug}-report-{stamp}.json"
    raw_path.write_text("\n".join(json.dumps(item, ensure_ascii=True) for item in results) + "\n", encoding="utf-8")
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Raw results: {raw_path}")
    print(f"Report: {report_path}")
    return 0 if passed_count == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
