import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __v2TaskHarness?: {
      requests(): { method: string; path: string }[];
      holdNext(): void;
      held(): boolean;
      release(): void;
      holdCancel(): void;
      cancelHeld(): boolean;
      releaseCancel(): void;
    };
  }
}

test('task wait shows real state, serializes the queued-cancel race, and never resubmits while browsing', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/tests/harness/v2.html');
  await expect(page.getByRole('heading', { name: 'Waiting to start.' })).toBeVisible();
  await expect(page.getByText('Photo intake is unavailable in this checkout. No upload or model service is connected.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.v2-task').screenshot({ path: '/tmp/form-F15-task.png' });
  await page.getByRole('button', { name: 'Cancel before processing' }).click();
  await expect(page.getByRole('heading', { name: 'Creating your look.' })).toBeVisible();
  await expect(page.getByText('This look has already started. You can leave and return later.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel before processing' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Browse' }).click();
  await expect(page.getByRole('heading', { name: 'Browse' })).toBeVisible();
  await page.getByRole('button', { name: 'Return to task' }).click();
  await expect(page.getByRole('heading', { name: 'Creating your look.' })).toBeVisible();
  const requests = await page.evaluate(() => window.__v2TaskHarness?.requests() ?? []);
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  expect(requests.filter((request) => request.method === 'POST')[0]?.path).toContain('/cancel');
  expect(requests.every((request) => request.method === 'GET' || request.path.endsWith('/cancel'))).toBe(true);
});

test('offline, unauthorized and missing task responses give distinct status feedback', async ({ page }) => {
  await page.goto('/tests/harness/v2.html');
  await page.getByRole('button', { name: 'Fail next request offline' }).click();
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByRole('alert')).toHaveText('You appear to be offline. Reconnect to check this task.');
  await page.getByRole('button', { name: 'Return 401 next' }).click();
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByRole('alert')).toHaveText('Sign in again to check this task.');
  await page.getByRole('button', { name: 'Return 404 next' }).click();
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByRole('alert')).toHaveText('This task is not available for the current account.');
});

test('hidden pages pause task polling and foreground refreshes immediately', async ({ page }) => {
  await page.goto('/tests/harness/v2.html');
  await expect.poll(() => page.evaluate(() => window.__v2TaskHarness?.requests().length ?? 0)).toBeGreaterThan(0);
  const beforeHidden = await page.evaluate(() => window.__v2TaskHarness?.requests().length ?? 0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(2_200);
  expect(await page.evaluate(() => window.__v2TaskHarness?.requests().length ?? 0)).toBe(beforeHidden);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.__v2TaskHarness?.requests().length ?? 0)).toBe(beforeHidden + 1);
});

test('leaving while a request is held stops the old screen from receiving it', async ({ page }) => {
  await page.goto('/tests/harness/v2.html');
  await page.getByRole('button', { name: 'Advance task on server' }).click();
  await page.getByRole('button', { name: 'Hold next response' }).click();
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect.poll(() => page.evaluate(() => window.__v2TaskHarness?.held() ?? false)).toBe(true);
  await page.getByRole('button', { name: 'Browse' }).click();
  await expect(page.getByRole('heading', { name: 'Browse' })).toBeVisible();
  await page.getByRole('button', { name: 'Release held response' }).click();
  await expect(page.getByRole('region', { name: 'Task status' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Return to task' }).click();
  await expect(page.getByRole('heading', { name: 'Creating your look.' })).toBeVisible();
});

test('task owner or identity changes discard held responses and terminal copy reflects only confirmed credit return', async ({ page }) => {
  await page.goto('/tests/harness/v2.html');
  await page.getByRole('button', { name: 'Advance task on server' }).click();
  await page.getByRole('button', { name: 'Hold next response' }).click();
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect.poll(() => page.evaluate(() => window.__v2TaskHarness?.held() ?? false)).toBe(true);
  await page.getByRole('button', { name: 'Switch task' }).click();
  await page.getByRole('button', { name: 'Release held response' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting to start.' })).toBeVisible();
  await page.getByRole('button', { name: 'Fail task two on server' }).click();
  await page.getByRole('button', { name: 'Hold next response' }).click();
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect.poll(() => page.evaluate(() => window.__v2TaskHarness?.held() ?? false)).toBe(true);
  await page.getByRole('button', { name: 'Switch actor' }).click();
  await expect(page.getByRole('heading', { name: 'Checking your task.' })).toBeVisible();
  await page.getByRole('button', { name: 'Release held response' }).click();
  await expect(page.getByRole('heading', { name: 'Checking your task.' })).toBeVisible();
  await page.getByRole('button', { name: 'Show returned failure' }).click();
  await expect(page.getByText('We could not complete this look. Your credit was returned.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show unconfirmed failure' }).click();
  await expect(page.getByText('We could not complete this look. Your credit return is not confirmed.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show unchanged result' }).click();
  await expect(page.getByText('This request did not produce a changed image. Your credit was returned.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show unconfirmed unchanged result' }).click();
  await expect(page.getByText('This request did not produce a changed image. Your credit return is not confirmed.', { exact: true })).toBeVisible();
});

test('terminal state stops polling and same-submission recovery is explicit', async ({ page }) => {
  await page.goto('/tests/harness/v2.html');
  await page.getByRole('button', { name: 'Show completed task' }).click();
  await expect(page.getByRole('heading', { name: 'Your look is ready.' })).toBeVisible();
  const callsBefore = await page.evaluate(() => window.__v2TaskHarness?.requests().length ?? 0);
  await page.waitForTimeout(2_200);
  const callsAfter = await page.evaluate(() => window.__v2TaskHarness?.requests().length ?? 0);
  expect(callsAfter).toBe(callsBefore);
  await page.getByRole('button', { name: 'Show lost acknowledgement' }).click();
  await page.getByRole('button', { name: 'Recover same submission' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting to start.' })).toBeVisible();
  const requests = await page.evaluate(() => window.__v2TaskHarness?.requests() ?? []);
  expect(requests.some((request) => request.method === 'POST' && request.path === '/api/v2/tasks')).toBe(false);
  expect(requests.some((request) => request.path === '/api/v2/submissions/submission-1' && request.method === 'GET')).toBe(true);
});

test('uncertain and cancelled states are shown from the task record', async ({ page }) => {
  await page.goto('/tests/harness/v2.html');
  for (const [button, heading, detail] of [
    ['Show uncertain task', 'Checking an interrupted request.', 'We will not submit it again automatically.'],
    ['Show cancelled task', 'This look was cancelled.', 'This task was cancelled. Your credit was returned.'],
    ['Show unconfirmed cancelled task', 'This look was cancelled.', 'This task was cancelled. Your credit return is not confirmed.'],
  ]) {
    await page.getByRole('button', { name: button }).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.getByText(detail, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Cancel before processing' })).toHaveCount(0);
});

test('task controls wrap at 320px with text scaled to 200 percent', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/tests/harness/v2.html');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const actions = page.locator('.v2-task__actions');
  await expect(actions.getByRole('button', { name: 'Cancel before processing' })).toBeVisible();
  const layout = await actions.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const buttons = [...node.querySelectorAll('button')].map(button => button.getBoundingClientRect());
    return { page: document.documentElement.scrollWidth, action: node.scrollWidth, width: rect.width, right: buttons.map(button => button.right), tops: buttons.map(button => Math.round(button.top)) };
  });
  expect(layout.page).toBeLessThanOrEqual(320);
  expect(layout.action).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.right.every(right => right <= 320)).toBe(true);
  expect(new Set(layout.tops).size).toBeGreaterThan(1);
});

test('late cancel callbacks respect task lifetime and 409 refresh keeps the GET error', async ({ page }) => {
  await page.goto('/tests/harness/v2.html');
  await page.getByRole('button', { name: 'Hold next cancel' }).click();
  await page.getByRole('button', { name: 'Cancel before processing' }).click();
  await expect.poll(() => page.evaluate(() => window.__v2TaskHarness?.cancelHeld() ?? false)).toBe(true);
  await page.getByRole('button', { name: 'Switch task' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting to start.' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch task' }).click();
  await expect(page.getByRole('heading', { name: 'Creating your look.' })).toBeVisible();
  await page.getByRole('button', { name: 'Release held cancel' }).click();
  await page.waitForTimeout(50);
  expect(await page.locator('.v2-task__message').count()).toBe(0);

  for (const [failure, message] of [
    ['Fail next request offline', 'You appear to be offline. Reconnect to check this task.'],
    ['Return 401 next', 'Sign in again to check this task.'],
    ['Return 404 next', 'This task is not available for the current account.'],
  ]) {
    await page.goto('/tests/harness/v2.html');
    await page.getByRole('button', { name: failure }).click();
    await page.getByRole('button', { name: 'Cancel before processing' }).click();
    await expect(page.getByRole('alert')).toHaveText(message);
  }
});
