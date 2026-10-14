import { expect, test, type Page } from '@playwright/test';

async function openEntry(page: Page, suffix = '') {
  const calls: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/v2/')) calls.push(request.url()); });
  await page.goto(`/tests/harness/v2.html?feature=entry${suffix}`);
  return calls;
}

async function intent(page: Page) {
  return JSON.parse(await page.getByTestId('entry-intent').textContent() ?? 'null');
}

async function localPhoto(page: Page) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 40; canvas.height = 20;
    canvas.getContext('2d')!.fillRect(0, 0, 40, 20);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  return { name: 'synthetic-entry.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') };
}

test('try-case enters local photo directly and retains the exact preset intent', async ({ page }) => {
  const calls = await openEntry(page);
  await expect(page.getByRole('heading', { name: 'Find your next look.' })).toBeVisible();
  await page.getByRole('button', { name: 'Try this look on my car' }).click();
  await expect(page.getByRole('heading', { name: 'Start with the photo.' })).toBeVisible();
  expect(await intent(page)).toEqual({ schemaVersion: 2, source: { kind: 'original' }, operation: 'explore', styleId: 'clean', edits: {} });
  await expect(page.getByRole('heading', { name: 'About this direction' })).toHaveCount(0);
  await page.getByLabel('Choose a photo').setInputFiles(await localPhoto(page));
  const preview = page.getByRole('img', { name: /Selected photo preview/ });
  await expect(preview).toBeVisible();
  const before = await preview.getAttribute('src');
  await page.getByLabel('Choose a photo').setInputFiles([]);
  await expect(preview).toHaveAttribute('src', before!);
  expect((await intent(page)).styleId).toBe('clean');
  await expect(page.getByRole('button', { name: 'Upload photo' })).toBeDisabled();
  expect(calls).toEqual([]);
});

test('original detail entry contains no whole-car preset and navigation makes no request', async ({ page }) => {
  const calls = await openEntry(page);
  await page.getByRole('button', { name: 'Change one detail', exact: true }).click();
  expect(await intent(page)).toEqual({ schemaVersion: 2, source: { kind: 'original' }, operation: 'detail', edits: {} });
  await page.getByRole('button', { name: 'Back to Discover' }).click();
  await expect(page.getByRole('heading', { name: 'Find your next look.' })).toBeVisible();
  await page.getByRole('button', { name: 'View style details' }).click();
  await expect(page.getByRole('heading', { name: 'About this direction' })).toBeVisible();
  await page.getByRole('button', { name: 'Try this look on my car' }).click();
  expect((await intent(page)).operation).toBe('explore');
  expect(calls).toEqual([]);
});

test('closed capabilities reject restored entry while old style history remains readable', async ({ page }) => {
  const calls = await openEntry(page, '&closed=1&restore=explore');
  await expect(page.getByRole('heading', { name: 'Find your next look.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try this look on my car' })).toBeDisabled();
  await expect(page.getByText('This direction is not available for new looks.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Earlier rally look' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue Earlier rally look' }).click();
  await expect(page.getByTestId('entry-events')).toContainText('project-own:version-old');
  expect(calls).toEqual([]);
});

test('a capability closed during photo entry invalidates the restored selection', async ({ page }) => {
  const calls = await openEntry(page);
  await page.getByRole('button', { name: 'Try this look on my car' }).click();
  await expect(page.getByRole('heading', { name: 'Start with the photo.' })).toBeVisible();
  await page.getByRole('button', { name: 'Close entry capabilities' }).click();
  await expect(page.getByRole('heading', { name: 'Find your next look.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try this look on my car' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Change one detail', exact: true })).toBeDisabled();
  expect(calls).toEqual([]);
});

test('returning context is owner-scoped, preserves the older favorite and active task', async ({ page }) => {
  const calls = await openEntry(page);
  const recent = page.getByRole('region', { name: 'Your work' });
  await expect(recent.getByText('Favorite · rally')).toBeVisible();
  await expect(page.getByText('Other account private car')).toHaveCount(0);
  const before = await recent.evaluate(element => element.getBoundingClientRect().top);
  const hero = await page.getByRole('heading', { name: 'Find your next look.' }).evaluate(element => element.getBoundingClientRect().top);
  expect(before).toBeLessThan(hero);
  await page.getByRole('button', { name: 'Continue Earlier rally look' }).click();
  await expect(page.getByTestId('entry-events')).toHaveText('project-own:version-old');
  await page.getByRole('button', { name: 'Check active task' }).click();
  await expect(page.getByTestId('entry-events')).toHaveText('task-own');
  expect(calls).toEqual([]);
});

test('account switch clears local entry and previous account context', async ({ page }) => {
  await openEntry(page);
  await page.getByRole('button', { name: 'Change one detail', exact: true }).click();
  await page.getByLabel('Choose a photo').setInputFiles(await localPhoto(page));
  await expect(page.getByRole('img', { name: /Selected photo preview/ })).toBeVisible();
  await page.getByRole('button', { name: 'Switch entry account' }).click();
  await expect(page.getByRole('heading', { name: 'Find your next look.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Earlier rally look' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: /Selected photo preview/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch entry account' }).click();
  await expect(page.getByRole('heading', { name: 'Find your next look.' })).toBeVisible();
});

test('missing case publication never invents a real example or enables a preset', async ({ page }) => {
  const calls = await openEntry(page, '&missing=1&restore=explore');
  await expect(page.getByText('A verified example is not available yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try this look on my car' })).toBeDisabled();
  await expect(page.getByRole('img', { name: /case/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change one detail', exact: true }).click();
  expect((await intent(page)).operation).toBe('detail');
  expect(calls).toEqual([]);
});

test('entry controls fit mobile widths, large text and reduced motion', async ({ page }) => {
  await openEntry(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const button = page.getByRole('button', { name: 'Try this look on my car' });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await button.focus();
    await expect(button).toHaveCSS('outline-style', 'solid');
  }
});
