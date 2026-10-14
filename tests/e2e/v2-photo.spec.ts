import { expect, test, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';

async function canvasFile(page: Page, width = 320, height = 180) {
  const encoded = await page.evaluate(async ({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#d2fa69';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#22271f';
    context.fillRect(width * 0.13, height * 0.18, width * 0.58, height * 0.55);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('canvas PNG failed')), 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, { width, height });
  return { name: 'synthetic-local-photo.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') };
}

async function orientedJpegFile(page: Page) {
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 60;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#d2fa69';
    context.fillRect(0, 0, 120, 60);
    context.fillStyle = '#22271f';
    context.fillRect(0, 0, 60, 60);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('canvas JPEG failed')), 'image/jpeg'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  const jpeg = Buffer.from(encoded, 'base64');
  const exif = Buffer.from([
    69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0,
    18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const app1 = Buffer.alloc(exif.length + 4);
  app1.set([255, 225, (exif.length + 2) >> 8, (exif.length + 2) & 255]);
  exif.copy(app1, 4);
  return { name: 'synthetic-rotated.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]) };
}

async function requests(page: Page) {
  return page.evaluate(() => (window as unknown as { __FORM_V2_TEST__: { requests: unknown[] } }).__FORM_V2_TEST__.requests);
}

test('photo selection and removal stay local and release the preview URL', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo');
  await expect(page.getByRole('heading', { name: 'Start with the photo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload photo' })).toBeDisabled();
  await page.getByLabel('Choose a photo').setInputFiles(await canvasFile(page));
  await expect(page.getByRole('img', { name: /Selected photo preview/ })).toBeVisible();
  await expect(page.getByText('320 × 180 px')).toBeVisible();
  expect(await requests(page)).toHaveLength(0);
  await page.screenshot({ path: test.info().outputPath('photo.png'), fullPage: true });
  await page.getByRole('button', { name: 'Remove selection' }).click();
  await expect(page.getByRole('img', { name: /Selected photo preview/ })).toHaveCount(0);
  expect(await requests(page)).toHaveLength(0);
  const urls = await page.evaluate(() => (window as unknown as { __FORM_V2_TEST__: { urls: { created: string[]; revoked: string[] } } }).__FORM_V2_TEST__.urls);
  expect(urls.created.length).toBeGreaterThan(0);
  expect(urls.revoked).toContain(urls.created[0]);
});

test('trusted disclosure and both upload acknowledgments precede consent then project upload', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo');
  await page.getByLabel('Choose a photo').setInputFiles(await canvasFile(page));
  const upload = page.getByRole('button', { name: 'Upload photo' });
  await expect(upload).toBeDisabled();
  await page.getByLabel('I have the right to use this photo').check();
  await expect(upload).toBeDisabled();
  await page.getByLabel('I agree to upload and store this photo').check();
  await expect(upload).toBeEnabled();
  await upload.click();
  await expect(page.getByRole('status')).toContainText('Your photo was added to a new project.');
  const log = await requests(page) as Array<{ path: string; method: string; consent?: { acknowledgePhotoRights: boolean; acknowledgeUploadStorage: boolean; acknowledgeSharing: boolean }; project?: { consentId: string; size: number } }>;
  expect(log.map(request => request.path)).toEqual(['/api/v2/consents', '/api/v2/projects']);
  expect(log[0]?.consent).toEqual({ policyId: 'policy-fixture-v1', acknowledgePhotoRights: true, acknowledgeUploadStorage: true, acknowledgeSharing: false });
  expect(log[1]?.project).toEqual({ consentId: 'consent-fixture', size: expect.any(Number) });
});

test('missing published disclosure keeps upload disabled and sends no request', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo&policy=missing');
  await page.getByLabel('Choose a photo').setInputFiles(await canvasFile(page));
  await page.getByLabel('I have the right to use this photo').check();
  await page.getByLabel('I agree to upload and store this photo').check();
  await expect(page.getByRole('button', { name: 'Upload photo' })).toBeDisabled();
  await expect(page.getByRole('note')).toContainText('Consent details are unavailable, so upload is disabled.');
  expect(await requests(page)).toHaveLength(0);
});

test('failed consent does not upload the project', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo&consent=fail');
  await page.getByLabel('Choose a photo').setInputFiles(await canvasFile(page));
  await page.getByLabel('I have the right to use this photo').check();
  await page.getByLabel('I agree to upload and store this photo').check();
  await page.getByRole('button', { name: 'Upload photo' }).click();
  await expect(page.getByRole('status')).toContainText('Consent is unavailable right now.');
  expect((await requests(page)).map((request) => (request as { path: string }).path)).toEqual(['/api/v2/consents']);
});

test('removing the photo while consent is pending prevents project transmission', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo&consent=delay');
  await page.getByLabel('Choose a photo').setInputFiles(await canvasFile(page));
  await page.getByLabel('I have the right to use this photo').check();
  await page.getByLabel('I agree to upload and store this photo').check();
  await page.getByRole('button', { name: 'Upload photo' }).click();
  await page.getByRole('button', { name: 'Remove selection' }).click();
  await page.waitForTimeout(800);
  expect((await requests(page)).map((request) => (request as { path: string }).path)).toEqual(['/api/v2/consents']);
});

test('leaving the photo screen while consent is pending prevents a later hidden project upload', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo&consent=delay');
  await page.getByLabel('Choose a photo').setInputFiles(await canvasFile(page));
  await page.getByLabel('I have the right to use this photo').check();
  await page.getByLabel('I agree to upload and store this photo').check();
  await page.getByRole('button', { name: 'Upload photo' }).click();
  expect(await requests(page)).toHaveLength(1);
  await page.evaluate(() => (window as unknown as { __FORM_V2_UNMOUNT__: () => void }).__FORM_V2_UNMOUNT__());
  await page.waitForTimeout(800);
  expect((await requests(page)).map(request => (request as { path: string }).path)).toEqual(['/api/v2/consents']);
});

test('same upload cannot start a second consent request while the first is pending', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo&consent=delay');
  await page.getByLabel('Choose a photo').setInputFiles(await canvasFile(page));
  await page.getByLabel('I have the right to use this photo').check();
  await page.getByLabel('I agree to upload and store this photo').check();
  await page.getByRole('button', { name: 'Upload photo' }).click();
  await expect(page.getByRole('button', { name: 'Uploading…' })).toBeDisabled();
  expect(await requests(page)).toHaveLength(1);
  await page.waitForTimeout(800);
  expect((await requests(page)).map((request) => (request as { path: string }).path)).toEqual(['/api/v2/consents', '/api/v2/projects']);
});

test('account change during consent prevents the next project request', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo&consent=delay');
  await page.getByLabel('Choose a photo').setInputFiles(await canvasFile(page));
  await page.getByLabel('I have the right to use this photo').check();
  await page.getByLabel('I agree to upload and store this photo').check();
  await page.getByRole('button', { name: 'Upload photo' }).click();
  await page.getByRole('button', { name: 'Switch synthetic account' }).click();
  await page.waitForTimeout(800);
  expect((await requests(page)).map((request) => (request as { path: string }).path)).toEqual(['/api/v2/consents']);
  await expect(page.getByRole('img', { name: /Selected photo preview/ })).toHaveCount(0);
});

test('ambiguous project upload is not retransmitted automatically', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo&project=ambiguous');
  await page.getByLabel('Choose a photo').setInputFiles(await canvasFile(page));
  await page.getByLabel('I have the right to use this photo').check();
  await page.getByLabel('I agree to upload and store this photo').check();
  await page.getByRole('button', { name: 'Upload photo' }).click();
  await expect(page.getByRole('status')).toContainText('The upload status is unclear. This photo was not sent again.');
  await page.waitForTimeout(200);
  const paths = (await requests(page)).map((request) => (request as { path: string }).path);
  expect(paths).toEqual(['/api/v2/consents', '/api/v2/projects']);
});

test('real PNG signature overrides misleading file name and MIME metadata', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo');
  const source = await canvasFile(page);
  await page.getByLabel('Choose a photo').setInputFiles({ ...source, name: 'misleading.heic', mimeType: 'image/jpeg' });
  await expect(page.getByRole('img', { name: /Selected photo preview/ })).toBeVisible();
  await expect(page.getByText('320 × 180 px')).toBeVisible();
  expect(await requests(page)).toHaveLength(0);
});

test('JPEG EXIF orientation is applied by the browser decoder before preview dimensions are shown', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo');
  await page.getByLabel('Choose a photo').setInputFiles(await orientedJpegFile(page));
  await expect(page.getByText('60 × 120 px · orientation corrected')).toBeVisible();
  await expect(page.getByRole('img', { name: /Selected photo preview/ })).toBeVisible();
  expect(await requests(page)).toHaveLength(0);
});

test('pixel limit is rejected from bounded image headers before browser decode', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo');
  const source = await canvasFile(page);
  const oversized = Buffer.from(source.buffer);
  oversized.writeUInt32BE(100_000, 16);
  oversized.writeUInt32BE(500, 20);
  await page.getByLabel('Choose a photo').setInputFiles({ ...source, buffer: oversized });
  await expect(page.getByRole('status')).toContainText('This photo is too large to process. Choose a smaller image.');
  expect(await requests(page)).toHaveLength(0);
});

test('HEIC signature has an actionable browser limitation regardless of extension or MIME', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo');
  const bytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99, 0, 0, 0, 0]);
  await page.getByLabel('Choose a photo').setInputFiles({ name: 'misleading.jpg', mimeType: 'image/png', buffer: bytes });
  await expect(page.getByRole('status')).toContainText('This HEIC photo cannot be opened in this browser yet.');
  await expect(page.getByRole('button', { name: 'Upload photo' })).toBeDisabled();
  expect(await requests(page)).toHaveLength(0);
});

test('unreadable photo gives an iCloud recovery step without making a request', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo');
  const source = await canvasFile(page);
  await page.getByLabel('Choose a photo').setInputFiles({ ...source, buffer: source.buffer.subarray(0, 48) });
  await expect(page.getByRole('status')).toContainText('If it is stored in iCloud, download it to your device and try again.');
  expect(await requests(page)).toHaveLength(0);
});

test('large text and a 320px viewport keep controls usable without horizontal overflow', async ({ page }) => {
  await page.goto('/tests/harness/v2.html?feature=photo');
  await page.setViewportSize({ width: 320, height: 780 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Switch synthetic account' })).toHaveCSS('outline-width', '3px');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator('.photo-choose')).toHaveCSS('outline-style', 'solid');
  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
    overflowing: Array.from(document.querySelectorAll<HTMLElement>('body *')).map(element => ({
      tag: element.tagName,
      className: String(element.className),
      right: Math.round(element.getBoundingClientRect().right),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    })).filter(element => element.right > window.innerWidth + 1 || element.scrollWidth > element.clientWidth + 1),
  }));
  expect(dimensions.document, JSON.stringify(dimensions.overflowing)).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByRole('button', { name: 'Upload photo' })).toBeVisible();
});
