#!/usr/bin/env python3
"""Evaluate a base model or LoRA adapter on Nebula JSONL behavior cases."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_cases(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def parse_json(value: str) -> Any:
    try:
        return json.loads(value.strip())
    except json.JSONDecodeError:
        return None


def score_case(case: dict[str, Any], output: str) -> tuple[bool, list[str]]:
    failures: list[str] = []
    lowered = output.casefold().strip()
    checks = case.get("checks", {})
    for expected in checks.get("must_contain", case.get("contains", [])):
        if str(expected).casefold() not in lowered:
            failures.append(f"missing: {expected}")
    for key in ("must_contain_any", "must_contain_any_2"):
        options = [str(value).casefold() for value in checks.get(key, [])]
        if options and not any(value in lowered for value in options):
            failures.append(f"missing all alternatives: {options}")
    legacy_any = [str(value).casefold() for value in case.get("containsAny", [])]
    if legacy_any and not any(value in lowered for value in legacy_any):
        failures.append(f"missing all alternatives: {legacy_any}")
    for excluded in checks.get("must_not_contain", case.get("excludes", [])):
        if str(excluded).casefold() in lowered:
            failures.append(f"included forbidden text: {excluded}")
    max_chars = checks.get("max_chars")
    if max_chars and len(output.strip()) > int(max_chars):
        failures.append(f"too long: {len(output.strip())} chars")
    if case.get("maxWords") and len(output.split()) > int(case["maxWords"]):
        failures.append(f"too verbose: {len(output.split())} words")
    if "exact_json" in checks:
        parsed = parse_json(output)
        if parsed != checks["exact_json"]:
            failures.append("response is not the exact required tool JSON")
    elif case.get("tool"):
        parsed = parse_json(output)
        if not isinstance(parsed, dict) or parsed.get("tool") != case["tool"] or not isinstance(parsed.get("args"), dict):
            failures.append("response is not exact tool JSON")
    return not failures, failures


def transcript(case: dict[str, Any]) -> str:
    if case.get("prompt"):
        return str(case["prompt"])
    labels = {"user": "USER", "assistant": "ASSISTANT", "tool": "TOOL RESULT", "system": "SYSTEM"}
    return "\n\n".join(f"[{labels.get(message['role'], message['role'].upper())}]\n{message['content']}" for message in case.get("messages", []))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", default="Qwen/Qwen2.5-Coder-1.5B-Instruct")
    parser.add_argument("--adapter", type=Path)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--system-prompt", type=Path, default=project_root() / "training/configs/nebula-qwen-system-prompt.txt")
    parser.add_argument("--label", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-new-tokens", type=int, default=180)
    parser.add_argument("--no-think", action="store_true", help="Evaluate Qwen3's fast non-thinking route.")
    args = parser.parse_args()

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, set_seed

    if not torch.cuda.is_available():
        raise SystemExit("Behavior evaluation requires a CUDA environment.")
    set_seed(42)
    token = os.environ.get("HF_TOKEN") or None
    compute_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, use_fast=True, token=token)
    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        device_map="auto",
        torch_dtype=compute_dtype,
        token=token,
    )
    if args.adapter:
        model = PeftModel.from_pretrained(model, str(args.adapter))
    model.eval()
    system = args.system_prompt.read_text(encoding="utf-8").strip()
    results: list[dict[str, Any]] = []

    for index, case in enumerate(load_cases(args.cases), 1):
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"{transcript(case)}\n/no_think" if args.no_think else transcript(case)},
        ]
        template_options = {"enable_thinking": False} if args.no_think else {}
        encoded = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
            **template_options,
        )
        if hasattr(encoded, "input_ids"):
            input_ids = encoded.input_ids.to(model.device)
        elif isinstance(encoded, dict):
            input_ids = encoded["input_ids"].to(model.device)
        else:
            input_ids = encoded.to(model.device)
        attention_mask = torch.ones_like(input_ids, device=model.device)
        with torch.inference_mode():
            generated = model.generate(
                input_ids,
                attention_mask=attention_mask,
                max_new_tokens=min(int(case.get("max_tokens", args.max_new_tokens)), args.max_new_tokens),
                do_sample=False,
                repetition_penalty=1.05,
                pad_token_id=tokenizer.eos_token_id,
            )
        output = tokenizer.decode(generated[0][input_ids.shape[-1] :], skip_special_tokens=True).strip()
        passed, failures = score_case(case, output)
        category = case.get("category", case.get("kind", "other"))
        results.append({"id": case["id"], "category": category, "output": output, "passed": passed, "failures": failures})
        print(f"[{index}] {'PASS' if passed else 'FAIL'} {case['id']}", flush=True)

    categories: dict[str, dict[str, float | int]] = {}
    for category in sorted({result["category"] for result in results}):
        group = [result for result in results if result["category"] == category]
        passed = sum(bool(result["passed"]) for result in group)
        categories[category] = {"passed": passed, "total": len(group), "accuracy": passed / len(group)}
    passed = sum(bool(result["passed"]) for result in results)
    report = {
        "label": args.label,
        "baseModel": args.base_model,
        "adapter": str(args.adapter) if args.adapter else None,
        "thinkingMode": "off" if args.no_think else "default",
        "passed": passed,
        "total": len(results),
        "accuracy": passed / len(results),
        "categories": categories,
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "results"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
