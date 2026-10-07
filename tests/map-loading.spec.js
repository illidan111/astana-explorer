import { test, expect } from '@playwright/test';
import { tileUrl, useLocalMapTiles } from './helpers/map-tiles.js';

test('failed map library can be retried without losing the catalogue state', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let allowLibrary = false;
  await page.route('**/vendor/leaflet/leaflet.js*', (route) => allowLibrary ? route.continue() : route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#list-map-status')).toContainText('Карта не загрузилась');
  await page.locator('#search-input').fill('Байтерек');
  if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
  await page.locator('.attraction-list-button').click();
  await expect(page.locator('#card-name')).toHaveText('Байтерек');
  await expect(page.locator('#explore-button')).toBeDisabled();
  await page.keyboard.press('Escape');
  allowLibrary = true;
  if (await page.locator('#view-map').isVisible()) await page.locator('#view-map').click();
  await page.locator('#retry-map').click();
  await expect(page.locator('#map .leaflet-tile-pane')).toBeAttached();
  await expect(page.locator('[data-marker-id="baiterek"]')).toBeVisible();
  await expect(page.locator('#find-me-button')).toBeEnabled();
  await expect(page.locator('#search-input')).toHaveValue('Байтерек');
  await expect(page.locator('.attraction-list-button')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('stalled tiles after zoom report a timeout and retry recovers', async ({ page }) => {
  // Real network coverage lives in explorer.spec.js. This scenario controls
  // success, stalled requests, and recovery without depending on OSM latency.
  await useLocalMapTiles(page);
  await page.goto('/');
  if (await page.locator('#view-map').isVisible()) await page.locator('#view-map').click();
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeAttached({ timeout: 15000 });
  await expect(page.locator('#map-status')).toBeHidden({ timeout: 15000 });
  await page.clock.install();
  const held = [];
  const holdTiles = (route) => { held.push(route); };
  await page.route(tileUrl, holdTiles);
  await page.locator('#zoom-in').click();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await page.clock.fastForward(10500);
  await expect(page.locator('#map-status')).toContainText('Подложка карты недоступна');
  await expect(page.locator('#retry-map')).toBeVisible();
  await page.unroute(tileUrl, holdTiles);
  // Removing a route handler does not settle already intercepted requests.
  // Close the stalled generation before retry creates a new tile layer.
  await Promise.all(held.map((route) => route.abort('timedout')));
  await page.locator('#retry-map').click();
  await expect(page.locator('#map-status')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeAttached();
  await expect(page.locator('.attraction-list-button')).toHaveCount(12);
});
