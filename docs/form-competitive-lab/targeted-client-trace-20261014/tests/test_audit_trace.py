import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from audit_trace import audit

LEDGER = {
    "AOT05": {"status": "CODE_LINKED", "method": "READ_ONLY_STATIC_ARTIFACT"},
    "AOT09": {"status": "CODE_LINKED", "method": "READ_ONLY_STATIC_ARTIFACT"},
    "UX05": {"status": "OBSERVED_UI", "method": "SECONDARY_DOCUMENT_REVIEW"},
    "PLAN01": {"status": "NOT_EXECUTED", "method": "READ_ONLY_STATIC_ARTIFACT"},
}


def matrix(ui_proof="ARCHIVED_UI", edge="CROSS_SOURCE_HYPOTHESIS"):
    return {"schema": "FORM_CLIENT_TRACE_V1", "chains": [{
        "id": "MODY_STYLE", "nodes": [
            {"id": "ui", "proof": ui_proof, "evidence_ids": ["UX05"]},
            {"id": "compile", "proof": "CLIENT_STATIC", "evidence_ids": ["AOT05", "AOT09"]},
        ], "edges": [{"from": "ui", "to": "compile", "proof": edge}]
    }]}


class AuditTest(unittest.TestCase):
    def test_valid_mixed_evidence_not_runtime_claim(self):
        v = audit(matrix(), LEDGER)
        self.assertTrue(v["ok"], v["problems"])
        self.assertEqual(v["evidence_references"], 3)
        self.assertEqual(v["chains"], 1)

    def test_ui_requires_secondary_method(self):
        v = audit(matrix(), {**LEDGER, "UX05": {"status": "OBSERVED_UI", "method": "RUNTIME_OBSERVED"}})
        self.assertFalse(v["ok"])
        self.assertIn("archived UI method mismatch MODY_STYLE/ui: UX05", v["problems"])

    def test_static_cannot_cite_not_executed(self):
        v = matrix()
        v["chains"][0]["nodes"][1]["evidence_ids"] = ["PLAN01"]
        self.assertFalse(audit(v, LEDGER)["ok"])

    def test_ui_to_static_cannot_be_declared_code_link(self):
        self.assertFalse(audit(matrix(edge="REPORTED_CLIENT_LINK"), LEDGER)["ok"])

    def test_missing_reference_fails(self):
        v = matrix()
        v["chains"][0]["nodes"][1]["evidence_ids"] = ["AOT_NOT_EXISTS"]
        self.assertFalse(audit(v, LEDGER)["ok"])

    def test_unknown_node_in_edge_fails(self):
        v = matrix()
        v["chains"][0]["edges"][0]["to"] = "nonexistent"
        self.assertFalse(audit(v, LEDGER)["ok"])

    def test_local_only_with_ledger_ref_fails(self):
        v = matrix()
        v["chains"][0]["nodes"][0]["proof"] = "LOCAL_RECHECK_REQUIRED"
        self.assertFalse(audit(v, LEDGER)["ok"])

    def test_duplicate_chain_fails(self):
        v = matrix()
        v["chains"].append(v["chains"][0])
        self.assertFalse(audit(v, LEDGER)["ok"])


if __name__ == "__main__":
    unittest.main()
