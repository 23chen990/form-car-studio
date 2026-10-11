#!/usr/bin/env python3
"""Evidence-shape/hash checks only. This never authorizes publication or verifies legal truth."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from guard import GuardError, require, safe_relative
GATES={f'G{i:02}' for i in range(1,15)}
KINDS={'G01':'scope','G02':'migration','G03':'security','G04':'ledger','G05':'recovery','G06':'live_quality','G07':'real_device','G08':'storekit','G09':'privacy','G10':'licenses','G11':'storefront','G12':'economics','G13':'operations','G14':'owner_review'}
def verify(data: dict, root: Path) -> dict:
    require(isinstance(data,dict) and data.get('specVersion')=='2.2','Wrong release spec')
    commit=data.get('candidateCodeCommit')
    require(isinstance(commit,str) and re.fullmatch('[a-f0-9]{40}',commit),'Candidate code commit required')
    gates=data.get('gates')
    require(isinstance(gates,list) and len(gates)==14,'All14 gates required')
    ids=[g.get('id') for g in gates if isinstance(g,dict)]
    require(len(ids)==len(set(ids))==14 and set(ids)==GATES,'Wrong/duplicate gate IDs')
    for gate in gates:
        require(gate.get('status')=='VERIFIED',f"Gate not verified: {gate['id']}")
        require(gate.get('kind')==KINDS[gate['id']],'Evidence category mismatch')
        require(gate.get('codeCommit')==commit,'Evidence applies to a different build')
        reviewer=gate.get('reviewer')
        require(isinstance(reviewer,str) and reviewer.strip() and reviewer.strip() not in {'TBD','self','unknown'},'Named reviewer required')
        rel=gate.get('evidencePath');expected=gate.get('sha256')
        require(isinstance(rel,str) and safe_relative(rel),'Unsafe evidence path')
        path=root/rel
        require(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(root.resolve()),'Evidence missing or outside root')
        require(isinstance(expected,str) and re.fullmatch('[a-f0-9]{64}',expected),'Expected evidence hash required')
        require(hashlib.sha256(path.read_bytes()).hexdigest()==expected,'Evidence hash mismatch')
    require(data.get('independentReview') is True,'Independent review still pending')
    return {'status':'EVIDENCE_COMPLETE_PENDING_OWNER_ACTION','gates':14,'releaseAuthorizedByThisTool':False,
            'warning':'These records are not independently authenticated; a named reviewer and owner must verify truth and grant release authority.'}
def main()->int:
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('file',type=Path);p.add_argument('--root',type=Path,default=Path.cwd());args=p.parse_args()
    try:
        result=verify(json.loads(args.file.read_text(encoding='utf-8')),args.root);print(json.dumps(result,indent=2));return 0
    except (GuardError,OSError,ValueError,KeyError) as exc:
        print(json.dumps({'status':'RELEASE_BLOCKED','reason':str(exc)}),file=sys.stderr);return 2
if __name__=='__main__':raise SystemExit(main())
