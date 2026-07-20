#!/usr/bin/env python3
"""Resumably turn Nebula candidate scenarios into reviewed training rows.

This script deliberately separates candidate scale from training readiness. A
teacher drafts varied answers, a reviewer approves or corrects them, and local
static gates reject malformed, unsafe, secret-bearing, or identity-leaking rows.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from generate_nebula_100k import SYSTEM
from validate_nebula_100k import IDENTITY_LEAK, PROHIBITED_OUTPUT, SECRET, validate_tool


CONTRACT_CATEGORIES = {"tool_agent_workflows", "failure_honesty", "identity_voice_mobile"}
JSON_OBJECT = re.compile(r"\{.*\}", re.S)


def chat(endpoint: str, model: str, messages: list[dict[str, str]], temperature: float, max_tokens: int, timeout: int) -> str:
    payload = json.dumps({"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens, "stream": False}).encode()
    headers = {"Content-Type": "application/json"}
    api_key = os.environ.get("NEBULA_REVIEW_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(endpoint, data=payload, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = json.loads(response.read().decode("utf-8"))
    content = body.get("choices", [{}])[0].get("message", {}).get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("model returned an empty response")
    return content.strip()


def parse_review(content: str) -> dict[str, Any]:
    match = JSON_OBJECT.search(content)
    if not match:
        raise ValueError("reviewer did not return JSON")
    value = json.loads(match.group(0))
    if not isinstance(value, dict) or not isinstance(value.get("approved"), bool):
        raise ValueError("review JSON has no boolean approved field")
    return value


def static_rejection(answer: str, category: str) -> str | None:
    if SECRET.search(answer):
        return "secret-like output"
    if IDENTITY_LEAK.search(answer):
        return "underlying model identity leak"
    if PROHIBITED_OUTPUT.search(answer) and "can't help" not in answer.casefold():
        return "prohibited operational output"
    tool_problem = validate_tool(answer)
    if category == "tool_agent_workflows" and tool_problem:
        return tool_problem
    if category != "tool_agent_workflows" and answer.lstrip().startswith("{"):
        return "unexpected tool-shaped answer"
    return None


def teacher_messages(prompt: str, reference: str, category: str) -> list[dict[str, str]]:
    instruction = f"""Draft the final assistant answer for this Nebula training scenario.
Category: {category}
The reference below is a correctness rubric, not wording to copy. Preserve its factual and safety requirements while writing a natural, context-aware answer with no chain-of-thought, no model/vendor identity, and no claims of unobserved actions.
Reference rubric:
{reference}

User request:
{prompt}"""
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": instruction}]


def reviewer_messages(prompt: str, reference: str, draft: str, category: str) -> list[dict[str, str]]:
    instruction = f"""Review a proposed Nebula training answer. Return only compact JSON:
{{"approved":true|false,"score":0-100,"reason":"short reason","correctedAnswer":"required and complete whenever approved is false"}}

Reject invented tool results, unsafe operational guidance, identity leaks, unsupported certainty, irrelevant verbosity, or loss of the reference requirements. For authorized reverse engineering, keep the answer defensive and evidence-based.
Category: {category}
User request: {prompt}
Reference requirements: {reference}
Draft: {draft}"""
    return [{"role": "system", "content": "You are Nebula's strict training-data reviewer. Do not reveal hidden reasoning."}, {"role": "user", "content": instruction}]


def processed_keys(log_path: Path, accepted_only: bool = False) -> set[str]:
    keys: set[str] = set()
    if not log_path.is_file():
        return keys
    for line in log_path.read_text(encoding="utf-8").splitlines():
        try:
            value = json.loads(line)
            if isinstance(value.get("key"), str) and (not accepted_only or value.get("accepted") is True):
                keys.add(value["key"])
        except json.JSONDecodeError:
            continue
    return keys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--log", type=Path)
    parser.add_argument("--endpoint", default="http://localhost:1234/v1/chat/completions")
    parser.add_argument("--teacher-model", required=True)
    parser.add_argument("--reviewer-model", required=True)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--category", action="append", default=[])
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--review-contract-categories", action="store_true", help="Also call models for deterministic contract categories.")
    parser.add_argument("--retry-rejected", action="store_true", help="Retry rows whose previous review was rejected.")
    args = parser.parse_args()
    log_path = args.log or args.output.with_suffix(".review-log.jsonl")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    done = processed_keys(log_path, accepted_only=args.retry_rejected)
    accepted = rejected = attempted = 0
    categories = set(args.category)

    with args.input.open("r", encoding="utf-8") as source, args.output.open("a", encoding="utf-8", buffering=1) as destination, log_path.open("a", encoding="utf-8", buffering=1) as review_log:
        for line_number, line in enumerate(source, start=1):
            item = json.loads(line)
            category = item["metadata"]["category"]
            if categories and category not in categories:
                continue
            key = f"{args.input.resolve()}:{line_number}"
            if key in done:
                continue
            if attempted >= args.limit:
                break
            attempted += 1
            prompt = next(message["content"] for message in reversed(item["messages"]) if message["role"] == "user")
            reference = next(message["content"] for message in reversed(item["messages"]) if message["role"] == "assistant")
            started = time.perf_counter()
            event: dict[str, Any] = {"key": key, "line": line_number, "category": category, "accepted": False}
            try:
                if category in CONTRACT_CATEGORIES and not args.review_contract_categories:
                    draft = reference
                    review = {"approved": True, "score": 100, "reason": "deterministic contract template"}
                else:
                    draft = chat(args.endpoint, args.teacher_model, teacher_messages(prompt, reference, category), 0.55, 500, args.timeout)
                    review_content = chat(args.endpoint, args.reviewer_model, reviewer_messages(prompt, reference, draft, category), 0.0, 350, args.timeout)
                    review = parse_review(review_content)
                answer = draft if review.get("approved") else str(review.get("correctedAnswer", "")).strip()
                if not answer:
                    raise ValueError(f"review rejected without correction: {review.get('reason', 'no reason')}")
                problem = static_rejection(answer, category)
                if problem:
                    raise ValueError(problem)
                revised = json.loads(json.dumps(item))
                for message in reversed(revised["messages"]):
                    if message["role"] == "assistant":
                        message["content"] = answer
                        break
                revised["metadata"].update({
                    "source": "teacher_reviewer_approved_v1",
                    "reviewStatus": "approved",
                    "teacherModel": args.teacher_model,
                    "reviewerModel": args.reviewer_model,
                    "reviewScore": int(review.get("score", 0)),
                })
                destination.write(json.dumps(revised, ensure_ascii=False, separators=(",", ":")) + "\n")
                event.update({"accepted": True, "score": review.get("score"), "reason": review.get("reason")})
                accepted += 1
            except (ValueError, RuntimeError, TimeoutError, urllib.error.URLError, urllib.error.HTTPError) as error:
                event["reason"] = str(error)[:500]
                rejected += 1
            event["elapsedSeconds"] = round(time.perf_counter() - started, 3)
            review_log.write(json.dumps(event, ensure_ascii=False) + "\n")

    summary = {"attempted": attempted, "accepted": accepted, "rejected": rejected, "output": str(args.output), "log": str(log_path)}
    print(json.dumps(summary, indent=2))
    return 0 if not rejected else 4


if __name__ == "__main__":
    raise SystemExit(main())
