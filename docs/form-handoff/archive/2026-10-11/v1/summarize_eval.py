#!/usr/bin/env python3
"""Summarize manually recorded FORM evaluation runs. No network or model calls.

All prices must be recorded in USD. Missing costs remain unknown, never zero.
This tool reports descriptive statistics, not independent-sample confidence
intervals: repeated edits of the same vehicle are correlated.
"""
from __future__ import annotations
import argparse
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

STATUSES = {"not_run", "succeeded", "failed", "cancelled", "timeout"}
CHECKS = ("identity_pass", "instruction_pass", "untouched_pass", "would_keep")


def optional_number(value: Any, field: str, line: int) -> None:
    if value is None:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Line {line}: {field} must be a non-negative number or null")
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"Line {line}: {field} must be finite and non-negative")


def read_runs(path: Path) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []
    seen: set[str] = set()
    with path.open(encoding="utf-8") as handle:
        for line_num, text in enumerate(handle, 1):
            if not text.strip():
                continue
            try:
                item = json.loads(text)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Line {line_num}: invalid JSON: {exc.msg}") from exc
            if not isinstance(item, dict):
                raise ValueError(f"Line {line_num}: expected an object")
            for name in ("run_id", "case_id", "pipeline_id", "task", "cohort", "mode"):
                if not isinstance(item.get(name), str) or not item[name].strip():
                    raise ValueError(f"Line {line_num}: {name} must be a non-empty string")
            if item["mode"] not in {"live", "demo"}:
                raise ValueError(f"Line {line_num}: mode must be live or demo")
            if item["run_id"] in seen:
                raise ValueError(f"Line {line_num}: duplicate run_id {item['run_id']}")
            seen.add(item["run_id"])
            if item.get("status") not in STATUSES:
                raise ValueError(f"Line {line_num}: invalid status")
            if item.get("currency") != "USD":
                raise ValueError(f"Line {line_num}: use currency USD; do not mix currencies")
            for name in ("latency_ms", "provider_cost_usd"):
                optional_number(item.get(name), name, line_num)
            review = item.get("review")
            if review is not None:
                if item["status"] != "succeeded":
                    raise ValueError(f"Line {line_num}: only succeeded runs can have a review")
                if not isinstance(review, dict):
                    raise ValueError(f"Line {line_num}: review must be an object or null")
                if not isinstance(review.get("reviewer_id"), str) or not review["reviewer_id"].strip():
                    raise ValueError(f"Line {line_num}: review requires reviewer_id")
                if any(type(review.get(key)) is not bool for key in CHECKS):
                    raise ValueError(f"Line {line_num}: all four review checks must be boolean")
            if item["status"] == "not_run":
                if review is not None or any(item.get(k) is not None for k in ("latency_ms", "provider_cost_usd")):
                    raise ValueError(f"Line {line_num}: not_run may not contain measurements")
            runs.append(item)
    return runs


def percentile_nearest_rank(values: list[float], probability: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(probability * len(ordered)) - 1)]


def summarize_group(all_runs: list[dict[str, Any]]) -> dict[str, Any]:
    executed = [r for r in all_runs if r["status"] != "not_run"]
    n = len(executed)
    delivered = [r for r in executed if r["status"] == "succeeded"]
    reviewed = [r for r in delivered if r.get("review") is not None]
    technical_qualified = [r for r in reviewed if all(r["review"][k] for k in CHECKS[:3])]
    kept_qualified = [r for r in technical_qualified if r["review"]["would_keep"]]
    pending_reviews = len(delivered) - len(reviewed)
    costs = [float(r["provider_cost_usd"]) for r in executed if r.get("provider_cost_usd") is not None]
    cost_complete = n > 0 and len(costs) == n
    known_cost = sum(costs)
    durations = [float(r["latency_ms"]) for r in executed if r.get("latency_ms") is not None]
    delivery_durations = [float(r["latency_ms"]) for r in delivered if r.get("latency_ms") is not None]
    denominator_complete = pending_reviews == 0
    return {
        "status": "not_run" if not n else "observed",
        "planned_records": len(all_runs),
        "executed_records": n,
        "unique_cases_executed": len({r["case_id"] for r in executed}),
        "outcomes": dict(Counter(r["status"] for r in executed)),
        "technical_delivery_rate": len(delivered) / n if n else None,
        "delivered_reviewed": len(reviewed),
        "delivered_pending_review": pending_reviews,
        "review_coverage_of_delivered": len(reviewed) / len(delivered) if delivered else None,
        "task_correct_confirmed": len(technical_qualified),
        "task_correct_and_would_keep_confirmed": len(kept_qualified),
        "qualified_keep_rate_all_attempts": len(kept_qualified) / n if n and denominator_complete else None,
        "qualified_keep_rate_missing_review_bounds": [len(kept_qualified) / n, (len(kept_qualified) + pending_reviews) / n] if n else None,
        "observed_provider_cost_usd": round(known_cost, 8) if costs else None,
        "provider_cost_coverage": len(costs) / n if n else None,
        "total_provider_cost_usd": round(known_cost, 8) if cost_complete else None,
        "provider_cost_per_qualified_kept_output_usd": round(known_cost / len(kept_qualified), 8) if cost_complete and denominator_complete and kept_qualified else None,
        "latency_observation_count": len(durations),
        "all_observed_outcomes_latency_ms_p50": statistics.median(durations) if durations else None,
        "all_observed_outcomes_latency_ms_p95": percentile_nearest_rank(durations, .95),
        "delivered_only_latency_ms_p50": statistics.median(delivery_durations) if delivery_durations else None,
        "delivered_only_latency_ms_p95": percentile_nearest_rank(delivery_durations, .95),
        "notes": [
            "Failures and cancellations remain in the attempt denominator.",
            "Missing reviews are shown as uncertainty bounds, not silently passed.",
            "Provider costs omit unrecorded preprocessing, storage, support, tax, platform fees, and acquisition.",
            "p50 uses the median and p95 uses nearest-rank; inspect small-sample counts.",
            "Repeated edits of one vehicle are correlated; no population confidence claim is made."
        ]
    }


def summarize(runs: list[dict[str, Any]], include_demo: bool = False) -> dict[str, Any]:
    eligible = [r for r in runs if include_demo or r["mode"] == "live"]
    groups: dict[tuple[str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for run in eligible:
        groups[(run["pipeline_id"], run["task"], run["cohort"], run["mode"])].append(run)
    return {
        "schema_version": 1,
        "excluded_non_live_records": len(runs) - len(eligible),
        "overall": summarize_group(eligible),
        "groups": [dict(zip(("pipeline_id", "task", "cohort", "mode"), key), **summarize_group(value)) for key, value in sorted(groups.items())],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs", type=Path, help="UTF-8 JSONL observations")
    parser.add_argument("--output", type=Path, help="Write summary JSON here")
    parser.add_argument("--include-demo", action="store_true", help="Include non-live records, still separated by mode in groups")
    args = parser.parse_args()
    try:
        if args.output and args.output.resolve() == args.runs.resolve():
            raise ValueError("Output must not overwrite the input observations")
        result = summarize(read_runs(args.runs), args.include_demo)
        text = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(text, encoding="utf-8")
        else:
            sys.stdout.write(text)
        return 0
    except (ValueError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
