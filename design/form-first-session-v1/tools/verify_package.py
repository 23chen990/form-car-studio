"""Read-only verification for the committed UX reference package (standard library only)."""
from pathlib import Path, PurePosixPath
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]

def verify() -> dict:
    manifest = json.loads((ROOT / 'MANIFEST.json').read_text())
    assert manifest['kind'] == 'FORM_FIRST_SESSION_DESIGN', 'Wrong package'
    paths = set()
    for entry in manifest['files']:
        name = entry['path']
        rel = PurePosixPath(name)
        assert not rel.is_absolute() and '..' not in rel.parts, 'Unsafe path'
        assert name not in paths, 'Duplicate path'
        paths.add(name)
        path = ROOT / name
        assert path.is_file() and not path.is_symlink(), f'Missing/unsafe: {name}'
        data = path.read_bytes()
        assert len(data) == entry['bytes'], f'Size mismatch: {name}'
        assert hashlib.sha256(data).hexdigest() == entry['sha256'], f'Hash mismatch: {name}'
    sources = json.loads((ROOT / 'sources.json').read_text())['sources']
    assert len(sources) == 14 and len({s['id'] for s in sources}) == 14
    copy = json.loads((ROOT / 'copy.en.json').read_text())['messages']
    assert len(copy) == 80 and all(isinstance(x,str) and x for x in copy.values())
    result = json.loads((ROOT / 'evidence/browser-results.json').read_text())
    assert result['passed'] == 30 and result['failed'] == 0
    assert all(c['status'] == 'PASS' for c in result['cases'])
    assert not result['jsErrors']
    assert not [u for u in result['networkRequests'] if u.startswith(('http:', 'https:'))]
    return {'status':'BYTES_MATCH_NOT_RELEASE_APPROVAL','files':len(paths),'sourceRecords':14,'copyEntries':80}

if __name__ == '__main__':
    print(json.dumps(verify(), indent=2))
