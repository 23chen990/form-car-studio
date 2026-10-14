import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = join(root, 'tools/evaluate-form.mjs');
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, any>;
function run(args: string[], input?: unknown) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    input: input === undefined ? undefined : JSON.stringify(input),
    timeout: 5_000
  });
}
function json(result: ReturnType<typeof run>) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
const reviewed = {
  identity: 'pass',
  targetExecuted: 'pass',
  nonTargetPreserved: 'pass',
  artifacts: 'pass',
  wouldKeep: true
};
const frozenFinalConfig = {
  locked: true,
  candidateId: 'candidate-2',
  providerId: 'synthetic-provider',
  profileVersion: 'synthetic-profile-v1',
  model: 'synthetic-model',
  promptVersion: 'synthetic-prompt-v1',
  promptSha256: 'a'.repeat(64),
  maxCostMicrosUSD: 25_000,
  qualityEvidence: 'synthetic-only',
  lockedAt: '2026-10-14T00:00:00.000Z'
};
const postLockStart = '2026-10-14T00:00:01.000Z';
const lockedAttempt = (attempt: Record<string, unknown>) => ({ ...attempt, startedAt: postLockStart });
const boundHeldout = (record: Record<string, any>): Record<string, any> => ({
  ...record,
  candidateId: frozenFinalConfig.candidateId,
  providerId: frozenFinalConfig.providerId,
  profileVersion: frozenFinalConfig.profileVersion,
  model: frozenFinalConfig.model,
  promptVersion: frozenFinalConfig.promptVersion,
  promptSha256: frozenFinalConfig.promptSha256,
  attemptStartedAt: record.attempts[0]?.startedAt ?? null
});
const syntheticPhotoHash = (slotId: string) => Number(slotId.slice(4)).toString(16).padStart(64, '0');
function withCompleteSyntheticHashMap(heldout: Array<Record<string, any>>) {
  // Synthetic-only hashes complete all 30 slots for overlap tests.
  const development = Array.from({ length: 18 }, (_, i) => ({
    slotId: `CAR-${String(i + 1).padStart(2, '0')}`,
    split: 'development', mode: 'mock', taskClass: 'color_only', outcome: 'unknown',
    firstAttempt: null, attempts: [], assessment: null,
    photoSha256: syntheticPhotoHash(`CAR-${String(i + 1).padStart(2, '0')}`)
  }));
  return [...development, ...heldout.map(row => ({ ...row, photoSha256: syntheticPhotoHash(row.slotId) }))];
}

test('dry run plans 162 development, 54 sequential, and 36 heldout outputs without dispatch', () => {
  const plan = json(run(['--dry-run']));
  assert.deepEqual(plan.phases, {
    development: { photos: 18, tasksPerPhoto: 3, configurations: 3, outputs: 162 },
    sequential: { cars: 6, editsPerCar: 3, configurations: 3, outputs: 54 },
    heldout: { photos: 12, tasksPerPhoto: 3, configurations: 1, outputs: 36, requiresFinalConfigLock: true }
  });
  assert.equal(plan.totalOutputs, 252);
  assert.equal(plan.externalCallsMade, 0);
  assert.equal(plan.paidCallsMade, 0);
  assert.equal(plan.cost.maxCostPerAttemptMicrosUSD, null);
  assert.equal(plan.cost.plannedMaximumExposureMicrosUSD, null);
  assert.equal(plan.cost.retryPolicy, 'UNSET; every retry is a separately recorded attempt');
  assert.equal(plan.capabilityDecision, 'NOT_ASSESSED');
});

test('public registry and profile template contain only empty slots and unselected configurations', () => {
  const registry = readJson('research/form-v2/photo-registry.json');
  assert.equal(registry.status, 'NOT_ACQUIRED');
  assert.equal(registry.slots.length, 30);
  assert.equal(new Set(registry.slots.map((slot: any) => slot.slotId)).size, 30);
  assert.equal(registry.slots.filter((slot: any) => slot.split === 'development').length, 18);
  assert.equal(registry.slots.filter((slot: any) => slot.split === 'heldout').length, 12);
  for (const slot of registry.slots) {
    assert.equal(slot.assetPrivateRef, null);
    assert.equal(slot.sha256, null);
    assert.equal(slot.licensePrivateRef, null);
    assert.equal(slot.consentVerified, false);
    assert.equal(slot.vehicleClass, null);
    assert.equal(slot.viewAngle, null);
    assert.equal(slot.visibleFeatures, null);
  }

  const profiles = readJson('research/form-v2/provider-profiles.template.json');
  assert.equal(profiles.status, 'NOT_CONFIGURED');
  assert.equal(profiles.candidates.length, 3);
  assert.ok(profiles.candidates.every((candidate: any) => candidate.selected === false));
  assert.ok(profiles.candidates.every((candidate: any) => candidate.providerId === null && candidate.profileVersion === null && candidate.promptSha256 === null && candidate.maxCostMicrosUSD === null && candidate.qualityEvidence === null));
  assert.equal(profiles.finalConfig.locked, false);
  assert.equal(profiles.finalConfig.candidateId, null);
});

test('evaluation record starts unrun and retains first attempt, blind fields, and unknown costs as null', () => {
  const record = readJson('research/form-v2/evaluation-record.template.json');
  assert.equal(record.status, 'NOT_RUN');
  assert.equal(record.attempts.length, 0);
  assert.equal(record.firstAttempt, null);
  assert.equal(record.assessment.identity, null);
  assert.equal(record.assessment.targetExecuted, null);
  assert.equal(record.assessment.nonTargetPreserved, null);
  assert.equal(record.assessment.artifacts, null);
  assert.equal(record.assessment.wouldKeep, null);
  assert.equal(record.cost.actualCostMicrosUSD, null);
  assert.equal(record.cost.maxExposureMicrosUSD, null);
  assert.equal(record.outputPrivateRef, null);
  assert.equal(record.outputSha256, null);
  assert.equal(record.candidateId, null);
  assert.equal(record.attemptStartedAt, null);
  assert.equal(record.sequentialDrift.fromImmediateBase, null);
  assert.equal(record.sequentialDrift.fromOriginalBase, null);
  assert.equal(record.overlap.status, 'NOT_CHECKED');
});

test('summary keeps failures, cancellation, retries, and uncertain exposure in live totals', () => {
  const fail20 = { status: 'failed', actualCostMicrosUSD: null, exposureStatus: 'uncertain', maxExposureMicrosUSD: 20 };
  const fail10 = { status: 'failed', actualCostMicrosUSD: null, exposureStatus: 'uncertain', maxExposureMicrosUSD: 10 };
  const success8 = { status: 'succeeded', actualCostMicrosUSD: 8, exposureStatus: 'settled', maxExposureMicrosUSD: 10 };
  const unknownCost = { status: 'uncertain', actualCostMicrosUSD: null, exposureStatus: 'uncertain', maxExposureMicrosUSD: null };
  const records = [
    { slotId: 'CAR-01', split: 'development', mode: 'live', taskClass: 'color_only', outcome: 'failed', firstAttempt: fail20, attempts: [fail20], assessment: null },
    { slotId: 'CAR-02', split: 'development', mode: 'live', taskClass: 'color_only', outcome: 'succeeded', attempts: [
      fail10,
      success8
    ], firstAttempt: fail10, assessment: reviewed },
    { slotId: 'CAR-03', split: 'development', mode: 'live', taskClass: 'single_detail', outcome: 'unknown', firstAttempt: unknownCost, attempts: [unknownCost], assessment: null },
    { slotId: 'CAR-06', split: 'development', mode: 'live', taskClass: 'single_detail', outcome: 'cancelled', firstAttempt: null, attempts: [], assessment: null },
    { slotId: 'CAR-04', split: 'development', mode: 'demo', taskClass: 'color_only', outcome: 'succeeded', firstAttempt: { status: 'succeeded', actualCostMicrosUSD: 900, exposureStatus: 'settled', maxExposureMicrosUSD: 900 }, attempts: [{ status: 'succeeded', actualCostMicrosUSD: 900, exposureStatus: 'settled', maxExposureMicrosUSD: 900 }], assessment: reviewed },
    { slotId: 'CAR-05', split: 'development', mode: 'mock', taskClass: 'color_only', outcome: 'succeeded', firstAttempt: { status: 'succeeded', actualCostMicrosUSD: 700, exposureStatus: 'settled', maxExposureMicrosUSD: 700 }, attempts: [{ status: 'succeeded', actualCostMicrosUSD: 700, exposureStatus: 'settled', maxExposureMicrosUSD: 700 }], assessment: reviewed }
  ];
  const summary = json(run(['--summary'], { records }));
  assert.equal(summary.live.requestedOutputs, 4);
  assert.equal(summary.live.deliveredOutputs, 1);
  assert.equal(summary.live.failedOutputs, 1);
  assert.equal(summary.live.cancelledOutputs, 1);
  assert.equal(summary.live.unknownOutcomes, 1);
  assert.equal(summary.live.attempts, 4);
  assert.equal(summary.live.retries, 1);
  assert.equal(summary.live.failedAttempts, 2);
  assert.equal(summary.live.uncertainAttempts, 1);
  assert.equal(summary.live.assessedOutputs, 1);
  assert.equal(summary.live.usableOutputs, 1);
  assert.equal(summary.live.usableYield, 1 / 4);
  assert.equal(summary.live.usableAmongAssessed, 1);
  assert.equal(summary.excludedDemoMockOutputs, 2);
  assert.equal(summary.cost.knownSettledMicrosUSD, 8);
  assert.equal(summary.cost.knownOpenExposureMicrosUSD, 30);
  assert.equal(summary.cost.unknownOpenExposureAttempts, 1);
  assert.equal(summary.cost.totalLiabilityMicrosUSD, null);
});

test('summary refuses to replace the recorded first attempt with a later result', () => {
  const mismatch = run(['--summary'], { records: [{
    slotId: 'CAR-01', split: 'development', mode: 'live', taskClass: 'color_only', outcome: 'succeeded',
    firstAttempt: { status: 'succeeded', actualCostMicrosUSD: 8, exposureStatus: 'settled', maxExposureMicrosUSD: 10 },
    attempts: [
      { status: 'failed', actualCostMicrosUSD: null, exposureStatus: 'uncertain', maxExposureMicrosUSD: 10 },
      { status: 'succeeded', actualCostMicrosUSD: 8, exposureStatus: 'settled', maxExposureMicrosUSD: 10 }
    ],
    assessment: reviewed
  }] });
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /first attempt/i);
});

test('cost accounting rejects contradictory exposure and unsafe integer sums', () => {
  const recordFor = (attempt: Record<string, unknown>, slotId = 'CAR-01') => ({
    slotId, split: 'development', mode: 'live', taskClass: 'color_only', outcome: attempt.status === 'failed' ? 'failed' : attempt.status === 'uncertain' ? 'unknown' : 'succeeded',
    firstAttempt: attempt, attempts: [attempt], assessment: null
  });
  const invalid = [
    { status: 'succeeded', actualCostMicrosUSD: 1, exposureStatus: 'not_exposed', maxExposureMicrosUSD: 0 }
  ];
  for (const attempt of invalid) {
    const result = run(['--summary'], { records: [recordFor(attempt)] });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cost|exposure/i);
  }
  const overCeiling = json(run(['--summary'], { records: [recordFor({ status: 'succeeded', actualCostMicrosUSD: 11, exposureStatus: 'settled', maxExposureMicrosUSD: 10 })] }));
  assert.equal(overCeiling.cost.knownSettledMicrosUSD, 11);
  assert.equal(overCeiling.cost.overCeilingAttempts, 1);
  assert.equal(overCeiling.cost.overCeilingMicrosUSD, 1);
  assert.equal(overCeiling.cost.newTaskRecommendation, 'PAUSE');
  const knownUncertain = json(run(['--summary'], { records: [recordFor({ status: 'uncertain', actualCostMicrosUSD: 15, exposureStatus: 'uncertain', maxExposureMicrosUSD: 10 })] }));
  assert.equal(knownUncertain.cost.knownOpenExposureMicrosUSD, 15);
  assert.equal(knownUncertain.cost.overCeilingMicrosUSD, 5);
  assert.equal(knownUncertain.cost.totalLiabilityMicrosUSD, 15);
  const max = Number.MAX_SAFE_INTEGER;
  const overflowCases = [
    [recordFor({ status: 'succeeded', actualCostMicrosUSD: max, exposureStatus: 'settled', maxExposureMicrosUSD: max }), recordFor({ status: 'succeeded', actualCostMicrosUSD: max, exposureStatus: 'settled', maxExposureMicrosUSD: max }, 'CAR-02')],
    [recordFor({ status: 'failed', actualCostMicrosUSD: null, exposureStatus: 'uncertain', maxExposureMicrosUSD: max }), recordFor({ status: 'failed', actualCostMicrosUSD: null, exposureStatus: 'uncertain', maxExposureMicrosUSD: max }, 'CAR-02')],
    [recordFor({ status: 'succeeded', actualCostMicrosUSD: max, exposureStatus: 'settled', maxExposureMicrosUSD: max }), recordFor({ status: 'failed', actualCostMicrosUSD: null, exposureStatus: 'uncertain', maxExposureMicrosUSD: 1 }, 'CAR-02')]
  ];
  for (const records of overflowCases) {
    const result = run(['--summary'], { records });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /safe integer/i);
  }
});

test('holdout records require a locked final configuration and disclose selection contamination', () => {
  const heldoutAttempt = lockedAttempt({ status: 'succeeded', actualCostMicrosUSD: 12, exposureStatus: 'settled', maxExposureMicrosUSD: 20 });
  const heldout = boundHeldout({ slotId: 'CAR-19', split: 'heldout', mode: 'live', taskClass: 'color_only', outcome: 'succeeded', firstAttempt: heldoutAttempt, attempts: [heldoutAttempt], assessment: reviewed });
  const unlocked = run(['--summary'], { finalConfig: { locked: false }, holdoutUsedForSelection: false, records: [heldout] });
  assert.notEqual(unlocked.status, 0);
  assert.match(unlocked.stderr, /final configuration/i);

  const contaminated = json(run(['--summary'], { finalConfig: frozenFinalConfig, holdoutUsedForSelection: true, overlap: { status: 'NOT_CHECKED', count: null }, records: [heldout] }));
  assert.equal(contaminated.holdout.contaminated, true);
  assert.equal(contaminated.holdout.freshSetRequired, true);
  assert.equal(contaminated.holdout.missingOutputs, 35);
  assert.equal(contaminated.holdout.unknownOutcomes, 35);
  assert.equal(contaminated.holdout.identityUnknown, 35);
  assert.equal(contaminated.holdout.usableYield, 1 / 36);
  assert.equal(contaminated.capabilityDecision, 'KEEP_DISABLED');
  assert.equal(contaminated.overlap.status, 'NOT_CHECKED');
  assert.equal(contaminated.overlap.count, null);
});

test('heldout outputs must match every locked config field and start after its lock time', () => {
  const attempt = lockedAttempt({ status: 'succeeded', actualCostMicrosUSD: 12, exposureStatus: 'settled', maxExposureMicrosUSD: 20 });
  const base = boundHeldout({ slotId: 'CAR-19', split: 'heldout', mode: 'live', taskClass: 'color_only', outcome: 'succeeded', firstAttempt: attempt, attempts: [attempt], assessment: reviewed });
  const mismatches = [
    ['candidateId', 'candidate-1'], ['providerId', 'other-provider'], ['profileVersion', 'other-profile'],
    ['model', 'other-model'], ['promptVersion', 'other-prompt'], ['promptSha256', 'c'.repeat(64)]
  ];
  for (const [key, value] of mismatches) {
    const result = run(['--summary'], { finalConfig: frozenFinalConfig, records: [{ ...base, [key]: value }] });
    assert.notEqual(result.status, 0, `${key} mismatch was accepted`);
    assert.match(result.stderr, /locked final configuration/i);
  }
  const earlyAttempt = { ...attempt, startedAt: frozenFinalConfig.lockedAt };
  const tooEarly = { ...base, firstAttempt: earlyAttempt, attempts: [earlyAttempt], attemptStartedAt: earlyAttempt.startedAt };
  const result = run(['--summary'], { finalConfig: frozenFinalConfig, records: [tooEarly] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /after.*lock/i);
  const retry = { ...attempt, status: 'failed', actualCostMicrosUSD: null, exposureStatus: 'uncertain' };
  const earlyRetry = { ...attempt, startedAt: frozenFinalConfig.lockedAt };
  const badRetry = boundHeldout({ ...base, outcome: 'succeeded', firstAttempt: retry, attempts: [retry, earlyRetry] });
  const retryResult = run(['--summary'], { finalConfig: frozenFinalConfig, records: [badRetry] });
  assert.notEqual(retryResult.status, 0);
  assert.match(retryResult.stderr, /after.*lock/i);
});

test('cross-split photo overlap is reported without exposing the private content hash', () => {
  const sharedPhotoHash = 'b'.repeat(64);
  const attempt = { status: 'succeeded', actualCostMicrosUSD: 12, exposureStatus: 'settled', maxExposureMicrosUSD: 20 };
  const records = [
    { slotId: 'CAR-01', split: 'development', mode: 'live', taskClass: 'color_only', outcome: 'succeeded', photoSha256: sharedPhotoHash, firstAttempt: attempt, attempts: [attempt], assessment: reviewed },
    boundHeldout({ slotId: 'CAR-19', split: 'heldout', mode: 'live', taskClass: 'color_only', outcome: 'succeeded', photoSha256: sharedPhotoHash, firstAttempt: lockedAttempt(attempt), attempts: [lockedAttempt(attempt)], assessment: reviewed })
  ];
  const summary = json(run(['--summary'], { finalConfig: frozenFinalConfig, holdoutUsedForSelection: false, overlap: { status: 'CHECKED_NO_OVERLAP', count: 0 }, records }));
  assert.deepEqual(summary.overlap, { status: 'OVERLAP_DETECTED', count: 1 });
  assert.equal(summary.holdout.contaminated, true);
  assert.equal(summary.holdout.freshSetRequired, true);
  assert.equal(summary.overlap.status, 'OVERLAP_DETECTED');
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(sharedPhotoHash));
});

test('a no-overlap claim requires the complete 30-slot hash map', () => {
  const attempt = lockedAttempt({ status: 'succeeded', actualCostMicrosUSD: 12, exposureStatus: 'settled', maxExposureMicrosUSD: 20 });
  const heldout = boundHeldout({ slotId: 'CAR-19', split: 'heldout', mode: 'live', taskClass: 'color_only', outcome: 'succeeded', firstAttempt: attempt, attempts: [attempt], assessment: reviewed });
  const claim = { status: 'CHECKED_NO_OVERLAP', count: 0 };
  const none = json(run(['--summary'], { finalConfig: frozenFinalConfig, holdoutUsedForSelection: false, overlap: claim, records: [heldout] }));
  assert.deepEqual(none.overlap, { status: 'NOT_CHECKED', count: null });
  assert.equal(none.capabilityDecision, 'KEEP_DISABLED');
  const partial = json(run(['--summary'], { finalConfig: frozenFinalConfig, holdoutUsedForSelection: false, overlap: claim, records: [heldout, { slotId: 'CAR-01', split: 'development', mode: 'mock', taskClass: 'color_only', outcome: 'unknown', photoSha256: syntheticPhotoHash('CAR-01'), firstAttempt: null, attempts: [], assessment: null }] }));
  assert.deepEqual(partial.overlap, { status: 'PARTIAL_HASHES', count: null });
});

test('blind assessment packet omits profile and prompt labels while preserving rubric fields', () => {
  const result = json(run(['--blind-packet'], { records: [{
    blindOutputId: 'blind-001',
    slotId: 'CAR-01',
    mode: 'live',
    providerId: 'PRIVATE_PROVIDER_LABEL',
    profileVersion: 'PRIVATE_PROFILE_VERSION',
    model: 'PRIVATE_MODEL_LABEL',
    promptVersion: 'PRIVATE_PROMPT_VERSION',
    promptSha256: 'a'.repeat(64),
    firstAttempt: { status: 'failed' },
    assessment: reviewed
  }] }));
  assert.equal(result.cards.length, 1);
  assert.deepEqual(result.cards[0], {
    blindOutputId: 'blind-001',
    rubric: ['identity', 'targetExecuted', 'nonTargetPreserved', 'artifacts', 'wouldKeep']
  });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_LABEL|PRIVATE_PROFILE_VERSION|PRIVATE_MODEL_LABEL|PRIVATE_PROMPT_VERSION/);
});

test('quality result is never an automatic publication decision', () => {
  const taskClasses = ['color_only', 'supported_style', 'single_detail'];
  const records = Array.from({ length: 36 }, (_, i) => {
    const attempt = lockedAttempt({ status: 'succeeded', actualCostMicrosUSD: 10, exposureStatus: 'settled', maxExposureMicrosUSD: 20 });
    return boundHeldout({ slotId: `CAR-${19 + (i % 12)}`, split: 'heldout', mode: 'live', taskClass: taskClasses[Math.floor(i / 12)], vehicleClass: 'synthetic-class', outcome: 'succeeded', firstAttempt: attempt, attempts: [attempt], assessment: reviewed });
  });
  const summary = json(run(['--summary'], { finalConfig: frozenFinalConfig, holdoutUsedForSelection: false, overlap: { status: 'CHECKED_NO_OVERLAP', count: 0 }, records: withCompleteSyntheticHashMap(records) }));
  assert.equal(summary.capabilityDecision, 'ELIGIBLE_FOR_OWNER_REVIEW');
  assert.notEqual(summary.capabilityDecision, 'PUBLISH');
  assert.equal(summary.holdout.requestedOutputs, 36);
  assert.equal(summary.holdout.completeCoverage, true);
  assert.equal(summary.holdout.identityUnknown, 0);
  assert.deepEqual(summary.overlap, { status: 'CHECKED_NO_OVERLAP', count: 0 });
  assert.equal(summary.holdout.byTaskClass.color_only.requestedOutputs, 12);
  assert.ok(summary.holdout.byTaskClass.color_only.usableAmongAssessedWilson95.lower > 0);
});

test('duplicate heldout slot-task pairs cannot satisfy complete coverage', () => {
  const taskClasses = ['color_only', 'supported_style', 'single_detail'];
  const records = Array.from({ length: 36 }, (_, i) => {
    const attempt = lockedAttempt({ status: 'succeeded', actualCostMicrosUSD: 10, exposureStatus: 'settled', maxExposureMicrosUSD: 20 });
    return boundHeldout({ slotId: `CAR-${19 + (i % 12)}`, split: 'heldout', mode: 'live', taskClass: taskClasses[Math.floor(i / 12)], outcome: 'succeeded', firstAttempt: attempt, attempts: [attempt], assessment: reviewed });
  });
  records[1].slotId = records[0].slotId;
  const summary = json(run(['--summary'], { finalConfig: frozenFinalConfig, holdoutUsedForSelection: false, overlap: { status: 'CHECKED_NO_OVERLAP', count: 0 }, records }));
  assert.equal(summary.holdout.completeCoverage, false);
  assert.equal(summary.holdout.duplicateSlotTaskPairs, 1);
  assert.equal(summary.holdout.missingOutputs, 1);
  assert.equal(summary.holdout.usableYield, 35 / 36);
  assert.equal(summary.holdout.byVehicleClass.unknown.requestedOutputs, 35);
  assert.equal(summary.capabilityDecision, 'KEEP_DISABLED');
});

test('quality gate uses the stated 90 percent floor and blocks unresolved identity failures', () => {
  const taskClasses = ['color_only', 'supported_style', 'single_detail'];
  const records = Array.from({ length: 36 }, (_, i) => {
    const attempt = lockedAttempt({ status: 'succeeded', actualCostMicrosUSD: 10, exposureStatus: 'settled', maxExposureMicrosUSD: 20 });
    const assessment = i < 34 ? reviewed : { ...reviewed, artifacts: 'fail', wouldKeep: false };
    return boundHeldout({ slotId: `CAR-${19 + (i % 12)}`, split: 'heldout', mode: 'live', taskClass: taskClasses[Math.floor(i / 12)], outcome: 'succeeded', firstAttempt: attempt, attempts: [attempt], assessment });
  });
  const request = { finalConfig: frozenFinalConfig, holdoutUsedForSelection: false, overlap: { status: 'CHECKED_NO_OVERLAP', count: 0 } };
  const passed = json(run(['--summary'], { ...request, records: withCompleteSyntheticHashMap(records) }));
  assert.equal(passed.holdout.qualityGate.minimumUsableRate, 0.9);
  assert.equal(passed.holdout.qualityGate.passed, true);
  assert.equal(passed.capabilityDecision, 'ELIGIBLE_FOR_OWNER_REVIEW');
  const identityFailure = records.map(row => ({ ...row, assessment: { ...row.assessment } }));
  identityFailure[0].assessment.identity = 'fail';
  const blocked = json(run(['--summary'], { ...request, records: withCompleteSyntheticHashMap(identityFailure) }));
  assert.equal(blocked.holdout.usableYield, 33 / 36);
  assert.equal(blocked.holdout.qualityGate.identityFailures, 1);
  assert.equal(blocked.holdout.qualityGate.passed, false);
  assert.equal(blocked.capabilityDecision, 'KEEP_DISABLED');
});
