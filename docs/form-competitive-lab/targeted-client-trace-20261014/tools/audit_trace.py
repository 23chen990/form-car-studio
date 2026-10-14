#!/usr/bin/env python3
"""Audit a public FORM evidence trace without reproducing private evidence.

Inputs are the already published, redacted PR #7 ledger and an original trace
hypothesis matrix. This verifies *attribution*, not runtime call reachability.
Outputs contain IDs, counts, and errors only, never private source values.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

VALID_PROOFS = {"ARCHIVED_UI", "CLIENT_STATIC", "UNVERIFIED", "LOCAL_RECHECK_REQUIRED"}
CODE_STATUS = "CODE_LINKED"
UI_STATUS = "OBSERVED_UI"
VALID_EDGES = {"REPORTED_CLIENT_LINK", "CROSS_SOURCE_HYPOTHESIS", "UNKNOWN"}


def _load_ledger(path: Path) -> tuple[dict[str, dict], str]:
    digest = hashlib.sha256()
    rows: dict[str, dict] = {}
    with path.open("rb") as handle:
        for number, line in enumerate(handle, 1):
            digest.update(line)
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict) or not isinstance(row.get("recordId"), str):
                raise ValueError(f"invalid ledger row {number}")
            key = row["recordId"]
            if key in rows:
                raise ValueError(f"duplicate ledger ID {key}")
            rows[key] = {"status": row.get("status"), "method": row.get("method"),
                         "confidence": row.get("confidence")}
    return rows, digest.hexdigest()


def audit(matrix: dict, ledger: dict[str, dict]) -> dict:
    problems: list[str] = []
    checked = 0
    ids_seen: set[str] = set()
    chain_ids: set[str] = set()
    for chain in matrix.get("chains", []):
        chain_id = chain.get("id", "<missing>")
        if chain_id in chain_ids:
            problems.append(f"duplicate chain {chain_id}")
        chain_ids.add(chain_id)
        node_map: dict[str, dict] = {}
        for node in chain.get("nodes", []):
            node_id = node.get("id", "<missing>")
            node_key = f"{chain_id}/{node_id}"
            if node_id in node_map:
                problems.append(f"duplicate node {node_key}")
            node_map[node_id] = node
            proof = node.get("proof")
            if proof not in VALID_PROOFS:
                problems.append(f"unsupported proof {node_key}")
                continue
            evidence_ids = node.get("evidence_ids", [])
            if not isinstance(evidence_ids, list):
                problems.append(f"non-list evidence {node_key}")
                continue
            if proof in ("CLIENT_STATIC", "ARCHIVED_UI") and not evidence_ids:
                problems.append(f"missing evidence {node_key}")
            if proof == "LOCAL_RECHECK_REQUIRED" and evidence_ids:
                problems.append(f"local-only node claims ledger {node_key}")
            for evidence_id in evidence_ids:
                checked += 1
                ids_seen.add(evidence_id)
                item = ledger.get(evidence_id)
                if item is None:
                    problems.append(f"unknown evidence {node_key}: {evidence_id}")
                    continue
                status = item.get("status")
                if proof == "CLIENT_STATIC" and status != CODE_STATUS:
                    problems.append(f"static evidence status mismatch {node_key}: {evidence_id}")
                if proof == "ARCHIVED_UI" and status != UI_STATUS:
                    problems.append(f"UI evidence status mismatch {node_key}: {evidence_id}")
                if proof == "ARCHIVED_UI" and item.get("method") != "SECONDARY_DOCUMENT_REVIEW":
                    problems.append(f"archived UI method mismatch {node_key}: {evidence_id}")
        for edge in chain.get("edges", []):
            source, dest = edge.get("from"), edge.get("to")
            edge_kind = edge.get("proof")
            edge_key = f"{chain_id}/{source}->{dest}"
            if source not in node_map or dest not in node_map:
                problems.append(f"edge has unknown node {edge_key}")
                continue
            if edge_kind not in VALID_EDGES:
                problems.append(f"unsupported edge {edge_key}")
            if edge_kind == "REPORTED_CLIENT_LINK" and (
                node_map[source]["proof"] != "CLIENT_STATIC" or
                node_map[dest]["proof"] != "CLIENT_STATIC"
            ):
                problems.append(f"edge overclaims static reachability {edge_key}")
    if matrix.get("schema") != "FORM_CLIENT_TRACE_V1":
        problems.append("unsupported matrix schema")
    if not chain_ids:
        problems.append("no chains")
    return {"schema": "FORM_TRACE_AUDIT_V1", "ok": not problems,
            "chains": len(chain_ids), "evidence_references": checked,
            "unique_evidence_ids": len(ids_seen), "problems": sorted(problems),
            "notice": "Evidence IDs and status consistency only; does not prove UI-to-bytecode links, model, output or runtime behaviour."}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, required=True, help="Published PR7 redacted JSONL ledger")
    parser.add_argument("--matrix", type=Path, required=True, help="Trace matrix from this research directory")
    parser.add_argument("--output", type=Path, help="Optional local audit result path")
    args = parser.parse_args()
    matrix = json.loads(args.matrix.read_text(encoding="utf-8"))
    ledger, sha = _load_ledger(args.ledger)
    result = audit(matrix, ledger)
    result["ledger_sha256"] = sha
    result["ledger_records"] = len(ledger)
    body = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(body + "\n", encoding="utf-8")
    print(body)
    raise SystemExit(0 if result["ok"] else 2)


if __name__ == "__main__":
    main()
