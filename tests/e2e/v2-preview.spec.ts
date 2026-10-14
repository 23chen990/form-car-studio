import { test, expect } from '@playwright/test';
test('keyboard button reaches example, restores focus and invokes no generation', async ({ page }) => {
  const calls: string[] = []; page.on('request', request => { if (/\/api\/v2\/(?:projects|plans|tasks|trial)/.test(request.url())) calls.push(request.url()); });
  await page.goto('/tests/harness/v2.html?feature=preview');
  const button = page.getByRole('button', { name: 'View example' }); await button.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Example preview' })).toBeVisible(); await expect(page.getByText('Demo color study', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(button).toBeFocused(); expect(calls).toEqual([]);
});
test('optional long press opens the same labeled example without billing', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=preview'); const box = await page.getByRole('button', { name: 'View example' }).boundingBox();
  await page.mouse.move(box!.x + 5, box!.y + 5); await page.mouse.down(); await expect(page.getByRole('dialog', { name: 'Example preview' })).toBeVisible(); await page.mouse.up();
  await expect(page.getByText('Example - not your car', { exact: true })).toBeVisible();
});
test('offline cached preview never falls back to another account after switch', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=preview'); await expect(page.getByRole('img', { name: 'Private cached preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Go offline' }).click(); await expect(page.getByRole('img', { name: 'Private cached preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch preview account' }).click(); await expect(page.getByRole('img', { name: 'Private cached preview' })).toHaveCount(0);
  await expect(page.getByText('You are offline. This image has not been downloaded.')).toBeVisible();
});
test('deleted project cached image disappears and offline copy stays missing', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=preview'); await expect(page.getByRole('img', { name: 'Private cached preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Go offline' }).click(); await page.getByRole('button', { name: 'Purge preview project' }).click();
  await expect(page.getByRole('img', { name: 'Private cached preview' })).toHaveCount(0); await expect(page.getByText('You are offline. This image has not been downloaded.')).toBeVisible();
});
