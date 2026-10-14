#!/usr/bin/env python3
"""Focused, privacy-first static index for EXISTING hermes-dec .hasm files.

This script does not disassemble, decrypt, call an API, execute Hermes or access
any network. It extracts safe structural key references only; findings are
candidates for manual register/data-flow review, not proven runtime behavior.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

HEAD = re.compile(r'^=> \[(?P<kind>Function|Generator function|Async function) #(?P<id>\d+) "(?P<name>.*?)" of (?P<size>\d+) bytes\]:.*?@ offset (?P<offset>0x[0-9a-fA-F]+)')
INSTR = re.compile(r'^==>\s*(?P<instr>.*)$')
QUOTED = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'')
URL = re.compile(r'https?://\S+', re.I)
LONG = re.compile(r'(?<![A-Za-z0-9_])[A-Za-z0-9_\-+/=]{45,}(?![A-Za-z0-9_])')

# Every string below comes from already public reports or recording labels.
# Generic keys are identifiers, not endpoint secrets or private prompt text.
SAFE_FIELDS = frozenset({
 'imageData', 'itemIds', 'collection', 'outputs', 'url', 'status', 'credit',
 'inputs', 'aiModelId', 'aiModelType', 'aiSubModelType', 'pending', 'style',
 'extra', 'color', 'styleId', 'extraId', 'colorId', 'modificationType',
 'parameters', 'quality', 'requestId', 'image', 'result',
 'generateCarStyle', 'generateCarMod', 'httpsCallable', 'runGeneration',
 'createResizedImage', 'calculateTargetSize', 'selectedStyle',
 'selectedExtras', 'selectedColor', 'isPremium', 'isPro',
})
TARGETS = {
 'modyfy': [20352, 20353, 20354, 20355, 20361, 20362, 20363, 20364,
            22481, 22482, 22512, 22518, 22519, 22526],
 'wrapr': [9782],
}


def clean_instruction(s: str) -> str:
    """Keep only public field literals; redact unknown strings/URLs and long data."""
    def clean_quoted(m: re.Match[str]) -> str:
        raw = m.group(0)
        value = raw[1:-1]
        if value in SAFE_FIELDS:
            return '"' + value + '"'
        return '"<redacted-literal>"'
    s = QUOTED.sub(clean_quoted, s)
    s = URL.sub('<url-redacted>', s)
    s = LONG.sub('<redacted-long-token>', s)
    # Programmatically cap stored text length; do not dump full bytecode.
    return s[:280]


def load_labels(csv_path: Path | None) -> list[str]:
    if csv_path is None:
        return []
    with csv_path.open('r', encoding='utf-8-sig', newline='') as f:
        labels = [r.get('observed_label', '').strip() for r in csv.DictReader(f)]
    return sorted(set(x for x in labels if x), key=lambda x:(-len(x), x))


def safe_iter_lines(path: Path, sha: 'hashlib._Hash'):
    with path.open('rb') as f:
        for n, raw in enumerate(f, 1):
            sha.update(raw)
            yield n, raw


def scan(path: Path, profile: str, labels: list[str], targets: set[int],
         max_per_function: int = 60) -> dict:
    if not path.is_file():
        raise FileNotFoundError(path)
    if path.stat().st_size > 1_000_000_000:
        raise ValueError('Input larger than 1GB: supply a bounded artifact')
    result: dict = {
        'schema': 'FORM_HERMES_STATIC_SLICE_V1',
        'source_filename': path.name,
        'source_sha256': None,
        'profile': profile,
        'source_bytes': path.stat().st_size,
        'function_headers_seen': 0,
        'selected_functions': {},
        'catalog_string_matches': {x: {'occurrences': 0, 'function_ids': [], 'example_line_numbers': []}
                                   for x in labels},
        'warnings': [
            'Index-only: matching a key and a function does NOT establish data flow, request order, real model or runtime output.',
            'No original images, user data, private prompt text, private URLs, or binaries are embedded in this report.',
            'A label absent from disassembly is not proof that it is absent from resources or remote data.',
            'Inspect source bundle version separately. Do not mix identifiers across app versions.',
            'Manually validate Hermes closure/generator environment and call sites; references printed here are not verified edges.',
            'Output remains PRIVATE and needs human redaction review before any public upload.',
        ],
    }
    sha = hashlib.sha256()
    cur: int | None = None
    cur_kind = None
    count = defaultdict(int)
    for n, raw in safe_iter_lines(path, sha):
        # bytecode text can contain invalid bytes or large arbitrary strings
        line = raw.decode('utf-8', errors='replace').rstrip('\r\n')
        m = HEAD.match(line)
        if m:
            result['function_headers_seen'] += 1
            cur = int(m.group('id'))
            cur_kind = m.group('kind')
            if cur in targets:
                result['selected_functions'][str(cur)] = {
                    'id': cur, 'kind': cur_kind, 'offset': m.group('offset'),
                    'size_bytes_reported': int(m.group('size')),
                    'header_line': n, 'safe_property_refs': {},
                    'sample_instructions': [], 'candidate_closure_refs': [],
                    'instruction_lines_seen': 0,
                }
        inst = INSTR.match(line)
        if inst and cur in targets:
            slot = result['selected_functions'][str(cur)]
            slot['instruction_lines_seen'] += 1
            ins = inst.group('instr')
            # Only literal quoted field keys count: plain mentions may be comments.
            matched = [f for f in SAFE_FIELDS if f'"{f}"' in ins or f"'{f}'" in ins]
            for field in matched:
                p = slot['safe_property_refs'].setdefault(field, {'count': 0, 'lines': []})
                p['count'] += 1
                if len(p['lines']) < 6: p['lines'].append(n)
            interesting = bool(matched) or bool(re.search(r'\b(?:CallDirect|CreateClosure|CreateGenerator|GetById|PutById|GetByVal|PutByVal|Ret)\b', ins))
            if interesting and count[cur] < max_per_function:
                slot['sample_instructions'].append({'line': n, 'asm': clean_instruction(ins)})
                count[cur] += 1
            if 'CreateClosure' in ins or 'CreateGenerator' in ins or 'CallDirect' in ins:
                # Raw numeric references are not by themselves verified target IDs.
                quoted = re.sub(r'"[^"\\]*"', '', ins)
                ids = [int(v) for v in re.findall(r'(?<![A-Za-z0-9])#?(\d{4,6})(?![A-Za-z0-9])', quoted)]
                for v in ids:
                    if v not in slot['candidate_closure_refs'] and len(slot['candidate_closure_refs']) < 50:
                        slot['candidate_closure_refs'].append(v)
        # Optional literal label occurrences. Only inspect textual disassembly lines,
        # not arbitrary long binary dumps, and keep counts (not private context).
        if inst and labels:
            folded = line.casefold()
            for label in labels:
                if f'"{label.casefold()}"' in folded or f"'{label.casefold()}'" in folded:
                    p = result['catalog_string_matches'][label]
                    p['occurrences'] += 1
                    if cur is not None and cur not in p['function_ids'] and len(p['function_ids']) < 20:
                        p['function_ids'].append(cur)
                    if len(p['example_line_numbers']) < 5:
                        p['example_line_numbers'].append(n)
    result['source_sha256'] = sha.hexdigest()
    result['target_found_count'] = len(result['selected_functions'])
    result['target_requested_count'] = len(targets)
    result['catalog_labels_found_count'] = sum(x['occurrences'] > 0 for x in result['catalog_string_matches'].values())
    return result


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', required=True, type=Path, help='Existing locally authorized hermes-dec .hasm file')
    p.add_argument('--profile', choices=['modyfy','wrapr'], required=True)
    p.add_argument('--catalog', type=Path, help='Observed Modyfy labels CSV, optional')
    p.add_argument('--function-ids', help='Extra numeric function IDs separated by commas')
    p.add_argument('--output', type=Path, required=True, help='Private, local JSON report path')
    args = p.parse_args()
    ids = set(TARGETS[args.profile])
    if args.function_ids:
        try: ids.update(int(x.strip()) for x in args.function_ids.split(','))
        except ValueError as e: p.error('function IDs must be decimal integers')
    labels = load_labels(args.catalog)
    report = scan(args.input, args.profile, labels, ids)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Contain output locally. This is not a safe-by-design permission bypass.
    with args.output.open('w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2, sort_keys=True)
    print(json.dumps({'source_sha256':report['source_sha256'],
                      'target_found': report['target_found_count'],
                      'target_requested':report['target_requested_count'],
                      'labels_found':report['catalog_labels_found_count'],
                      'report_filename':args.output.name},ensure_ascii=False))

if __name__ == '__main__': main()
