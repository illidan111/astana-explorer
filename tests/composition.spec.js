import { test, expect } from '@playwright/test';
import { useLocalMapTiles } from './helpers/map-tiles.js';

async function openApp(page) {
  await useLocalMapTiles(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#map')).toHaveAttribute('aria-busy', 'false');
}

async function box(locator) {
  const bounds = await locator.boundingBox();
  expect(bounds).toBeTruthy();
  return bounds;
}

test('desktop gives the catalogue primary space with two photo cards per row and a separate map', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop composition.');
  await openApp(page);
  await expect(page.locator('.site-header #search-input')).toBeVisible();
  const header = await box(page.locator('.site-header'));
  const categories = await box(page.locator('#filter-chips'));
  expect(categories.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(categories.width).toBeGreaterThan(page.viewportSize().width * .75);
  const catalogue = await box(page.locator('#list-view'));
  const map = await box(page.locator('.map-region'));
  const workspace = await box(page.locator('.workspace'));
  expect(catalogue.width / workspace.width).toBeGreaterThan(.52);
  expect(catalogue.width / workspace.width).toBeLessThan(.7);
  expect(map.width).toBeGreaterThan(320);
  expect(map.x).toBeGreaterThanOrEqual(catalogue.x + catalogue.width);

  const cards = page.locator('.attraction-list-button');
  const first = await box(cards.nth(0));
  const second = await box(cards.nth(1));
  expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
  expect(second.x).toBeGreaterThan(first.x + first.width);
  const photo = await box(cards.first().locator('.place-thumbnail'));
  const copy = await box(cards.first().locator('.place-copy'));
  expect(photo.width / first.width).toBeGreaterThan(.9);
  expect(copy.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
});

test('mobile opens the catalogue with full-width photo cards and switches explicitly to the map', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile composition.');
  await openApp(page);
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'list');
  await expect(page.locator('#view-list')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#view-map')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#list-view')).toBeVisible();
  await expect(page.locator('.map-region')).not.toBeVisible();
  const cards = page.locator('.attraction-list-button');
  const first = await box(cards.nth(0));
  const second = await box(cards.nth(1));
  const catalogue = await box(page.locator('#list-view'));
  expect(first.width / catalogue.width).toBeGreaterThan(.86);
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  expect(Math.abs(first.x - second.x)).toBeLessThanOrEqual(1);
  const photo = await box(cards.first().locator('.place-thumbnail'));
  const copy = await box(cards.first().locator('.place-copy'));
  expect(photo.width / first.width).toBeGreaterThan(.9);
  expect(copy.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  await page.locator('#view-map').click();
  await expect(page.locator('.map-region')).toBeVisible();
  await expect(page.locator('#list-view')).not.toBeVisible();
  await page.locator('#view-list').click();
  await expect(cards.first()).toBeVisible();
});

test('catalogue cards stay interactive during inspection and cancel an earlier pending share', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Nonmodal catalogue and inspector.');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => new Promise((resolve) => { window.completeCompositionShare = resolve; }) }
    });
  });
  await openApp(page);
  const first = page.locator('[data-place-id="baiterek"]');
  const second = page.locator('[data-place-id="khan-shatyr"]');
  const overview = await box(page.locator('#map'));
  const scroll = await page.locator('#attraction-list').evaluate((list) => list.scrollTop);
  await first.click();
  await expect(page.locator('#map-panel-inspector > #attraction-card')).toBeVisible();
  const map = await box(page.locator('#map'));
  const inspector = await box(page.locator('#attraction-card'));
  expect(map.height).toBeLessThan(overview.height);
  expect(map.height).toBeGreaterThanOrEqual(159);
  expect(inspector.y).toBeGreaterThanOrEqual(map.y + map.height - 1);
  await expect(first).toBeInViewport();
  await expect(second).toBeInViewport();
  await page.locator('#share-place').click();
  await expect(page.locator('#share-place')).toHaveAttribute('aria-busy', 'true');
  await second.click();
  await expect(page.locator('#card-name')).toHaveText('Хан Шатыр');
  await expect(first).toHaveAttribute('aria-current', 'false');
  await expect(second).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#share-place')).toHaveAttribute('aria-busy', 'false');
  const image = await page.evaluate(() => attractions.find((place) => place.id === 'khan-shatyr').image);
  await expect(page.locator('#card-photo')).toHaveAttribute('src', image.src);
  await expect(page.locator('#card-photo-credit')).toHaveAttribute('href', image.creditUrl);
  await page.evaluate(async () => { window.completeCompositionShare(); await Promise.resolve(); });
  await expect(page.locator('#share-status')).toBeEmpty();
  expect(await page.locator('#attraction-list').evaluate((list) => list.scrollTop)).toBe(scroll);
  await page.locator('#close-button').click();
  await expect(second).toBeFocused();
});

test('catalogue arrows follow visible grid columns and keep ordinary Tab navigation', async ({ page }, testInfo) => {
  await openApp(page);
  const cards = page.locator('.attraction-list-button');
  const columns = testInfo.project.name === 'desktop' ? 2 : 1;
  await cards.nth(0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(cards.nth(columns)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(cards.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(cards.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(cards.nth(0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(cards.last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(cards.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(cards.nth(0)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.list-favorite').first()).toBeFocused();
});

test('an explicitly chosen mobile map view survives both breakpoint directions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Explicit viewport transitions run once.');
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'list');
  await page.locator('#view-map').click();
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'map');
    await expect(page.locator('#view-map')).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.locator('.map-region')).toBeVisible();
});
