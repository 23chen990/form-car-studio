import { expect, test, type Page } from '@playwright/test';
import type { GarageHarnessBridge } from '../../src/testing/v2-harness.js';

const apiRequests = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const seen: string[] = []; apiRequests.set(page, seen);
  await page.route('**/api/**', async route => {
    seen.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.abort();
  });
});
test.afterEach(async ({ page }) => { expect(apiRequests.get(page)).toEqual([]); });

declare global {
  interface Window { __v2GarageHarness?: GarageHarnessBridge; __garageUrls?: { created: string[]; revoked: string[] } }
}

test('garage renders the server-selected older cover and existing favorite', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/harness/v2.html?feature=garage');
  await expect(page.getByRole('region', { name: 'Garage' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Project cover: Earlier look' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Earlier look, favorited' })).toBeVisible();
  await expect(page.getByText('Synthetic only · no account or image service is connected.', { exact: true })).toBeVisible();
});

test('cover and each version favorite follow canonical service snapshots', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=garage');
  await page.locator('[data-version-id="version-new"]').getByRole('button', { name: 'Set as project cover' }).click();
  await expect(page.getByRole('img', { name: 'Project cover: Newest look' })).toBeVisible();
  await page.locator('[data-version-id="version-branch"]').getByRole('button', { name: 'Branch look, not favorited' }).click();
  await expect(page.locator('[data-version-id="version-branch"]').getByRole('button', { name: 'Branch look, favorited' })).toBeVisible();
  const state = await page.evaluate(() => window.__v2GarageHarness?.project('owner-a'));
  expect(state?.coverVersionId).toBe('version-new');
  expect(state?.versions.map(version => [version.id, version.favorite])).toEqual([
    ['version-old', true], ['version-branch', true], ['version-new', false],
  ]);
});

test('favorites-only view filters IDs without changing the older cover or active comparison source', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=garage');
  await page.getByRole('button', { name: 'Show favorites only' }).click();
  await expect(page.locator('[data-version-id]')).toHaveCount(1);
  await expect(page.locator('[data-version-id="version-old"]')).toBeVisible();
  await expect(page.locator('[data-selected-version="version-new"]')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Compare this version with' })).toHaveValue('original');
  await expect(page.getByRole('img', { name: 'Project cover: Earlier look' })).toBeVisible();
});

test('favorites-only view reports an honest empty state', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=garage&favorites=none');
  await page.getByRole('button', { name: 'Show favorites only' }).click();
  await expect(page.getByText('No favorite versions yet.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-version-id]')).toHaveCount(0);
  await expect(page.locator('[data-selected-version="version-new"]')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Project cover: Earlier look' })).toBeVisible();
});

test('rename changes only the project name and leaves saved recipe and graph intact', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=garage');
  const before = await page.evaluate(() => window.__v2GarageHarness?.project('owner-a'));
  await page.getByRole('textbox', { name: 'Project name' }).fill('Autumn garage');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('heading', { name: 'Autumn garage', exact: true })).toBeVisible();
  const after = await page.evaluate(() => window.__v2GarageHarness?.project('owner-a'));
  expect(after?.name).toBe('Autumn garage');
  expect(after?.versions.map(version => [version.id, version.parentVersionId, version.desiredRecipe])).toEqual(
    before?.versions.map(version => [version.id, version.parentVersionId, version.desiredRecipe]));
});

test('deleting a covered parent uses the returned original cover and preserves child parent IDs', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=garage');
  await page.locator('[data-version-id="version-old"]').getByRole('button', { name: 'Delete version' }).click();
  await expect(page.getByRole('img', { name: 'Project cover: Original' })).toBeVisible();
  await expect(page.locator('[data-version-id="version-branch"]')).toContainText('Parent version unavailable');
  const state = await page.evaluate(() => window.__v2GarageHarness?.project('owner-a'));
  expect(state?.coverVersionId).toBeNull();
  expect(state?.versions.find(version => version.id === 'version-branch')?.parentVersionId).toBe('version-old');
  expect(state?.versions.find(version => version.id === 'version-new')?.parentVersionId).toBe('version-old');
});

test('clean, comparison and portrait exports use decoded output sizes; share opened is not posted', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=garage');
  await page.getByRole('button', { name: 'Export clean image' }).click();
  await expect(page.getByRole('img', { name: 'Static export preview' })).toHaveAttribute('data-export-dimensions', '640x400');
  await page.getByRole('button', { name: 'Open share sheet' }).click();
  await expect(page.getByTestId('garage-status')).toHaveText('Share sheet opened. No post outcome is reported.');
  await page.getByRole('button', { name: 'Export comparison image' }).click();
  await expect(page.getByRole('img', { name: 'Static export preview' })).toHaveAttribute('data-export-dimensions', '1280x400');
  await page.getByRole('button', { name: 'Export portrait recipe' }).click();
  await expect(page.getByRole('img', { name: 'Static export preview' })).toHaveAttribute('data-export-dimensions', '1080x1350');
  const events = await page.evaluate(() => window.__v2GarageHarness?.events() ?? []);
  expect(events.filter(event => event.type === 'share')).toHaveLength(1);
  expect(events.filter(event => event.type === 'load_asset').every(event => event.ownerId === 'owner-a' && event.projectId === 'garage-project-a')).toBe(true);
  await expect(page.getByRole('button', { name: /generate|create/i })).toHaveCount(0);
});

test('foreign asset envelope fails closed and stale share acknowledgement cannot cross version selection', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=garage&asset=foreign');
  await page.getByRole('button', { name: 'Export clean image' }).click();
  await expect(page.getByRole('alert')).toHaveText('Export is unavailable for this saved image. Check its owner-scoped image and try again.');
  await expect(page.getByRole('img', { name: 'Static export preview' })).toHaveCount(0);

  await page.goto('/tests/harness/v2.html?feature=garage');
  await page.getByRole('button', { name: 'Export clean image' }).click();
  await expect(page.getByRole('img', { name: 'Static export preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Hold share acknowledgement' }).click();
  await page.getByRole('button', { name: 'Open share sheet' }).click();
  await expect.poll(() => page.evaluate(() => window.__v2GarageHarness?.shareHeld() ?? false)).toBe(true);
  await page.locator('[data-version-id="version-old"] .v2-garage__select').click();
  await page.getByRole('button', { name: 'Release held share acknowledgement' }).click();
  await expect(page.getByText('Share sheet opened. No post outcome is reported.', { exact: true })).toHaveCount(0);
});

test('late favorite acknowledgement cannot cross an owner switch or change the new owner view', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=garage');
  await page.getByRole('button', { name: 'Hold favorite acknowledgement' }).click();
  await page.locator('[data-version-id="version-new"]').getByRole('button', { name: 'Newest look, not favorited' }).click();
  await expect.poll(() => page.evaluate(() => window.__v2GarageHarness?.favoriteHeld() ?? false)).toBe(true);
  await page.getByRole('button', { name: 'Switch synthetic owner' }).click();
  await expect(page.getByText('Other synthetic project', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Release favorite acknowledgement' }).click();
  await expect(page.getByText('Added to favorites.', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__v2GarageHarness?.owner())).toBe('owner-b');
  expect(await page.evaluate(() => window.__v2GarageHarness?.project('owner-a').versions.find(version => version.id === 'version-new')?.favorite)).toBe(true);
});

test('same-project canonical refresh updates history, preserves draft rename, and defeats a late snapshot', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=garage');
  const name = page.getByRole('textbox', { name: 'Project name' });
  await name.fill('Unsubmitted project name');
  await page.getByRole('button', { name: 'Hold favorite acknowledgement' }).click();
  await page.locator('[data-version-id="version-branch"]').getByRole('button', { name: 'Branch look, not favorited' }).click();
  await expect.poll(() => page.evaluate(() => window.__v2GarageHarness?.favoriteHeld() ?? false)).toBe(true);
  await page.getByRole('button', { name: 'Refresh canonical snapshot' }).click();
  await expect(page.getByRole('img', { name: 'Project cover: Branch look' })).toBeVisible();
  await expect(name).toHaveValue('Unsubmitted project name');
  await expect(page.locator('[data-version-id="version-branch"]').getByRole('button', { name: 'Branch look, not favorited' })).toBeVisible();
  await page.getByRole('button', { name: 'Release favorite acknowledgement' }).click();
  await expect(page.locator('[data-version-id="version-branch"]').getByRole('button', { name: 'Branch look, not favorited' })).toBeEnabled();
  await expect(page.getByText('Added to favorites.', { exact: true })).toHaveCount(0);
  const snapshot = await page.evaluate(() => window.__v2GarageHarness?.project('owner-a'));
  expect(snapshot?.coverVersionId).toBe('version-branch');
  expect(snapshot?.versions.find(version => version.id === 'version-branch')?.favorite).toBe(false);
});

test('share cancellation and unavailable stay distinct from opened', async ({ page }) => {
  for (const [outcome, expected] of [['cancelled', 'Sharing cancelled.'], ['unavailable', 'Sharing is unavailable here.']]) {
    await page.goto(`/tests/harness/v2.html?feature=garage&share=${outcome}`);
    await page.getByRole('button', { name: 'Export clean image' }).click();
    await page.getByRole('button', { name: 'Open share sheet' }).click();
    await expect(page.getByTestId('garage-status')).toHaveText(expected);
  }
});

test('replaced and deselected export previews revoke their object URLs', async ({ page }) => {
  await page.addInitScript(() => {
    const urls = { created: [] as string[], revoked: [] as string[] };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    Object.assign(window, { __garageUrls: urls });
    URL.createObjectURL = blob => { const url = create(blob); urls.created.push(url); return url; };
    URL.revokeObjectURL = url => { urls.revoked.push(url); revoke(url); };
  });
  await page.goto('/tests/harness/v2.html?feature=garage');
  await page.getByRole('button', { name: 'Export clean image' }).click();
  await expect.poll(() => page.evaluate(() => window.__garageUrls?.created.length ?? 0)).toBe(1);
  await page.getByRole('button', { name: 'Export portrait recipe' }).click();
  await expect.poll(() => page.evaluate(() => window.__garageUrls?.revoked.length ?? 0)).toBe(1);
  await page.locator('[data-version-id="version-old"] .v2-garage__select').click();
  await expect.poll(() => page.evaluate(() => window.__garageUrls?.revoked.length ?? 0)).toBe(2);
  const urls = await page.evaluate(() => window.__garageUrls);
  expect(urls?.revoked).toEqual(urls?.created);
});

test('comparison changes retain acknowledged cover and favorite metadata', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=garage');
  await page.locator('[data-version-id="version-new"]').getByRole('button', { name: 'Set as project cover' }).click();
  await page.locator('[data-version-id="version-branch"]').getByRole('button', { name: 'Branch look, not favorited' }).click();
  await page.getByRole('combobox', { name: 'Compare this version with' }).selectOption('version-branch');
  await expect(page.getByTestId('garage-comparison')).toHaveAttribute('data-before-source', 'version-branch');
  await expect(page.getByRole('img', { name: 'Project cover: Newest look' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Branch look, favorited' })).toBeVisible();
});

test('garage controls and static export fit mobile widths and enlarged text', async ({ page }) => {
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/tests/harness/v2.html?feature=garage');
    await page.getByRole('button', { name: 'Export portrait recipe' }).click();
    await expect(page.getByRole('img', { name: 'Static export preview' })).toBeVisible();
    const metrics = await page.locator('.v2-garage').evaluate(node => ({
      width: document.documentElement.scrollWidth,
      targets: [...node.querySelectorAll('button, input, select, a')].map(control => {
        const rect = control.getBoundingClientRect(); return Math.min(rect.width, rect.height);
      }),
    }));
    expect(metrics.width).toBeLessThanOrEqual(width);
    expect(Math.min(...metrics.targets)).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const duration = await page.locator('.v2-garage').evaluate(node => getComputedStyle(node).transitionDuration);
  expect(Number.parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000)).toBeLessThanOrEqual(0.01);
});

test('actual browser decode rejects corrupt owned PNG bytes without an export success', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=garage&asset=corrupt');
  await page.getByRole('button', { name: 'Export clean image' }).click();
  await expect(page.getByRole('alert')).toContainText('Export is unavailable');
  await expect(page.getByRole('region', { name: 'Static export' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download PNG' })).toHaveCount(0);
});
