#!/usr/bin/env python3
"""Local accident checks, NOT an authorization/security boundary. Never pushes or resets."""
from __future__ import annotations
import argparse
import fnmatch
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

HOME = Path(__file__).resolve().parents[1]
CONFIG = HOME / 'tasks' / 'tasks.json'
REPO_NAME = '23chen990/form-car-studio'

class GuardError(ValueError):
    pass

def require(ok: object, message: str) -> None:
    if not ok:
        raise GuardError(message)

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def load_config(path: Path = CONFIG) -> dict:
    data = json.loads(path.read_text(encoding='utf-8'))
    validate_config(data)
    return data

def validate_config(data: dict) -> None:
    require(isinstance(data, dict) and data.get('specVersion') == '2.2', 'Wrong spec version')
    tasks = data.get('tasks')
    require(isinstance(tasks, list) and tasks, 'Tasks missing')
    ids = [x.get('id') for x in tasks if isinstance(x, dict)]
    require(len(ids) == len(tasks) == len(set(ids)), 'Duplicate/invalid tasks')
    require(all(isinstance(x, str) and re.fullmatch(r'F\d{2}', x) for x in ids), 'Invalid task ID')
    by_id = {t['id']: t for t in tasks}
    for t in tasks:
        require(isinstance(t.get('depends'), list), 'Dependencies required')
        require(all(d in by_id and d != t['id'] for d in t['depends']), 'Unknown/self dependency')
        require(isinstance(t.get('allow'), list) and bool(t['allow']), 'No allowlist')
        for p in t['allow']:
            require(isinstance(p, str) and safe_relative(p), 'Unsafe allow path')
        require(type(t.get('maxFiles')) is int and t['maxFiles'] > 0, 'Invalid maxFiles')
        require(type(t.get('maxLines')) is int and t['maxLines'] > 0, 'Invalid maxLines')
        require(isinstance(t.get('binaryAllow', []), list) and all(isinstance(p, str) and safe_relative(p) for p in t.get('binaryAllow', [])), 'Invalid binary scope')
        require(not t.get('binaryAllow') or (t['id'] in ('F18','F31') and type(t.get('maxBinaryBytes')) is int and t['maxBinaryBytes'] > 0), 'Binary budget/task invalid')
        require(isinstance(t.get('acceptance'), list) and len(t['acceptance']) >= 4, 'Acceptance criteria missing')
    active, done = set(), set()
    def visit(tid: str) -> None:
        require(tid not in active, 'Dependency cycle')
        if tid in done:
            return
        active.add(tid)
        for dep in by_id[tid]['depends']:
            visit(dep)
        active.remove(tid)
        done.add(tid)
    for tid in by_id:
        visit(tid)

def safe_relative(text: str) -> bool:
    p = PurePosixPath(text)
    return bool(text) and not p.is_absolute() and '..' not in p.parts and '\\' not in text and '\x00' not in text and '\n' not in text and '\r' not in text and not text.startswith('-')

def check_paths(task: dict, paths: list[str], lines: int, deleted: list[str] | None = None) -> None:
    require(type(lines) is int and lines >= 0, 'Invalid changed line count')
    require(len(set(paths)) <= task['maxFiles'], 'Too many changed files; split or request a spec revision')
    require(lines <= task['maxLines'], 'Change budget exceeded; do not hide/squash the diff')
    require(not deleted or task.get('allowDelete') is True, 'Deletion not authorized by this task')
    allow = task['allow'] + [f"docs/form-v2/progress/{task['id']}.json", f"docs/form-v2/progress/{task['id']}.md"]
    for text in paths:
        require(safe_relative(text), 'Unsafe changed path')
        parts = PurePosixPath(text).parts
        lower = text.lower()
        sensitive = any(x in parts for x in ('.git', 'node_modules', '.form-private', 'data', 'data-live'))
        sensitive |= PurePosixPath(text).name.startswith('.env') and not (text == '.env.example' and task['id'] == 'F27')
        sensitive |= any(PurePosixPath(text).name == x for x in ('id_rsa', 'id_ed25519'))
        sensitive |= lower.endswith(('.p8', '.p12', '.mobileprovision', '.sqlite', '.sqlite-wal', '.sqlite-shm', '.db'))
        require(not sensitive, 'Sensitive/runtime path cannot be committed')
        require(not lower.startswith('.github/workflows/') or task['id'] == 'F38', 'Workflow changes belong to F38')
        require(any(fnmatch.fnmatchcase(text, pattern) for pattern in allow), f'Out-of-scope path: {text}')

def git(repo: Path, *args: str) -> bytes:
    r = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, check=False)
    require(r.returncode == 0, 'Git read failed: ' + ' '.join(args[:2]))
    return r.stdout

def repository(repo: Path) -> tuple[Path, str]:
    root = Path(git(repo, 'rev-parse', '--show-toplevel').decode().strip()).resolve()
    branch = git(root, 'symbolic-ref', '--short', 'HEAD').decode().strip()
    require(branch.startswith('codex/form-'), 'Work only on an authorized codex/form-* branch')
    origin = git(root, 'remote', 'get-url', 'origin').decode().strip()
    allowed = {f'https://github.com/{REPO_NAME}.git', f'https://github.com/{REPO_NAME}', f'git@github.com:{REPO_NAME}.git'}
    require(origin in allowed, 'Wrong origin or URL with embedded credentials')
    return root, branch

def task_for(data: dict, task_id: str) -> dict:
    found = [t for t in data['tasks'] if t['id'] == task_id]
    require(len(found) == 1, 'Unknown task')
    return found[0]

def begin(repo: Path, task: dict, checkpoint: Path, config: Path = CONFIG) -> dict:
    root, branch = repository(repo)
    require(not git(root, 'status', '--porcelain'), 'Worktree must be clean; do not auto-stash or reset')
    require(not checkpoint.exists(), 'Checkpoint exists; never overwrite it')
    require(not checkpoint.resolve().is_relative_to(root), 'Checkpoint must be outside the repository')
    for dep in task['depends']:
        path = root / 'docs' / 'form-v2' / 'progress' / f'{dep}.json'
        require(path.is_file() and not path.is_symlink(), f'Missing dependency report: {dep}')
        report = json.loads(path.read_text(encoding='utf-8'))
        require(report.get('taskId') == dep and report.get('codeReady') is True, f'Dependency not code-ready: {dep}')
        commit = report.get('codeCommit')
        require(isinstance(commit, str) and re.fullmatch('[a-f0-9]{40}', commit), 'Bad dependency code SHA')
        git(root, 'merge-base', '--is-ancestor', commit, 'HEAD')
    result = {'taskId': task['id'], 'repo': str(root), 'branch': branch,
              'base': git(root, 'rev-parse', 'HEAD').decode().strip(), 'configSha256': sha(config)}
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    with checkpoint.open('x', encoding='utf-8') as f:
        json.dump(result, f, indent=2)
    return result

def check(repo: Path, task: dict, checkpoint: Path, config: Path = CONFIG) -> dict:
    root, branch = repository(repo)
    cp = json.loads(checkpoint.read_text(encoding='utf-8'))
    require(cp.get('repo') == str(root) and cp.get('branch') == branch and cp.get('taskId') == task['id'], 'Checkpoint identity mismatch')
    require(cp.get('configSha256') == sha(config), 'Frozen task specification changed')
    base = cp.get('base')
    require(isinstance(base, str) and re.fullmatch('[a-f0-9]{40}', base), 'Invalid checkpoint commit')
    git(root, 'merge-base', '--is-ancestor', base, 'HEAD')
    split = lambda b: [s.decode('utf-8') for s in b.split(b'\0') if s]
    tracked = split(git(root, 'diff', '--no-renames', '--name-only', '-z', base, '--'))
    new = split(git(root, 'ls-files', '--others', '--exclude-standard', '-z'))
    deleted = split(git(root, 'diff', '--no-renames', '--diff-filter=D', '--name-only', '-z', base, '--'))
    paths = sorted(set(tracked + new))
    count = 0
    binary_paths = set()
    for line in git(root, 'diff', '--no-renames', '--numstat', base, '--').decode('utf-8').splitlines():
        fields = line.split('\t', 2)
        require(len(fields) == 3, 'Invalid numstat')
        if fields[0] == fields[1] == '-':
            binary_paths.add(fields[2])
        else:
            require(fields[0].isdigit() and fields[1].isdigit(), 'Invalid numstat count')
            count += int(fields[0]) + int(fields[1])
    for text in paths:
        require(safe_relative(text), 'Unsafe git path')
        path = root / text
        require(not path.is_symlink(), 'Symlink changes forbidden')
        require(path.resolve().is_relative_to(root), 'Path escapes repository')
        if text in new:
            require(path.is_file(), 'Untracked path is not a regular file')
            try:
                value = path.read_text(encoding='utf-8')
                if '\x00' in value:
                    raise UnicodeError('NUL binary marker')
            except UnicodeError:
                binary_paths.add(text)
            else:
                count += len(value.splitlines())
    binary_bytes = 0
    for text in binary_paths:
        require(task['id'] in ('F18','F31') and any(fnmatch.fnmatchcase(text, p) for p in task.get('binaryAllow', [])), 'Binary asset not in approved asset task scope')
        require((root / text).is_file(), 'Binary deletion forbidden')
        binary_bytes += (root / text).stat().st_size
    require(binary_bytes <= task.get('maxBinaryBytes', 0), 'Binary byte budget exceeded')
    check_paths(task, paths, count, deleted)
    return {'status':'SCOPE_CHECK_PASSED_NOT_A_CODE_REVIEW', 'taskId':task['id'], 'base':base,
            'head':git(root,'rev-parse','HEAD').decode().strip(), 'paths':paths,'changedLines':count,'binaryBytes':binary_bytes}

def verify_manifest(root: Path, manifest: Path) -> dict:
    data = json.loads(manifest.read_text(encoding='utf-8'))
    require(isinstance(data, dict) and isinstance(data.get('files'), dict), 'Invalid manifest')
    for rel, expected in data['files'].items():
        require(safe_relative(rel), 'Unsafe manifest entry')
        path = root / rel
        require(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(root.resolve()), 'Manifest file missing/unsafe')
        require(isinstance(expected, str) and re.fullmatch('[a-f0-9]{64}', expected), 'Invalid expected hash')
        require(sha(path) == expected, f'Hash mismatch: {rel}')
    return {'status':'CONTENT_HASHES_MATCH_NOT_AUTHENTICATED', 'files':len(data['files'])}

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['validate','show','begin','check','verify-manifest'])
    p.add_argument('task', nargs='?')
    p.add_argument('--repo', type=Path, default=Path.cwd())
    p.add_argument('--checkpoint', type=Path)
    p.add_argument('--config', type=Path, default=CONFIG)
    p.add_argument('--manifest', type=Path)
    args = p.parse_args()
    try:
        if args.command == 'verify-manifest':
            require(args.manifest is not None, '--manifest required')
            output = verify_manifest(args.repo, args.manifest)
        else:
            data=load_config(args.config)
            if args.command == 'validate': output={'status':'TASK_GRAPH_VALID','tasks':len(data['tasks'])}
            else:
                task=task_for(data,args.task)
                if args.command == 'show': output=task
                else:
                    require(args.checkpoint is not None,'--checkpoint required')
                    output=(begin if args.command=='begin' else check)(args.repo,task,args.checkpoint,args.config)
        print(json.dumps(output,ensure_ascii=False,indent=2));return 0
    except (GuardError,OSError,ValueError,KeyError) as exc:
        print(json.dumps({'status':'BLOCKED','reason':str(exc)},ensure_ascii=False),file=sys.stderr);return 2

if __name__=='__main__':raise SystemExit(main())
