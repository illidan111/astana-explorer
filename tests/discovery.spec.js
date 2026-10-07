import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { useLocalMapTiles } from './helpers/map-tiles.js';

async function showList(page) {
  if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
}

test('the first catalogue screen shows useful results and every category is reachable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Explicit viewport coverage runs once.');
  await useLocalMapTiles(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  for (const [width, height, minimumPlaces] of [[1440, 1000, 4], [390, 844, 3], [320, 568, 1], [320, 400, 1], [844, 390, 1], [768, 1024, 3]]) {
    await page.setViewportSize({ width, height });
    await showList(page);
    const categories = page.locator('#filter-chips button');
    await expect(categories).toHaveCount(7);
    for (const category of await categories.all()) {
      const label = await category.innerText();
      expect(await category.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
          && (hit === button || button.contains(hit));
      }), `${label} must be visible without horizontal scrolling at ${width}×${height}`).toBe(true);
    }
    const visiblePlaces = await page.locator('#attraction-list').evaluate((list) => {
      const bounds = list.getBoundingClientRect();
      return [...list.querySelectorAll('.attraction-list-button')].filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom && rect.bottom <= innerHeight;
      }).length;
    });
    expect(visiblePlaces, `Complete results visible at ${width}×${height}`).toBeGreaterThanOrEqual(minimumPlaces);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('the default catalogue contains real places and saved demo events are still recoverable', async ({ page }) => {
  await useLocalMapTiles(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await showList(page);
  await expect(page.locator('.attraction-list-button')).toHaveCount(12);
  await expect(page.locator('.attraction-list-button[data-place-id^="demo-"]')).toHaveCount(0);
  await page.locator('[data-filter="event"]').click();
  await expect(page.locator('.attraction-list-button')).toHaveCount(3);
  await expect(page.locator('#events-notice')).toBeVisible();
  await page.locator('[data-favorite-id="demo-chamber-evening"]').click();
  await page.locator('[data-filter="all"]').click();
  await expect(page.locator('.attraction-list-button')).toHaveCount(12);
  await page.locator('#favorites-button').click();
  await expect(page.locator('.attraction-list-button')).toHaveCount(1);
  await expect(page.locator('.attraction-list-button')).toHaveAttribute('data-place-id', 'demo-chamber-evening');
  await page.locator('.attraction-list-button').click();
  await expect(page.locator('#card-notice')).toContainText('Это не анонс');
  await page.keyboard.press('Escape');
  await page.locator('#favorites-button').click();
  await expect(page.locator('.attraction-list-button')).toHaveCount(12);
});

test('search finds the practical text shown in catalogue rows and clearing it keeps the category', async ({ page }) => {
  await useLocalMapTiles(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await showList(page);
  await page.locator('[data-filter="park"]').click();
  await expect(page.locator('[data-place-id="central-park"]')).toContainText('велодорожки');
  await page.locator('#search-input').fill('велодорожки');
  await expect(page.locator('.attraction-list-button')).toHaveCount(1);
  await expect(page.locator('.attraction-list-button')).toHaveAttribute('data-place-id', 'central-park');
  await page.locator('#clear-search').click();
  await expect(page.locator('#search-input')).toHaveValue('');
  await expect(page.locator('#search-input')).toBeFocused();
  await expect(page.locator('[data-filter="park"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.attraction-list-button')).toHaveCount(2);
});

test('the dark catalogue and place details remain readable and accessible', async ({ page }) => {
  await useLocalMapTiles(page);
  await page.addInitScript(() => localStorage.setItem('astana-explorer-theme', 'dark'));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await showList(page);
  const first = page.locator('[data-place-id="baiterek"]');
  await expect(first.locator('.place-name')).toHaveText('Байтерек');
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await first.click();
  await expect(page.locator('#card-name')).toHaveText('Байтерек');
  await expect(page.locator('#card-area')).toHaveText('Бульвар Нуржол, 14');
  await expect(page.locator('#route-button')).toBeVisible();
  const detailsAccessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(detailsAccessibility.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(first).toBeFocused();
});
