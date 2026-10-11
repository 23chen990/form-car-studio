"""Synthetic unit tests for the offline summarizer, not image quality results."""
import json
import tempfile
import unittest
import sys
from io import StringIO
from contextlib import redirect_stderr
from unittest.mock import patch
from pathlib import Path
from summarize_eval import summarize, read_runs, main


def row(id="1", status="succeeded", cost=.1, review=True, **kwargs):
    r = dict(run_id=id, case_id="car-a", pipeline_id="a", task="body_color", cohort="baseline", mode="live", currency="USD", status=status, provider_cost_usd=cost, latency_ms=1000, review=None)
    if review and status == "succeeded":
        r["review"] = dict(reviewer_id="synthetic-reviewer", identity_pass=True, instruction_pass=True, untouched_pass=True, would_keep=True)
    r.update(kwargs)
    return r


class SummaryTests(unittest.TestCase):
    def test_failed_attempt_is_in_cost_and_denominator(self):
        o = summarize([row(), row("2", "failed", .2)])["overall"]
        self.assertEqual(o["technical_delivery_rate"], .5)
        self.assertEqual(o["qualified_keep_rate_all_attempts"], .5)
        self.assertAlmostEqual(o["provider_cost_per_qualified_kept_output_usd"], .3)

    def test_missing_cost_is_not_free(self):
        o = summarize([row(cost=None)])["overall"]
        self.assertIsNone(o["total_provider_cost_usd"])
        self.assertIsNone(o["provider_cost_per_qualified_kept_output_usd"])

    def test_missing_review_is_not_passed(self):
        o = summarize([row(review=False)])["overall"]
        self.assertIsNone(o["qualified_keep_rate_all_attempts"])
        self.assertEqual(o["qualified_keep_rate_missing_review_bounds"], [0, 1])

    def test_not_run_template_is_not_a_measurement(self):
        o = summarize([row(status="not_run", cost=None, latency_ms=None)])["overall"]
        self.assertEqual(o["status"], "not_run")
        self.assertEqual(o["executed_records"], 0)
        self.assertIsNone(o["total_provider_cost_usd"])

    def test_demo_is_excluded(self):
        result = summarize([row(mode="demo")])
        self.assertEqual(result["excluded_non_live_records"], 1)
        self.assertEqual(result["overall"]["status"], "not_run")

    def test_wrong_currency_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "runs.jsonl"
            p.write_text(json.dumps(row(currency="EUR")), encoding="utf-8")
            with self.assertRaises(ValueError):
                read_runs(p)

    def test_duplicate_id_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "runs.jsonl"
            p.write_text(json.dumps(row()) + "\n" + json.dumps(row()), encoding="utf-8")
            with self.assertRaises(ValueError):
                read_runs(p)

    def test_invalid_mode_cannot_silently_disappear(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "runs.jsonl"
            p.write_text(json.dumps(row(mode="Live")), encoding="utf-8")
            with self.assertRaises(ValueError):
                read_runs(p)

    def test_non_finite_or_boolean_cost_is_rejected(self):
        for cost in (float("nan"), float("inf"), True, -.1):
            with self.subTest(cost=cost), tempfile.TemporaryDirectory() as d:
                p = Path(d) / "runs.jsonl"
                p.write_text(json.dumps(row(cost=cost)), encoding="utf-8")
                with self.assertRaises(ValueError):
                    read_runs(p)

    def test_measurements_cannot_be_attached_to_not_run(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "runs.jsonl"
            p.write_text(json.dumps(row(status="not_run")), encoding="utf-8")
            with self.assertRaises(ValueError):
                read_runs(p)

    def test_output_cannot_overwrite_raw_observations(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "runs.jsonl"
            original = json.dumps(row())
            p.write_text(original, encoding="utf-8")
            with patch.object(sys, "argv", ["summarize_eval.py", str(p), "--output", str(p)]), redirect_stderr(StringIO()):
                self.assertEqual(main(), 2)
            self.assertEqual(p.read_text(encoding="utf-8"), original)

    def test_correlated_cohorts_are_separated(self):
        result = summarize([row(), row("2", cohort="chain")])
        self.assertEqual(len(result["groups"]), 2)
        self.assertEqual(result["overall"]["unique_cases_executed"], 1)


if __name__ == "__main__":
    unittest.main()
