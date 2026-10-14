import { expect, test } from '@playwright/test';
import type { EditRequest } from '../../shared/v2/edit-plan.js';

type DraftWrite = {
  ownerId: string; projectId: string; expectedRevision: number;
  source: { kind: 'original' } | { kind: 'version'; versionId: string };
  edits: Record<string, unknown>;
};

declare global {
  interface Window {
    __v2EditHarness?: {
      requests(): { method: string; path: string; submissionStoredAtPost?: boolean; requestEdits?: EditRequest }[];
      draftWrites(): DraftWrite[];
      heldDraftSave(): boolean;
    };
  }
}

test('detail edits, undo and reset keep the selected image and never request a plan or task', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/tests/harness/v2.html?feature=edit');
  const image = page.getByRole('img', { name: 'Selected base: Original' });
  const originalSrc = await image.getAttribute('src');
  await page.getByLabel('Body color').selectOption('blue');
  await expect(page.getByText('Preview has not been updated yet.', { exact: true })).toBeVisible();
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Body color')).toHaveValue('');
  await expect.poll(() => page.evaluate(() => window.__v2EditHarness?.draftWrites().length ?? 0)).toBe(2);
  expect((await page.evaluate(() => window.__v2EditHarness?.draftWrites() ?? []))[1]?.expectedRevision).toBe(5);
  await expect(page.getByRole('img', { name: 'Selected base: Original' })).toHaveAttribute('src', originalSrc!);
  await page.getByLabel('Body color').selectOption('green');
  await page.getByRole('button', { name: 'Reset changes' }).click();
  await expect(page.getByLabel('Body color')).toHaveValue('');
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.__v2EditHarness?.requests() ?? [])).toEqual([]);
});

test('failed autosave retains edits for retry and confirmation submits the frozen quote once', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=edit');
  await page.getByRole('button', { name: 'Fail next draft save' }).click();
  await page.getByLabel('Body color').selectOption('blue');
  await expect(page.getByRole('alert')).toHaveText('Could not save this draft. Your changes are still here.');
  await expect(page.getByLabel('Body color')).toHaveValue('blue');
  await page.getByRole('button', { name: 'Retry draft save' }).click();
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to confirmation' }).click();
  await expect(page.getByRole('heading', { name: 'Review your look' })).toBeVisible();
  await expect(page.getByText('Create 1 look - 1 credit', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Selected base: Original' })).toBeVisible();
  await page.getByRole('button', { name: 'Create 1 look' }).dblclick();
  await expect(page.getByText('Queued task task-fixture.', { exact: true })).toBeVisible();
  const requests = await page.evaluate(() => window.__v2EditHarness?.requests() ?? []);
  expect(requests.filter(request => request.path.endsWith('/plans'))).toHaveLength(1);
  const submits = requests.filter(request => request.path === '/api/v2/tasks');
  expect(submits).toHaveLength(1);
  expect(submits[0]?.submissionStoredAtPost).toBe(true);
});

test('refresh after a lost submission acknowledgement recovers the persisted identity without a new POST', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=edit&submit=lost');
  await page.getByLabel('Body color').selectOption('blue');
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to confirmation' }).click();
  await expect(page.getByRole('heading', { name: 'Review your look' })).toBeVisible();
  await page.getByRole('button', { name: 'Create 1 look' }).click();
  await expect(page.getByRole('alert')).toHaveText('We could not confirm that submission. Recover the same saved submission.');
  const firstPost = await page.evaluate(() => window.__v2EditHarness?.requests() ?? []);
  expect(firstPost.filter(request => request.path === '/api/v2/tasks')).toHaveLength(1);
  expect(firstPost.find(request => request.path === '/api/v2/tasks')?.submissionStoredAtPost).toBe(true);

  await page.reload();
  await expect(page.getByLabel('Body color')).toHaveValue('blue');
  await page.getByRole('button', { name: 'Recover existing submission' }).click();
  await expect(page.getByRole('button', { name: 'Recover same submission' })).toBeVisible();
  await page.getByRole('button', { name: 'Recover same submission' }).click();
  await expect(page.getByText('Queued task task-fixture.', { exact: true })).toBeVisible();
  const recovered = await page.evaluate(() => window.__v2EditHarness?.requests() ?? []);
  expect(recovered.some(request => request.path === '/api/v2/submissions/submission-fixture' && request.method === 'GET')).toBe(true);
  expect(recovered.some(request => request.path === '/api/v2/tasks' && request.method === 'POST')).toBe(false);
});

test('revision conflict preserves local edits until explicitly loading the newer historical draft', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=edit&save=conflict');
  await page.getByLabel('Body color').selectOption('blue');
  await page.getByLabel('Selected base').selectOption('version-old');
  await expect(page.getByRole('alert')).toHaveText('A newer saved draft exists. Your local changes are still here.');
  await expect(page.getByLabel('Body color')).toHaveValue('blue');
  await expect(page.getByRole('img', { name: 'Selected base: Earlier version' })).toBeVisible();
  const writesBefore = await page.evaluate(() => window.__v2EditHarness?.draftWrites().length ?? 0);
  await page.getByRole('button', { name: 'Use newer saved draft' }).click();
  await expect(page.getByRole('img', { name: 'Selected base: Newer version' })).toBeVisible();
  await expect(page.getByLabel('Body color')).toHaveValue('red');
  expect(await page.evaluate(() => window.__v2EditHarness?.draftWrites().length ?? 0)).toBe(writesBefore);
});

test('late autosave for an old source cannot replace the currently selected historical base', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=edit');
  await page.getByRole('button', { name: 'Hold next draft save' }).click();
  await page.getByLabel('Body color').selectOption('blue');
  await expect.poll(() => page.evaluate(() => window.__v2EditHarness?.heldDraftSave() ?? false)).toBe(true);
  await page.getByLabel('Selected base').selectOption('version-old');
  await page.getByRole('button', { name: 'Release held draft save' }).click();
  await expect(page.getByRole('img', { name: 'Selected base: Earlier version' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__v2EditHarness?.draftWrites().length ?? 0)).toBeGreaterThan(1);
  const writes = await page.evaluate(() => window.__v2EditHarness?.draftWrites() ?? []);
  expect(writes.at(-1)?.source).toEqual({ kind: 'version', versionId: 'version-old' });
  await expect(page.getByLabel('Body color')).toHaveValue('blue');
});

test('same-project remote refresh preserves unsaved controls and the selected source until CAS conflict resolution', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=edit');
  await page.getByRole('button', { name: 'Hold next draft save' }).click();
  await page.getByLabel('Body color').selectOption('blue');
  await expect.poll(() => page.evaluate(() => window.__v2EditHarness?.heldDraftSave() ?? false)).toBe(true);
  await page.getByRole('button', { name: 'Refresh remote draft' }).click();
  await expect(page.getByLabel('Body color')).toHaveValue('blue');
  await expect(page.getByRole('img', { name: 'Selected base: Original' })).toBeVisible();
  await page.getByRole('button', { name: 'Release held draft save' }).click();
  await expect(page.getByRole('alert')).toHaveText('A newer saved draft exists. Your local changes are still here.');
  await expect(page.getByLabel('Body color')).toHaveValue('blue');
  await expect(page.getByRole('img', { name: 'Selected base: Original' })).toBeVisible();
});

test('late autosave from a previous owner cannot change the newly selected account draft', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=edit');
  await page.getByRole('button', { name: 'Hold next draft save' }).click();
  await page.getByLabel('Body color').selectOption('blue');
  await expect.poll(() => page.evaluate(() => window.__v2EditHarness?.heldDraftSave() ?? false)).toBe(true);
  await page.getByRole('button', { name: 'Switch synthetic owner' }).click();
  await expect(page.getByText('owner-b', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Release held draft save' }).click();
  await expect(page.getByLabel('Body color')).toHaveValue('');
  await expect(page.getByRole('img', { name: 'Selected base: Original' })).toBeVisible();
});

test('restoring original after switching to the original source explains the no-op and does not quote', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=edit');
  await page.getByLabel('Selected base').selectOption('version-old');
  await page.getByRole('button', { name: 'Restore original' }).click();
  await page.getByLabel('Selected base').selectOption('original');
  await expect(page.getByText('The original is already selected. Restoring it will not create a change.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to confirmation' })).toBeDisabled();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__v2EditHarness?.requests() ?? [])).toEqual([]);
});

test('explore keeps the frozen original preset and capability-closed detail controls stay hidden', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=edit&operation=explore');
  await expect(page.getByRole('img', { name: 'Selected base: Original' })).toBeVisible();
  await expect(page.getByLabel('Body color')).toHaveCount(0);
  await expect(page.getByLabel('Wheel color')).toHaveCount(0);
  await expect(page.getByLabel('Selected base')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue to confirmation' }).click();
  await expect(page.getByRole('heading', { name: 'Review your look' })).toBeVisible();
  await expect(page.getByText('Direction: clean', { exact: true })).toBeVisible();
  await expect(page.getByText('Body color: silver', { exact: true })).toBeVisible();

  await page.goto('/tests/harness/v2.html?feature=edit&capabilities=closed');
  await expect(page.getByLabel('Body color')).toHaveCount(0);
  await expect(page.getByText('Editing controls are unavailable until this project has an enabled capability.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore original' })).toHaveCount(0);

  await page.goto('/tests/harness/v2.html?feature=edit&original=closed');
  await page.getByLabel('Selected base').selectOption('version-old');
  await expect(page.getByRole('button', { name: 'Restore original' })).toHaveCount(0);
  await expect(page.getByText('Restore original is unavailable because the selected source has no verified original reference.', { exact: true })).toBeVisible();

  await page.goto('/tests/harness/v2.html?feature=edit&operation=explore&capabilities=closed');
  await expect(page.getByRole('button', { name: 'Continue to confirmation' })).toBeDisabled();
  await expect(page.getByText('Explore is unavailable until this project has an enabled capability.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__v2EditHarness?.requests() ?? [])).toEqual([]);
});

test('disabled capabilities still allow recovery of a saved submission and show its real status', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=edit&capabilities=closed&pending=1&recover-status=succeeded');
  await page.getByRole('button', { name: 'Recover existing submission' }).click();
  await expect(page.getByRole('button', { name: 'Recover same submission' })).toBeVisible();
  await page.getByRole('button', { name: 'Recover same submission' }).click();
  await expect(page.getByText('Task task-fixture status: succeeded.', { exact: true })).toBeVisible();
  const requests = await page.evaluate(() => window.__v2EditHarness?.requests() ?? []);
  expect(requests.some(request => request.path === '/api/v2/submissions/submission-fixture' && request.method === 'GET')).toBe(true);
  expect(requests.some(request => request.path.endsWith('/plans') || (request.path === '/api/v2/tasks' && request.method === 'POST'))).toBe(false);
});

test('an unavailable historical source is never replaced by the original image', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=edit&source=missing');
  await expect(page.getByRole('img')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveText('The selected photo version is unavailable. Choose an available source before editing.');
  await expect(page.getByRole('button', { name: 'Continue to confirmation' })).toBeDisabled();
  await page.getByLabel('Selected base').selectOption('original');
  await expect(page.getByRole('img', { name: 'Selected base: Original' })).toBeVisible();
});

test('confirmation quotes the exact selected historical source', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=edit');
  await page.getByLabel('Selected base').selectOption('version-old');
  await page.getByLabel('Body color').selectOption('blue');
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to confirmation' }).click();
  await expect(page.getByRole('img', { name: 'Selected base: Earlier version' })).toBeVisible();
  const plan = (await page.evaluate(() => window.__v2EditHarness?.requests() ?? [])).find(request => request.path.endsWith('/plans'));
  expect(plan?.requestEdits).toEqual({
    schemaVersion: 2, source: { kind: 'version', versionId: 'version-old' }, operation: 'detail', edits: { bodyColor: { action: 'set', value: 'blue' } },
  });
  await expect(page.getByText('Create 1 look - 1 credit', { exact: true })).toBeVisible();
});

test('confirmation gates explain no-change, offline, balance, consent, photo and active-task states', async ({ page }) => {
  for (const [gate, reason] of [
    ['', 'Choose at least one change before generating.'],
    ['offline', 'You are offline. Reconnect to create a new look.'],
    ['balance', 'You need at least 1 credit to create this look.'],
    ['consent', 'Confirm the required photo permissions before continuing.'],
    ['photo', 'This photo is not supported for editing.'],
    ['active', 'Finish or recover your active task before creating another look.'],
  ]) {
    await page.goto(`/tests/harness/v2.html?feature=edit${gate ? `&gate=${gate}` : ''}`);
    await expect(page.getByRole('button', { name: 'Continue to confirmation' })).toBeDisabled();
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__v2EditHarness?.requests() ?? [])).toEqual([]);
  }
});
