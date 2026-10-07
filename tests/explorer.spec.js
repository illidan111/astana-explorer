import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { useLocalMapTiles } from './helpers/map-tiles.js';

const cards = (page) => page.locator('.attraction-list-button[data-place-id]');
async function showList(page) {
  if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
  await expect(cards(page).first()).toBeVisible();
}

test('map, catalogue, responsive layout and accessibility', async ({ page }, testInfo) => {
  const errors = [];
  const consoleErrors = [];
  const requestFailures = [];
  const errorResponses = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response', (response) => { if (response.status() >= 400) errorResponses.push({ url: response.url(), status: response.status() }); });
  await page.goto('/');
  if (await page.locator('#view-map').isVisible()) await page.locator('#view-map').click();
  await expect(page.locator('#search-input')).toBeVisible();
  await expect(page.locator('#map .leaflet-tile-pane')).toBeAttached();
  await mkdir('.qa', { recursive: true });
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeAttached({ timeout: 15000 });
  await page.screenshot({ path: `.qa/after-${testInfo.project.name}-map.png`, fullPage: true });
  const mapAccessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(mapAccessibility.violations).toEqual([]);
  await showList(page);
  expect(await cards(page).count()).toBeGreaterThanOrEqual(12);
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBe(false);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: `.qa/after-${testInfo.project.name}.png`, fullPage: true });
  const diagnostics = { pageErrors: errors, consoleErrors, requestFailures, errorResponses };
  await writeFile(`.qa/diagnostics-${testInfo.project.name}.json`, JSON.stringify(diagnostics, null, 2));
  console.log(`${testInfo.project.name} browser diagnostics: ${JSON.stringify(diagnostics)}`);
  expect(errors).toEqual([]);
});

test('category, description search, empty state and reset', async ({ page }) => {
  await page.goto('/');
  await showList(page);
  const initialCount = await cards(page).count();
  await page.locator('[data-filter="event"]').click();
  expect(await cards(page).count()).toBeGreaterThan(0);
  expect(await cards(page).count()).toBeLessThan(initialCount);
  await cards(page).first().click();
  await expect(page.locator('#attraction-card')).toBeVisible();
  await expect(page.locator('#attraction-card')).toContainText(/демо|пример/i);
  await page.locator('#close-button').click();
  await page.locator('[data-filter="all"]').click();

  const firstCard = cards(page).first();
  const placeId = await firstCard.getAttribute('data-place-id');
  await firstCard.click();
  const title = await page.locator('#card-name').innerText();
  const description = await page.locator('#card-description').innerText();
  const query = description.match(/[А-Яа-яЁё]{6,}/g)?.find((word) => !title.toLowerCase().includes(word.toLowerCase()));
  expect(query).toBeTruthy();
  await page.locator('#close-button').click();
  await page.locator('#search-input').fill(query);
  await expect(page.locator(`.attraction-list-button[data-place-id="${placeId}"]`)).toBeVisible();
  await page.locator('#search-input').fill('заведомонесуществующееместо12345');
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('#reset-filters')).toBeVisible();
  await page.locator('#reset-filters').click();
  await expect(page.locator('#search-input')).toHaveValue('');
  await expect(cards(page)).toHaveCount(initialCount);
});

test('favorites persist and can be removed; dialog restores keyboard focus', async ({ page }) => {
  await page.goto('/');
  await showList(page);
  const first = cards(page).first();
  const id = await first.getAttribute('data-place-id');
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#attraction-card')).toBeVisible();
  await page.locator('#favorite-toggle').click();
  await expect(page.locator('#favorite-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#attraction-card')).not.toBeVisible();
  await expect(page.locator(`.attraction-list-button[data-place-id="${id}"]`)).toBeFocused();

  await page.reload();
  await showList(page);
  await page.locator('#favorites-button').click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toHaveAttribute('data-place-id', id);
  await cards(page).first().click();
  await page.locator('#favorite-toggle').click();
  if (await page.locator('#attraction-card').isVisible()) await page.locator('#close-button').click();
  await expect(cards(page)).toHaveCount(0);
});

test('a category marker opens details and map controls respond', async ({ page }) => {
  await page.goto('/');
  await page.locator('#search-input').fill('Байтерек');
  if (await page.locator('#view-map').isVisible()) await page.locator('#view-map').click();
  await page.locator('#fit-map').click();
  const marker = page.locator('[data-marker-id="baiterek"]');
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(page.locator('#card-name')).toHaveText('Байтерек');
  await page.locator('#explore-button').click();
  await expect(page.locator('#attraction-card')).not.toBeVisible();
  await expect(marker).toBeVisible();
});

test('theme persists and detail route is a real external destination', async ({ page }, testInfo) => {
  await useLocalMapTiles(page);
  await page.goto('/');
  if (await page.locator('#view-map').isVisible()) await page.locator('#view-map').click();
  await expect(page.locator('#map .leaflet-tile-pane')).toBeAttached();
  const initialTheme = await page.locator('html').getAttribute('data-theme');
  await page.locator('#theme-toggle').click();
  const nextTheme = initialTheme === 'dark' ? 'light' : 'dark';
  await expect(page.locator('html')).toHaveAttribute('data-theme', nextTheme);
  await page.reload();
  if (await page.locator('#view-map').isVisible()) await page.locator('#view-map').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', nextTheme);
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeAttached({ timeout: 15000 });
  await expect(page.locator('#map-status')).toBeHidden({ timeout: 15000 });
  await page.screenshot({ path: `.qa/after-${testInfo.project.name}-${nextTheme}-map.png`, fullPage: true });
  await showList(page);
  await cards(page).first().click();
  await expect(page.locator('#route-button')).toHaveAttribute('href', /^https:\/\/(www\.)?google\.com\/maps\/dir\/\?.*destination=/);
  await expect(page.locator('#route-button')).toHaveAttribute('target', '_blank');
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: `.qa/after-${testInfo.project.name}-${nextTheme}-details.png`, fullPage: true });
});

test('map remains usable when tile servers are unavailable', async ({ page }) => {
  await page.route(/(?:tile\.openstreetmap\.org|basemaps\.cartocdn\.com)/, (route) => route.abort());
  await page.goto('/');
  await showList(page);
  expect(await cards(page).count()).toBeGreaterThan(0);
  await cards(page).first().click();
  await expect(page.locator('#attraction-card')).toBeVisible();
  await page.locator('#close-button').click();
  await expect(page.locator('#map-status')).toContainText(/не|недоступ|загруз|сети/i);
});
