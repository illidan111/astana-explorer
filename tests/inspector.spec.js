import { test, expect } from '@playwright/test';
import { useLocalMapTiles } from './helpers/map-tiles.js';

async function openCatalogue(page) {
  await useLocalMapTiles(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#map')).toHaveAttribute('aria-busy', 'false');
  if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
}

async function expectMarkerUsable(page, id) {
  const marker = page.locator(`[data-marker-id="${id}"]`);
  await expect(marker).toBeVisible();
  expect(await marker.evaluate((element) => {
    const bounds = document.getElementById('map').getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.left >= bounds.left && rect.right <= bounds.right
      && rect.top >= bounds.top && rect.bottom <= bounds.bottom
      && (hit === element || element.contains(hit));
  })).toBe(true);
  await expect(marker).toHaveClass(/is-selected/);
}

test('desktop inspector links selection to the map and keeps map controls and markers usable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'This is the desktop inspector workflow.');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openCatalogue(page);
  await page.locator('[data-place-id="baiterek"]').click();
  const card = page.locator('#attraction-card');
  await expect(card).toBeVisible();
  expect(await card.evaluate((dialog) => dialog.matches(':modal'))).toBe(false);
  await expect(card).toHaveAttribute('aria-modal', 'false');
  await expectMarkerUsable(page, 'baiterek');
  await expect(page.locator('[data-place-id="baiterek"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.place-map-label').filter({ hasText: /^Байтерек$/ })).toBeVisible();

  const marker = page.locator('[data-marker-id="nur-astana-mosque"]');
  await marker.click();
  await expect(page.locator('#card-name')).toHaveText('Мечеть Абу Насыр аль-Фараби');
  await expectMarkerUsable(page, 'nur-astana-mosque');
  await expect(page.locator('[data-place-id="baiterek"]')).toHaveAttribute('aria-current', 'false');
  await expect(page.locator('[data-place-id="nur-astana-mosque"]')).toHaveAttribute('aria-current', 'true');
  await page.locator('#zoom-in').click();
  await expect(card).toBeVisible();
  await expectMarkerUsable(page, 'nur-astana-mosque');
  expect(errors).toEqual([]);
});

test('search, categories and favorites dismiss excluded desktop details without stealing focus', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Mobile controls are behind a modal sheet.');
  await openCatalogue(page);
  const card = page.locator('#attraction-card');
  const search = page.locator('#search-input');
  await page.locator('[data-place-id="baiterek"]').click();
  await search.fill('Бай');
  await expect(card).toBeVisible();
  await expect(search).toBeFocused();
  await search.fill('парк');
  await expect(card).not.toBeVisible();
  await expect(search).toBeFocused();
  await expect(page.locator('.attraction-list-button[aria-current="true"]')).toHaveCount(0);
  await page.locator('#clear-search').click();

  await page.locator('[data-place-id="baiterek"]').click();
  const parks = page.locator('[data-filter="park"]');
  await parks.click();
  await expect(card).not.toBeVisible();
  await expect(parks).toBeFocused();
  await parks.click();
  await page.locator('[data-place-id="baiterek"]').click();
  const favorites = page.locator('#favorites-button');
  await favorites.click();
  await expect(card).not.toBeVisible();
  await expect(favorites).toBeFocused();
  await expect(page.locator('.is-selected[data-marker-id]')).toHaveCount(0);
});

test('desktop keyboard can leave the inspector and reach search while it remains open', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Mobile keeps modal keyboard navigation.');
  await openCatalogue(page);
  const opener = page.locator('[data-place-id="baiterek"]');
  await opener.click();
  await page.locator('#attraction-card .source-details summary').focus();
  await page.keyboard.press('Tab');
  expect(await page.locator('#attraction-card').evaluate((dialog) => dialog.contains(document.activeElement))).toBe(false);
  await page.keyboard.press('/');
  await expect(page.locator('#search-input')).toBeFocused();
  await expect(page.locator('#attraction-card')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#attraction-card')).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test('crossing the mobile breakpoint preserves the selected place, share state, expanded sources and focus', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Explicit viewport transitions run once.');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } }
    });
  });
  await openCatalogue(page);
  await page.locator('[data-place-id="baiterek"]').click();
  await page.locator('#attraction-card .source-details summary').click();
  await page.locator('#share-place').click();
  const input = page.locator('#share-url');
  const value = await input.inputValue();
  await expect(input).toBeFocused();

  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    const modal = viewport.width <= 760;
    await expect.poll(() => page.locator('#attraction-card').evaluate((dialog) => dialog.matches(':modal'))).toBe(modal);
    await expect(page.locator('#card-name')).toHaveText('Байтерек');
    await expect(page.locator('#share-fallback')).toBeVisible();
    await expect(input).toHaveValue(value);
    await expect(input).toBeFocused();
    await expect(page.locator('#attraction-card .source-details')).toHaveAttribute('open', '');
    await expect(page.locator('#share-status')).toContainText('Скопируйте выделенную ссылку');
  }
  await page.locator('#close-button').click();
  await expect(page.locator('[data-place-id="baiterek"]')).toBeFocused();
  expect(errors).toEqual([]);
});

test('list hover identifies its marker and map labels disappear when returning to the overview', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'This interaction requires a pointer.');
  await openCatalogue(page);
  const row = page.locator('[data-place-id="baiterek"]');
  await row.hover();
  await expect(page.locator('[data-marker-id="baiterek"]')).toHaveClass(/is-highlighted/);
  await row.click();
  await expect(page.locator('.place-map-label').filter({ hasText: /^Байтерек$/ })).toBeVisible();
  await page.locator('#fit-map').click();
  await expect(page.locator('.place-map-label')).toHaveCount(0);
  await expect(page.locator('#attraction-card')).toBeVisible();
});

test('resizing keeps an in-flight share and the available scroll position', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Explicit viewport transitions run once.');
  await page.setViewportSize({ width: 1440, height: 520 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => new Promise((resolve) => { window.finishShare = resolve; }) }
    });
  });
  await openCatalogue(page);
  await page.locator('[data-place-id="baiterek"]').click();
  await page.locator('#attraction-card .source-details summary').click();
  await page.locator('#share-place').click();
  const card = page.locator('#attraction-card');
  const before = await card.evaluate((dialog) => {
    dialog.scrollTop = 120;
    return dialog.scrollTop;
  });
  expect(before).toBeGreaterThan(0);
  await expect(page.locator('#share-place')).toHaveAttribute('aria-busy', 'true');
  await page.setViewportSize({ width: 390, height: 568 });
  await expect.poll(() => card.evaluate((dialog) => dialog.matches(':modal'))).toBe(true);
  await expect(page.locator('#share-place')).toHaveAttribute('aria-busy', 'true');
  const { current, maximum } = await card.evaluate((dialog) => ({
    current: dialog.scrollTop, maximum: dialog.scrollHeight - dialog.clientHeight
  }));
  expect(Math.abs(current - Math.min(before, maximum))).toBeLessThanOrEqual(2);
  await page.evaluate(() => window.finishShare());
  await expect(page.locator('#share-status')).toContainText('скопирована');
  await expect(page.locator('#share-place')).toHaveAttribute('aria-busy', 'false');
  await page.setViewportSize({ width: 1440, height: 520 });
  await expect.poll(() => card.evaluate((dialog) => dialog.matches(':modal'))).toBe(false);
  await expect(page.locator('#share-status')).toContainText('скопирована');
  await expect(page.locator('#card-name')).toHaveText('Байтерек');
});

test('mobile details keep the list view, trap keyboard navigation and reveal the place only on request', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'This is the mobile sheet workflow.');
  await openCatalogue(page);
  await page.locator('[data-place-id="baiterek"]').click();
  const card = page.locator('#attraction-card');
  expect(await card.evaluate((dialog) => dialog.matches(':modal'))).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'list');
  await page.locator('#close-button').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#attraction-card .source-details summary')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#close-button')).toBeFocused();
  await page.locator('#explore-button').click();
  await expect(card).not.toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'map');
  await expectMarkerUsable(page, 'baiterek');
  const marker = page.locator('[data-marker-id="baiterek"]');
  await marker.click();
  await expect(card).toBeVisible();
  expect(await card.evaluate((dialog) => dialog.matches(':modal'))).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'map');
  await page.keyboard.press('Escape');
  await expect(marker).toBeFocused();
});
