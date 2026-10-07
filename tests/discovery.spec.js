import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { useLocalMapTiles } from './helpers/map-tiles.js';

async function showList(page) {
  if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
}

async function isReachable(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
      && (hit === element || element.contains(hit));
  });
}

test('the first catalogue screen shows useful results and every category is reachable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Explicit viewport coverage runs once.');
  await useLocalMapTiles(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  for (const [width, height, minimumPlaces] of [[1440, 1000, 4], [390, 844, 1], [320, 568, null], [320, 400, 1], [667, 375, 1], [844, 390, 4], [768, 1024, 4]]) {
    await page.setViewportSize({ width, height });
    await showList(page);
    await page.locator('#attraction-list').evaluate(list => { list.scrollTop = 0; });
    for (const id of ['search-input', 'favorites-button', 'theme-toggle', 'about-button', 'sort-select']) {
      expect(await isReachable(page.locator(`#${id}`)), `${id} must be reachable at ${width}×${height}`).toBe(true);
    }
    const categories = page.locator('#filter-chips button');
    await expect(categories).toHaveCount(7);
    for (const category of await categories.all()) {
      const label = await category.innerText();
      expect(await isReachable(category), `${label} must be visible without horizontal scrolling at ${width}×${height}`).toBe(true);
    }
    const visiblePlaces = await page.locator('#attraction-list').evaluate((list) => {
      const bounds = list.getBoundingClientRect();
      const complete = [...list.querySelectorAll('.attraction-list-button')].filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom && rect.bottom <= innerHeight;
      });
      const clippedOrCovered = complete.filter(button => {
        const buttonRect = button.getBoundingClientRect();
        const title = button.querySelector('.place-name');
        const summary = button.querySelector('.place-description');
        const save = button.closest('.attraction-list-item').querySelector('.list-favorite');
        const contained = [title, summary].every(element => {
          const rect = element.getBoundingClientRect();
          return rect.top >= buttonRect.top && rect.bottom <= buttonRect.bottom + 1
            && rect.left >= buttonRect.left && rect.right <= buttonRect.right + 1;
        });
        const reachable = [title, save].every(element => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit === element || element.contains(hit);
        });
        return !contained || !reachable;
      }).map(button => button.dataset.placeId);
      return { count: complete.length, clippedOrCovered };
    });
    expect(visiblePlaces.clippedOrCovered, `Complete cards contain readable text and reachable actions at ${width}×${height}`).toEqual([]);
    if (minimumPlaces !== null) {
      expect(visiblePlaces.count, `Complete results visible at ${width}×${height}`).toBeGreaterThanOrEqual(minimumPlaces);
    }
    // Photo cards trade row quantity for useful visual context; their primary controls must still fit.
    const first = page.locator('.attraction-list-item').first();
    expect(await isReachable(first.locator('.place-name')), `First title at ${width}×${height}`).toBe(true);
    expect(await isReachable(first.locator('.list-favorite')), `First save action at ${width}×${height}`).toBe(true);
    const description = first.locator('.place-description');
    expect(await description.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
    if (width === 390 && height === 844) {
      const nextPhotoHeight = await page.locator('.place-thumbnail').nth(1).evaluate(photo => {
        const rect = photo.getBoundingClientRect();
        const list = document.querySelector('#attraction-list').getBoundingClientRect();
        return Math.max(0, Math.min(rect.bottom, list.bottom, innerHeight) - Math.max(rect.top, list.top));
      });
      expect(nextPhotoHeight, 'The next phone result must visibly invite continued browsing').toBeGreaterThanOrEqual(64);
    }
    if (height <= 540) {
      expect(await first.locator('.attraction-list-button').evaluate(button => getComputedStyle(button).flexDirection)).toBe('row');
      expect(await isReachable(description), `Compact description at ${width}×${height}`).toBe(true);
    } else {
      expect(await first.locator('.place-thumbnail').evaluate(photo => photo.getBoundingClientRect().height)).toBeGreaterThanOrEqual(128);
      await description.scrollIntoViewIfNeeded();
      expect(await isReachable(description), `Description remains scrollable at ${width}×${height}`).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#search-input').fill('Байтерек');
    await expect(page.locator('.attraction-list-button')).toHaveCount(1);
    expect(await isReachable(page.locator('#clear-search')), `Clear search at ${width}×${height}`).toBe(true);
    await page.locator('#clear-search').click();
    await expect(page.locator('#search-input')).toBeFocused();
    await expect(page.locator('.attraction-list-button')).toHaveCount(12);
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

test('search finds the practical text shown in catalogue cards and clearing it keeps the category', async ({ page }) => {
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
