#!/usr/bin/env python3
"""Gate Nebula Gemma deployment on identity, tool, handoff, and regression metrics."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def accuracy(report: dict, kind: str) -> float:
    return float(report.get("kinds", {}).get(kind, {}).get("accuracy", 0.0))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--adapter", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    adapter = json.loads(args.adapter.read_text(encoding="utf-8"))
    checks = {
        "identity_at_least_95_percent": accuracy(adapter, "identity") >= 0.95,
        "tool_accuracy_at_least_80_percent": accuracy(adapter, "tool") >= 0.80,
        "tool_regression_no_more_than_2_percent": accuracy(adapter, "tool") + 0.02 >= accuracy(baseline, "tool"),
        "handoff_accuracy_at_least_80_percent": accuracy(adapter, "handoff") >= 0.80,
        "overall_not_worse_than_baseline": float(adapter.get("accuracy", 0.0)) >= float(baseline.get("accuracy", 0.0)),
    }
    report = {
        "passed": all(checks.values()),
        "checks": checks,
        "baseline": {"overall": baseline.get("accuracy"), "kinds": baseline.get("kinds")},
        "adapter": {"overall": adapter.get("accuracy"), "kinds": adapter.get("kinds")},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
