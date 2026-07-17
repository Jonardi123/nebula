#!/usr/bin/env python3
"""Measure LM Studio streaming latency and throughput for a local model."""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SYSTEM_PROMPT = """You are Nebula, Jonard's local AI assistant.
Be concise, practical, and honest. Never identify as the underlying model."""

PROMPTS = (
    "Introduce yourself in one short sentence.",
    "Explain why an async fetch should check response.ok in two concise sentences.",
    'Output only this JSON: {"tool":"get_current_time","args":{}}',
)


def profile_request(endpoint: str, model: str, prompt: str, timeout: int, no_think: bool) -> dict[str, Any]:
    user_prompt = f"{prompt}\n/no_think" if no_think else prompt
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 180,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Accept": "text/event-stream", "Content-Type": "application/json"},
        method="POST",
    )

    started = time.perf_counter()
    first_content_at: float | None = None
    chunks: list[str] = []
    usage: dict[str, Any] = {}
    with urllib.request.urlopen(request, timeout=timeout) as response:
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            event = json.loads(data)
            if event.get("usage"):
                usage = event["usage"]
            choices = event.get("choices") or []
            content = choices[0].get("delta", {}).get("content") if choices else None
            if content:
                if first_content_at is None:
                    first_content_at = time.perf_counter()
                chunks.append(content)

    finished = time.perf_counter()
    completion_tokens = int(usage.get("completion_tokens") or 0)
    generation_seconds = max(0.001, finished - (first_content_at or started))
    return {
        "prompt": prompt,
        "response": "".join(chunks),
        "first_token_ms": round(((first_content_at or finished) - started) * 1000),
        "total_ms": round((finished - started) * 1000),
        "completion_tokens": completion_tokens,
        "tokens_per_second": round(completion_tokens / generation_seconds, 2) if completion_tokens else None,
        "usage": usage,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--endpoint", default="http://localhost:1234/v1/chat/completions")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--no-think", action="store_true")
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    results = [profile_request(args.endpoint, args.model, prompt, args.timeout, args.no_think) for prompt in PROMPTS]
    first_token_values = [result["first_token_ms"] for result in results]
    speed_values = [result["tokens_per_second"] for result in results if result["tokens_per_second"] is not None]
    report = {
        "model": args.model,
        "thinking_mode": "off" if args.no_think else "default",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "average_first_token_ms": round(sum(first_token_values) / len(first_token_values)),
        "average_tokens_per_second": round(sum(speed_values) / len(speed_values), 2) if speed_values else None,
        "runs": results,
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    model_slug = re.sub(r"[^a-z0-9]+", "-", args.model.casefold()).strip("-") or "model"
    output_path = args.output_dir / f"{model_slug}-stream-{stamp}.json"
    output_path.write_text(json.dumps(report, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Report: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
