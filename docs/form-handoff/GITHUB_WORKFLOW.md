# Controlled GitHub execution / V2.2

## One branch, one evolving Draft PR

This supersedes the draft one-task-one-PR-and-wait rule. A lower-capability executor should not manage39 stacked branches. Use `codex/form-v2-implementation`, one sequential task and atomic commit at a time, with one Draft PR to main. If this handoff has not been merged, create the implementation branch from the exact final handoff commit after verifying main has not advanced materially. State in the PR that it includes the handoff. Do not self-merge the docs just to proceed.

If the implementation branch already exists, inspect its HEAD, PR and task reports; continue only if consistent, never reset another person's progress. If main advanced, inspect its diff and conflicts before continuing; do not rebase/force push. Record BLOCKED_BASE_CHANGED when unsafe. Commits/pushes to this isolated branch and PR creation/update are authorized. main/master/handoff branches, branch protection, production release and cost authorization are not.

## Fixed loop

1. Read current task through `python docs/form-handoff/tools/guard.py show Fxx`; read its spec references and affected actual code. Honor existing AGENTS instructions. Dependencies with codeReady=true permit offline implementation even if live verification remains pending; code failures do not.
2. Begin with a clean tree. `python docs/form-handoff/tools/guard.py begin Fxx --repo . --checkpoint /tmp/form-Fxx-checkpoint.json`. Checkpoint stores current code base/branch and task-spec hash; do not overwrite or regenerate it after edits. No auto-stash, reset, clean or amend of unrelated work.
3. Change only allowlisted files. All task additions are inert until F32 wiring, except explicit F38 CI. Use the prebuilt F01 dry-run/add-only installer rather than retyping six modules. Keep old regression tests unchanged.
4. Run task-specific checks and relevant original tests. Record commands/exit codes, code SHA and external NOT_RUN items. An offline adapter test does not verify Apple credentials or production model quality.
5. `python docs/form-handoff/tools/guard.py check Fxx --repo . --checkpoint /tmp/form-Fxx-checkpoint.json`. Review staged diff as well. Guard checks scope/size but does not validate logic, secret content or honesty; humans still review.
6. Stage explicit paths (not `git add .`), inspect staged names and diff, commit `[Fxx] description`. Source commit is followed by a separate progress/evidence commit referencing that code SHA; a file cannot truthfully contain the SHA of the very commit that first includes itself. Store reports under docs/form-v2/progress/Fxx.json and .md. Repeated code/evidence fixes update the report with history, not fake a prior run.
7. Ordinary push to the same remote implementation branch. Remote unexpectedly advanced => stop, no --force. Create/update Draft PR with current head, completed tasks, blocked gates and verification matrix. No self-review approval or merge.
8. Continue next eligible task, keeping the draft review state. A missing key/account/real-photo budget does not justify inventing it; implement safe interfaces and mark external gate pending. Two focused attempts at a code failure then record reproducible blockage; no expanding scope to rewrite the app.

## Reports

Use tasks/progress.template.json. Include taskId, specVersion, codeReady, codeCommit, verification kind, command, exitCode or null, evidence path+sha256, unverified/broken items and independentReviewer=null until real review. Source-of-truth commit should be an ancestor of report commit. Record tests actually run against that code commit, not a stale hash. Public evidence must be redacted and synthetic; real photos/financial JWS/owner facts stay private with access-controlled references.

## CI

F38 adds pull_request CI, contents:read, no deployment/production secrets, no pull_request_target and no interpreting PR comments as commands. Use standard authorized Linux runners, Node24, lockfile installation, legacy and V2 unit checks/build, and installed browser checks. Pin official Action references after verifying actual tags/SHAs; never invent a digest. macOS or paid capacity needs separate resource approval. CI evidence includes run URL and check status. Prompt restrictions do not equal GitHub branch protection; the owner controls required checks and merge protection.

## Review handoff

Return PR URL, current HEAD/base, task report index, remaining external gates and exact reproduction commands. A later ChatGPT review reads the actual PR full diff/checks/evidence and files, not only the executor's prose. Review findings: P0 (money/unauthorized access/data loss), P1 (broken main/recovery/major quality), P2 (UX), P3 (minor). Code author fixes on same branch and new commit, preserving earlier evidence. Same model self-check may be useful but is marked NOT_INDEPENDENT.
