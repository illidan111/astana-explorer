import { test, expect } from '@playwright/test';

test('valid place links open before the optional map and unknown links are ignored', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/vendor/leaflet/leaflet.js*', (route) => route.abort());
  await page.goto('/#place=baiterek', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('dialog', { name: 'Байтерек', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { location.hash = 'place=unknown'; });
  await expect(page.locator('#attraction-card')).not.toBeVisible();
  await page.evaluate(() => { location.hash = 'place=astana-opera'; });
  await expect(page.locator('#card-name')).toHaveText('Астана Опера');
  await expect(page.locator('#attraction-card')).toBeVisible();
  expect(errors).toEqual([]);
});

test('sharing copies only the selected place and preserves the current URL and history', async ({ page }) => {
  await page.addInitScript(() => {
    window.copiedPlaceLinks = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value) => { window.copiedPlaceLinks.push(value); } }
    });
  });
  await page.goto('/?draft=private#place=baiterek', { waitUntil: 'domcontentloaded' });
  const currentUrl = page.url();
  const historyLength = await page.evaluate(() => history.length);
  await page.locator('#share-place').click();
  await expect(page.locator('#share-status')).toContainText('скопирована');
  await expect(page.locator('#share-status')).toBeVisible();
  expect(await page.evaluate(() => window.copiedPlaceLinks)).toEqual([
    `${new URL(currentUrl).origin}/#place=baiterek`
  ]);
  expect(page.url()).toBe(currentUrl);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await expect(page.locator('#share-fallback')).toBeHidden();
  await page.keyboard.press('Escape');
  if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
  await page.locator('[data-place-id="khan-shatyr"]').click();
  await expect(page.locator('#share-status')).toBeEmpty();
  await page.locator('#share-place').click();
  await expect.poll(() => page.evaluate(() => window.copiedPlaceLinks.at(-1)))
    .toBe(`${new URL(currentUrl).origin}/#place=khan-shatyr`);
  expect(page.url()).toBe(currentUrl);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
});

test('denied clipboard access exposes a selected copyable link inside the dialog', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } }
    });
  });
  await page.goto('/#place=baiterek', { waitUntil: 'domcontentloaded' });
  await page.locator('#share-place').click();
  const link = page.locator('#share-url');
  await expect(page.locator('#share-fallback')).toBeVisible();
  await expect(link).toBeFocused();
  await expect(link).toBeInViewport();
  await expect(link).toHaveValue(`${new URL(page.url()).origin}/#place=baiterek`);
  await expect(link).toHaveAttribute('readonly', '');
  expect(await link.evaluate((input) => input.selectionEnd - input.selectionStart)).toBe((await link.inputValue()).length);
  await expect(page.locator('#share-status')).toContainText('Скопируйте выделенную ссылку');
  await expect(page.locator('#share-status')).toBeVisible();
  await page.keyboard.press('Escape');
  if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
  await page.locator('[data-place-id="khan-shatyr"]').click();
  await expect(page.locator('#share-fallback')).toBeHidden();
});

test('a pending copy cannot change a reopened card after switching places', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => new Promise((resolve) => { window.finishPlaceCopy = resolve; }) }
    });
  });
  await page.goto('/#place=baiterek', { waitUntil: 'domcontentloaded' });
  await page.locator('#share-place').click();
  await expect(page.locator('#share-place')).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => { location.hash = 'place=khan-shatyr'; });
  await expect(page.locator('#card-name')).toHaveText('Хан Шатыр');
  await expect(page.locator('#share-place')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => { location.hash = 'place=baiterek'; });
  await expect(page.locator('#card-name')).toHaveText('Байтерек');
  await page.evaluate(async () => { window.finishPlaceCopy(); await Promise.resolve(); });
  await expect(page.locator('#share-status')).toBeHidden();
  await expect(page.locator('#share-status')).toBeEmpty();
  await expect(page.locator('#share-place')).toHaveAttribute('aria-busy', 'false');
});
