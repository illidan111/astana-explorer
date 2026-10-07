import { test, expect } from '@playwright/test';
import { useLocalMapTiles } from './helpers/map-tiles.js';

test('compact phone, tablet and landscape keep controls within the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One viewport loop covers both narrow and wide layouts.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await useLocalMapTiles(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  for (const [width, height] of [[320, 568], [768, 1024], [1024, 768], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('#search-input')).toBeVisible();
    if (await page.locator('#view-map').isVisible()) await page.locator('#view-map').click();
    for (const selector of ['#theme-toggle', '#favorites-button', '#fit-map', '#find-me-button', '#zoom-in', '#zoom-out']) {
      const control = page.locator(selector);
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box.x, `${selector} at ${width}×${height}`).toBeGreaterThanOrEqual(0);
      expect(box.y, `${selector} at ${width}×${height}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${selector} at ${width}×${height}`).toBeLessThanOrEqual(width);
      expect(box.y + box.height, `${selector} at ${width}×${height}`).toBeLessThanOrEqual(height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
    const listBox = await page.locator('#attraction-list').boundingBox();
    expect(listBox.height, `usable list height at ${width}×${height}`).toBeGreaterThan(90);
    expect(listBox.y + listBox.height, `list bottom at ${width}×${height}`).toBeLessThanOrEqual(height);
    if (await page.locator('#view-map').isVisible()) await page.locator('#view-map').click();
    await page.locator('#fit-map').click();
    await expect(page.locator('.leaflet-tile-loaded').first()).toBeAttached({ timeout: 15000 });
    await expect(page.locator('#map-status')).toBeHidden({ timeout: 15000 });
    await page.screenshot({ path: `.qa/layout-${width}x${height}.png`, fullPage: true });
  }
});
