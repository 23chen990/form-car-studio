import { expect, test, type Page } from '@playwright/test';

const observedApiRequests = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const requests: string[] = []; observedApiRequests.set(page, requests);
  await page.route('**/api/**', async route => {
    requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.abort();
  });
});
test.afterEach(async ({ page }) => { expect(observedApiRequests.get(page)).toEqual([]); });

interface ResultHarnessEvent {
  type: string;
  ownerId?: string;
  projectId?: string;
  versionId?: string;
  source?: { kind: 'original' } | { kind: 'version'; versionId: string };
  favorite?: boolean;
  category?: string;
  description?: string;
}

declare global {
  interface Window {
    __v2ResultHarness?: {
      events(): ResultHarnessEvent[];
      modelCalls(): { method: string; path: string }[];
      holdFavorite(): void;
      favoriteHeld(): boolean;
      releaseFavorite(): void;
      failNextFeedback(): void;
    };
  }
}

test('only the selected succeeded version is shown, and refine preserves its exact source', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/harness/v2.html?feature=result');
  await expect(page.getByRole('region', { name: 'Result' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Selected result: Newer look' })).toBeVisible();
  await expect(page.getByText('Saved to your garage.', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Show Earlier look version' }).click();
  await expect(page.getByRole('img', { name: 'Selected result: Earlier look' })).toBeVisible();
  await page.getByRole('button', { name: 'Refine this version' }).click();
  await page.getByRole('button', { name: 'Start again from original' }).click();

  const sources = await page.evaluate(() => window.__v2ResultHarness?.events().filter(event => event.type === 'refine').map(event => event.source) ?? []);
  expect(sources).toEqual([
    { kind: 'version', versionId: 'version-old' },
    { kind: 'original' },
  ]);
  expect(await page.evaluate(() => window.__v2ResultHarness?.modelCalls() ?? [])).toEqual([]);
});

test('rejects owner, project, task, version and image mismatches without a sample fallback', async ({ page }) => {
  for (const scenario of ['owner', 'project', 'status', 'result-version', 'version-task', 'image', 'image-load']) {
    await page.goto(`/tests/harness/v2.html?feature=result&invalid=${scenario}`);
    await expect(page.getByRole('heading', { name: 'Result unavailable' })).toBeVisible();
    await expect(page.getByRole('img')).toHaveCount(0);
    await expect(page.getByText(/sample|example/i)).toHaveCount(0);
  }
});

test('a nonempty result URL that fails to load never appears ready or uses a fallback image', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=result&invalid=image-load');
  await expect(page.getByRole('heading', { name: 'Result unavailable' })).toBeVisible();
  await expect(page.getByText('Saved to your garage.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save to Photos' })).toHaveCount(0);
});

test('compares original, the actual parent, and arbitrary versions within one project without generation', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=result');
  const compareWith = page.getByRole('combobox', { name: 'Compare with' });
  const comparison = page.getByTestId('result-comparison');
  await expect(comparison).toHaveAttribute('data-before-source', 'original');
  await compareWith.selectOption('version:version-old');
  await expect(comparison).toHaveAttribute('data-before-source', 'version:version-old');
  await expect(page.getByTestId('result-comparison-label')).toHaveText('Parent version · Earlier look');
  await compareWith.selectOption('version:version-other');
  await expect(comparison).toHaveAttribute('data-before-source', 'version:version-other');
  await expect(page.getByTestId('result-comparison-label')).toHaveText('Other version · Alternate look');
  expect(await page.evaluate(() => window.__v2ResultHarness?.modelCalls() ?? [])).toEqual([]);
});

test('favorite acknowledgement and Photos save stay distinct from automatic garage persistence', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=result');
  await expect(page.getByText('Saved to your garage.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
  await page.getByRole('button', { name: 'Save to Photos' }).click();
  await expect(page.getByTestId('result-action-message')).toHaveText('Saved a copy to Photos.');
  const events = await page.evaluate(() => window.__v2ResultHarness?.events() ?? []);
  expect(events.map(event => event.type)).toEqual(['favorite', 'device_save']);
  expect(events[0]).toMatchObject({ ownerId: 'owner-a', projectId: 'project-1', versionId: 'version-new', favorite: true });
  expect(await page.evaluate(() => window.__v2ResultHarness?.modelCalls() ?? [])).toEqual([]);
});

test('Photos cancellation and unavailable outcomes are reported distinctly', async ({ page }) => {
  for (const [outcome, message] of [
    ['cancelled', 'Save to Photos cancelled.'],
    ['unavailable', 'Saving to Photos is unavailable here.'],
  ]) {
    await page.goto(`/tests/harness/v2.html?feature=result&device=${outcome}`);
    await page.getByRole('button', { name: 'Save to Photos' }).click();
    await expect(page.getByTestId('result-action-message')).toHaveText(message);
  }
});

test('late favorite acknowledgement cannot cross an owner ABA switch', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=result');
  await page.getByRole('button', { name: 'Hold next favorite acknowledgement' }).click();
  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await expect.poll(() => page.evaluate(() => window.__v2ResultHarness?.favoriteHeld() ?? false)).toBe(true);
  await page.getByRole('button', { name: 'Switch result owner' }).click();
  await expect(page.getByRole('heading', { name: 'Selected result: Account B look' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch result owner' }).click();
  await expect(page.getByRole('button', { name: 'Add to favorites' })).toBeVisible();
  await page.getByRole('button', { name: 'Release held favorite acknowledgement' }).click();
  await expect(page.getByRole('button', { name: 'Add to favorites' })).toBeVisible();
});

test('feedback category and text survive failure and retry without an automatic refund', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=result');
  const identity = page.getByRole('radio', { name: 'The car identity changed' });
  await identity.check();
  await page.getByRole('textbox', { name: 'Tell us more (optional)' }).fill('Synthetic note for the result fixture.');
  await page.getByRole('button', { name: 'Fail next feedback' }).click();
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByRole('alert')).toHaveText('We could not save this report. Your category and notes are still here.');
  await expect(identity).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Tell us more (optional)' })).toHaveValue('Synthetic note for the result fixture.');

  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByText('Your report was saved. This does not automatically issue a refund.', { exact: true })).toBeVisible();
  const feedback = (await page.evaluate(() => window.__v2ResultHarness?.events() ?? [])).filter(event => event.type === 'feedback');
  expect(feedback).toHaveLength(1);
  expect(feedback[0]).toMatchObject({ ownerId: 'owner-a', projectId: 'project-1', versionId: 'version-new', category: 'identity_changed', description: 'Synthetic note for the result fixture.' });
  expect(await page.evaluate(() => window.__v2ResultHarness?.modelCalls() ?? [])).toEqual([]);
  await expect(page.getByRole('button', { name: /refund/i })).toHaveCount(0);
});

test('result controls fit small screens, enlarged text and reduced motion', async ({ page }) => {
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/tests/harness/v2.html?feature=result');
    const metrics = await page.locator('.v2-result').evaluate(node => {
      const buttons = [...node.querySelectorAll('button')].map(button => button.getBoundingClientRect());
      return {
        pageWidth: document.documentElement.scrollWidth,
        minimumTarget: Math.min(...buttons.flatMap(rect => [rect.width, rect.height])),
      };
    });
    expect(metrics.pageWidth).toBeLessThanOrEqual(width);
    expect(metrics.minimumTarget).toBeGreaterThanOrEqual(44);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMotionDuration = await page.locator('.v2-result').evaluate(node => getComputedStyle(node).transitionDuration);
  const reducedMotionMs = reducedMotionDuration.endsWith('ms') ? Number.parseFloat(reducedMotionDuration) : Number.parseFloat(reducedMotionDuration) * 1000;
  expect(reducedMotionMs).toBeLessThanOrEqual(0.01);
});
