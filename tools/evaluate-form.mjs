#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('../research/form-v2/photo-registry.json', import.meta.url));
const registry = JSON.parse(readFileSync(here, 'utf8'));
const rubric = ['identity', 'targetExecuted', 'nonTargetPreserved', 'artifacts', 'wouldKeep'];
const taskClasses = ['color_only', 'supported_style', 'single_detail'];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function input() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return {}; }
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { throw new Error('stdin must contain JSON'); }
}

function dryRun() {
  return {
    mode: 'LOCAL_DRY_RUN',
    phases: {
      development: { photos: 18, tasksPerPhoto: 3, configurations: 3, outputs: 162 },
      sequential: { cars: 6, editsPerCar: 3, configurations: 3, outputs: 54 },
      heldout: { photos: 12, tasksPerPhoto: 3, configurations: 1, outputs: 36, requiresFinalConfigLock: true }
    },
    totalOutputs: 252,
    externalCallsMade: 0,
    paidCallsMade: 0,
    cost: {
      currency: 'USD',
      maxCostPerAttemptMicrosUSD: null,
      plannedMaximumExposureMicrosUSD: null,
      retryPolicy: 'UNSET; every retry is a separately recorded attempt',
      note: 'Unknown cost and exposure are null, never zero.'
    },
    capabilityDecision: 'NOT_ASSESSED'
  };
}

function finiteAmount(value, field) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${field} must be a non-negative integer or null`);
  }
}

function validateAttempt(attempt) {
  if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) throw new Error('each attempt must be an object');
  if (!['succeeded', 'failed', 'cancelled', 'uncertain'].includes(attempt.status)) throw new Error('attempt status is invalid');
  if (!['settled', 'uncertain', 'not_exposed'].includes(attempt.exposureStatus)) throw new Error('attempt exposureStatus is invalid');
  finiteAmount(attempt.actualCostMicrosUSD, 'actualCostMicrosUSD');
  finiteAmount(attempt.maxExposureMicrosUSD, 'maxExposureMicrosUSD');
  if (attempt.exposureStatus === 'settled' && attempt.actualCostMicrosUSD === null) throw new Error('settled attempt cost must be known');
  if (attempt.exposureStatus === 'not_exposed' && (attempt.maxExposureMicrosUSD !== 0 || attempt.actualCostMicrosUSD !== 0)) throw new Error('not-exposed attempt must have zero actual cost and exposure');
}

function validateAssessment(assessment) {
  if (assessment === null) return false;
  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) throw new Error('assessment must be an object or null');
  for (const key of rubric.slice(0, 4)) if (!['pass', 'fail', 'unknown'].includes(assessment[key])) throw new Error(`assessment.${key} must be pass, fail, or unknown`);
  if (typeof assessment.wouldKeep !== 'boolean') throw new Error('assessment.wouldKeep must be boolean');
  return true;
}

function validateRecords(records, finalConfig) {
  if (!Array.isArray(records)) throw new Error('records must be an array');
  const validSlots = new Map(registry.slots.map(slot => [slot.slotId, slot.split]));
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('each record must be an object');
    if (!validSlots.has(record.slotId)) throw new Error(`unknown slotId: ${String(record.slotId)}`);
    if (record.split !== validSlots.get(record.slotId)) throw new Error(`split does not match registry for ${record.slotId}`);
    if (!['live', 'demo', 'mock'].includes(record.mode)) throw new Error('record mode must be live, demo, or mock');
    if (!taskClasses.includes(record.taskClass)) throw new Error('record taskClass is invalid');
    if (!['succeeded', 'failed', 'cancelled', 'unknown'].includes(record.outcome)) throw new Error('record outcome is invalid');
    if (!Array.isArray(record.attempts)) throw new Error('record attempts must be an array');
    for (const attempt of record.attempts) validateAttempt(attempt);
    const first = record.attempts.length ? record.attempts[0] : null;
    if (!isDeepStrictEqual(record.firstAttempt ?? null, first)) throw new Error('record first attempt must match the first attempt entry');
    if (record.outcome === 'succeeded' && !record.attempts.some(attempt => attempt.status === 'succeeded')) throw new Error('successful output requires a successful attempt');
    if (record.photoSha256 !== undefined && record.photoSha256 !== null && !/^[a-f0-9]{64}$/i.test(record.photoSha256)) throw new Error('photoSha256 must be a 64-character hash or null');
    validateAssessment(record.assessment ?? null);
    if (record.split === 'heldout') {
      for (const key of ['candidateId', 'providerId', 'profileVersion', 'model', 'promptVersion', 'promptSha256']) {
        if (record[key] !== finalConfig[key]) throw new Error('heldout record does not match the locked final configuration');
      }
      if ((record.attemptStartedAt ?? null) !== (first?.startedAt ?? null)) throw new Error('heldout first attempt start must match its attempt entry');
      const lockedAt = Date.parse(finalConfig.lockedAt);
      for (const attempt of record.attempts) {
        const startedAt = typeof attempt.startedAt === 'string' ? Date.parse(attempt.startedAt) : NaN;
        if (!Number.isFinite(startedAt) || startedAt <= lockedAt) throw new Error('heldout provider attempt must start after the final configuration lock');
      }
    }
  }
}

function completeFinalConfig(config) {
  return Boolean(config && config.locked === true &&
    typeof config.candidateId === 'string' && config.candidateId.length > 0 &&
    typeof config.providerId === 'string' && config.providerId.length > 0 &&
    typeof config.profileVersion === 'string' && config.profileVersion.length > 0 &&
    typeof config.model === 'string' && config.model.length > 0 &&
    typeof config.promptVersion === 'string' && config.promptVersion.length > 0 &&
    typeof config.promptSha256 === 'string' && /^[a-f0-9]{64}$/i.test(config.promptSha256) &&
    Number.isSafeInteger(config.maxCostMicrosUSD) && config.maxCostMicrosUSD > 0 &&
    typeof config.qualityEvidence === 'string' && config.qualityEvidence.length > 0 &&
    typeof config.lockedAt === 'string' && !Number.isNaN(Date.parse(config.lockedAt)));
}

function assess(record) {
  const value = record.assessment;
  return Boolean(value && rubric.every(key => value[key] !== undefined) &&
    rubric.slice(0, 4).every(key => value[key] === 'pass'));
}

function summarize(records) {
  const requestedOutputs = records.length;
  const deliveredOutputs = records.filter(row => row.outcome === 'succeeded').length;
  const failedOutputs = records.filter(row => row.outcome === 'failed').length;
  const cancelledOutputs = records.filter(row => row.outcome === 'cancelled').length;
  const unknownOutcomes = records.filter(row => row.outcome === 'unknown').length;
  const attemptRows = records.flatMap(row => row.attempts);
  const attempts = attemptRows.length;
  const retries = records.reduce((count, row) => count + Math.max(0, row.attempts.length - 1), 0);
  const failedAttempts = attemptRows.filter(attempt => attempt.status === 'failed').length;
  const cancelledAttempts = attemptRows.filter(attempt => attempt.status === 'cancelled').length;
  const uncertainAttempts = attemptRows.filter(attempt => attempt.status === 'uncertain').length;
  const assessedOutputs = records.filter(row => row.assessment !== null && row.assessment !== undefined).length;
  const usableOutputs = records.filter(row => row.outcome === 'succeeded' && assess(row) && row.assessment.wouldKeep).length;
  const identityFailures = records.filter(row => row.assessment?.identity === 'fail').length;
  const identityUnknown = records.filter(row => !row.assessment || row.assessment.identity === 'unknown').length;
  const assessed = records.filter(row => row.assessment !== null && row.assessment !== undefined).length;
  const interval = wilson(usableOutputs, assessed);
  return {
    requestedOutputs, deliveredOutputs, failedOutputs, cancelledOutputs, unknownOutcomes,
    attempts, retries, failedAttempts, cancelledAttempts, uncertainAttempts,
    assessedOutputs, usableOutputs, identityFailures, identityUnknown,
    usableYield: requestedOutputs ? usableOutputs / requestedOutputs : null,
    usableAmongAssessed: assessedOutputs ? usableOutputs / assessedOutputs : null,
    usableAmongAssessedWilson95: interval
  };
}

function wilson(successes, count) {
  if (!count) return null;
  const z = 1.96;
  const rate = successes / count;
  const scale = 1 + z * z / count;
  const center = (rate + z * z / (2 * count)) / scale;
  const margin = z * Math.sqrt((rate * (1 - rate) + z * z / (4 * count)) / count) / scale;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function groups(records, key) {
  const values = key === 'taskClass' ? taskClasses : [...new Set(records.map(row => row.vehicleClass ?? 'unknown'))].sort();
  return Object.fromEntries(values.map(value => [value, summarize(records.filter(row => (key === 'taskClass' ? row.taskClass : row.vehicleClass ?? 'unknown') === value))]));
}

function heldoutTaskGroups(records) {
  return Object.fromEntries(taskClasses.map(taskClass => {
    const rows = records.filter(row => row.taskClass === taskClass);
    const seen = new Set(rows.map(row => row.slotId));
    const missing = Math.max(0, 12 - seen.size);
    const metrics = summarize(rows);
    return [taskClass, {
      ...metrics,
      requestedOutputs: 12,
      missingOutputs: missing,
      unknownOutcomes: metrics.unknownOutcomes + missing,
      identityUnknown: metrics.identityUnknown + missing,
      usableYield: metrics.usableOutputs / 12
    }];
  }));
}

function costSummary(records) {
  const attempts = records.filter(row => row.mode === 'live').flatMap(row => row.attempts);
  let knownSettledMicrosUSD = 0;
  let knownOpenExposureMicrosUSD = 0;
  let unknownOpenExposureAttempts = 0;
  let overCeilingAttempts = 0;
  let overCeilingMicrosUSD = 0;
  const add = (left, right, label) => {
    const total = left + right;
    if (!Number.isSafeInteger(total)) throw new Error(`${label} exceeds safe integer range`);
    return total;
  };
  for (const attempt of attempts) {
    if (attempt.actualCostMicrosUSD !== null && attempt.maxExposureMicrosUSD !== null && attempt.actualCostMicrosUSD > attempt.maxExposureMicrosUSD) {
      overCeilingAttempts++;
      overCeilingMicrosUSD = add(overCeilingMicrosUSD, attempt.actualCostMicrosUSD - attempt.maxExposureMicrosUSD, 'exposure overrun total');
    }
    if (attempt.exposureStatus === 'settled') knownSettledMicrosUSD = add(knownSettledMicrosUSD, attempt.actualCostMicrosUSD, 'settled cost total');
    else if (attempt.exposureStatus === 'uncertain') {
      if (attempt.maxExposureMicrosUSD === null) unknownOpenExposureAttempts++;
      const knownExposure = Math.max(attempt.actualCostMicrosUSD ?? 0, attempt.maxExposureMicrosUSD ?? 0);
      knownOpenExposureMicrosUSD = add(knownOpenExposureMicrosUSD, knownExposure, 'open exposure total');
    }
  }
  const totalLiabilityMicrosUSD = unknownOpenExposureAttempts ? null : add(knownSettledMicrosUSD, knownOpenExposureMicrosUSD, 'total liability');
  return {
    knownSettledMicrosUSD,
    knownOpenExposureMicrosUSD,
    unknownOpenExposureAttempts,
    overCeilingAttempts,
    overCeilingMicrosUSD,
    newTaskRecommendation: overCeilingAttempts ? 'PAUSE' : 'NO_OVERRUN_RECORDED',
    totalLiabilityMicrosUSD
  };
}

function overlapResult(records) {
  const hashes = new Map();
  const slotHashes = new Map();
  for (const row of records) {
    if (!row.photoSha256) continue;
    const key = row.photoSha256.toLowerCase();
    const splits = hashes.get(key) ?? new Set();
    splits.add(row.split);
    hashes.set(key, splits);
    const perSlot = slotHashes.get(row.slotId) ?? new Set();
    perSlot.add(key);
    slotHashes.set(row.slotId, perSlot);
  }
  const overlapCount = [...hashes.values()].filter(splits => splits.has('development') && splits.has('heldout')).length;
  if (overlapCount) return { status: 'OVERLAP_DETECTED', count: overlapCount };
  if (!slotHashes.size) return { status: 'NOT_CHECKED', count: null };
  const complete = registry.slots.every(slot => slotHashes.get(slot.slotId)?.size === 1);
  return complete ? { status: 'CHECKED_NO_OVERLAP', count: 0 } : { status: 'PARTIAL_HASHES', count: null };
}

function reportSummary(data) {
  const records = data.records ?? [];
  if (!Array.isArray(records)) throw new Error('records must be an array');
  const heldoutRows = records.filter(row => row.split === 'heldout');
  if (heldoutRows.length && !completeFinalConfig(data.finalConfig)) throw new Error('heldout evaluation requires a complete locked final configuration');
  validateRecords(records, data.finalConfig);
  const overlap = overlapResult(records);
  const contaminated = data.holdoutUsedForSelection === true || overlap.status === 'OVERLAP_DETECTED';
  const liveHeldout = heldoutRows.filter(row => row.mode === 'live');
  const seenPairs = new Set(liveHeldout.map(row => `${row.slotId}:${row.taskClass}`));
  const requiredPairs = new Set(registry.slots.filter(slot => slot.split === 'heldout').flatMap(slot => taskClasses.map(task => `${slot.slotId}:${task}`)));
  const completeCoverage = liveHeldout.length === 36 && seenPairs.size === 36 && [...requiredPairs].every(pair => seenPairs.has(pair));
  const missingHeldout = Math.max(0, 36 - seenPairs.size);
  const uniqueHeldout = [...new Map(liveHeldout.map(row => [`${row.slotId}:${row.taskClass}`, row])).values()];
  const heldoutMetrics = summarize(uniqueHeldout);
  const holdout = {
    ...heldoutMetrics,
    plannedOutputs: 36,
    requestedOutputs: 36,
    recordedOutputs: liveHeldout.length,
    missingOutputs: missingHeldout,
    duplicateSlotTaskPairs: Math.max(0, liveHeldout.length - seenPairs.size),
    unknownOutcomes: heldoutMetrics.unknownOutcomes + missingHeldout,
    identityUnknown: heldoutMetrics.identityUnknown + missingHeldout,
    usableYield: heldoutMetrics.usableOutputs / 36,
    completeCoverage,
    byTaskClass: heldoutTaskGroups(uniqueHeldout),
    byVehicleClass: groups(uniqueHeldout, 'vehicleClass'),
    contaminated,
    freshSetRequired: contaminated
  };
  holdout.qualityGate = {
    minimumUsableRate: 0.9,
    usableRate: holdout.usableYield,
    identityFailures: holdout.identityFailures,
    unresolvedIdentity: holdout.identityUnknown,
    passed: completeCoverage && holdout.usableYield >= 0.9 && holdout.identityFailures === 0 && holdout.identityUnknown === 0
  };
  const liveRows = records.filter(row => row.mode === 'live');
  const summary = {
    live: {
      ...summarize(liveRows),
      byTaskClass: groups(liveRows, 'taskClass'),
      byVehicleClass: groups(liveRows, 'vehicleClass')
    },
    excludedDemoMockOutputs: records.filter(row => row.mode !== 'live').length,
    holdout,
    overlap,
    cost: costSummary(records),
    capabilityDecision: 'NOT_ASSESSED'
  };
  if (heldoutRows.length) {
    const clean = !contaminated && data.holdoutUsedForSelection === false && overlap.status === 'CHECKED_NO_OVERLAP';
    summary.capabilityDecision = holdout.qualityGate.passed && clean ? 'ELIGIBLE_FOR_OWNER_REVIEW' : 'KEEP_DISABLED';
  }
  return summary;
}

function blindPacket(data) {
  if (!Array.isArray(data.records)) throw new Error('records must be an array');
  return {
    cards: data.records.map(row => {
      if (!row || typeof row.blindOutputId !== 'string' || !row.blindOutputId) throw new Error('each blind record requires blindOutputId');
      return { blindOutputId: row.blindOutputId, rubric };
    })
  };
}

try {
  const args = process.argv.slice(2);
  let output;
  if (args.length === 1 && args[0] === '--dry-run') output = dryRun();
  else if (args.length === 1 && args[0] === '--summary') output = reportSummary(input());
  else if (args.length === 1 && args[0] === '--blind-packet') output = blindPacket(input());
  else throw new Error('usage: evaluate-form.mjs --dry-run | --summary | --blind-packet');
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : 'evaluation failed');
}
