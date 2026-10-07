import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { useLocalMapTiles } from './helpers/map-tiles.js';

const imageFixture = fileURLToPath(new URL('./fixtures/tile.png', import.meta.url));

async function openCatalogue(page) {
  await useLocalMapTiles(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#map')).toHaveAttribute('aria-busy', 'false');
  if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
}

async function patchImages(page, patch) {
  await page.route('**/data.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n${patch}` });
  });
}

test('local photos have stable dimensions, decorative thumbnails, descriptions and venue attribution', async ({ page }) => {
  await openCatalogue(page);
  const image = await page.evaluate(() => attractions.find((place) => place.id === 'baiterek').image);
  expect(image).toBeTruthy();
  const thumbnail = page.locator('[data-place-id="baiterek"] .place-photo');
  await expect(thumbnail).toHaveAttribute('alt', '');
  await expect(thumbnail).toHaveAttribute('loading', 'lazy');
  await expect(thumbnail).toHaveAttribute('src', image.src);
  await expect(thumbnail).toHaveAttribute('width', String(image.width));
  await expect(thumbnail).toHaveAttribute('height', String(image.height));
  await page.locator('[data-place-id="baiterek"]').click();
  const hero = page.locator('#card-photo');
  await expect(hero).toHaveAttribute('alt', image.alt);
  await expect(hero).toHaveAttribute('loading', 'eager');
  await expect.poll(() => hero.evaluate((photo) => photo.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('#card-photo-credit')).toHaveAttribute('href', image.creditUrl);
  await expect(page.locator('#card-photo-credit')).toHaveText(image.credit);
  await expect(page.locator('#card-photo-license')).toHaveAttribute('href', image.licenseUrl);
  await expect(page.locator('#card-photo-license')).toHaveText(image.license);
  await expect(page.locator('#card-photo-fallback')).toBeHidden();

  await page.locator('#close-button').click();
  await page.locator('[data-filter="event"]').click();
  const venueImage = await page.evaluate(() => attractions.find((place) => place.id === 'astana-opera').image);
  await expect(page.locator('[data-place-id="demo-chamber-evening"] .place-photo')).toHaveAttribute('src', venueImage.src);
  await page.locator('[data-place-id="demo-chamber-evening"]').click();
  await expect(hero).toHaveAttribute('src', venueImage.src);
  await expect(hero).toHaveAttribute('alt', venueImage.alt);
  await expect(page.locator('#card-photo-credit')).toHaveAttribute('href', venueImage.creditUrl);
});

test('previous and next respect filtered order, keep query and mobile view, and select the map marker', async ({ page }, testInfo) => {
  await openCatalogue(page);
  await page.locator('[data-filter="park"]').click();
  await page.locator('#search-input').fill('парк');
  const listPosition = await page.locator('#attraction-list').evaluate((list) => list.scrollTop);
  await page.locator('[data-place-id="central-park"]').click();
  await expect(page.locator('#selection-position')).toHaveText('1 из 2');
  await expect(page.locator('#previous-place')).toBeDisabled();
  await page.locator('#next-place').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#card-name')).toHaveText('Президентский парк');
  await expect(page.locator('#selection-position')).toHaveText('2 из 2');
  await expect(page.locator('#next-place')).toBeDisabled();
  await expect(page.locator('#previous-place')).toBeFocused();
  await expect(page.locator('#search-input')).toHaveValue('парк');
  await expect(page.locator('[data-filter="park"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-place-id="presidential-park"]')).toHaveAttribute('aria-current', 'true');
  expect(await page.locator('#attraction-list').evaluate((list) => list.scrollTop)).toBe(listPosition);
  if (testInfo.project.name === 'mobile') {
    await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'list');
  } else {
    await expect(page.locator('[data-marker-id="presidential-park"]')).toHaveClass(/is-selected/);
    await expect(page.locator('[data-marker-id="presidential-park"]')).toBeInViewport();
  }
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#card-name')).toHaveText('Центральный парк');
  await expect(page.locator('#selection-position')).toHaveText('1 из 2');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#card-name')).toHaveText('Центральный парк');
  await page.locator('#close-button').click();
  await expect(page.locator('[data-place-id="central-park"]')).toBeFocused();
  await page.locator('#sort-select').selectOption('name');
  await page.locator('[data-place-id="presidential-park"]').click();
  await expect(page.locator('#selection-position')).toHaveText('1 из 2');
  await page.locator('#next-place').click();
  await expect(page.locator('#card-name')).toHaveText('Центральный парк');
  await expect(page.locator('#selection-position')).toHaveText('2 из 2');
});

test('arrow shortcuts leave copying fields editable and clear share state when navigating', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } }
    });
  });
  await openCatalogue(page);
  await page.locator('[data-place-id="baiterek"]').click();
  await page.locator('#share-place').click();
  await expect(page.locator('#share-url')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#card-name')).toHaveText('Байтерек');
  await expect(page.locator('#share-url')).toBeFocused();
  await page.locator('#close-button').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#card-name')).toHaveText('Хан Шатыр');
  await expect(page.locator('#share-fallback')).toBeHidden();
  await expect(page.locator('#share-status')).toBeEmpty();
});

test('missing and broken photos preserve the category fallback and keep navigation available', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await patchImages(page, `
    attractions.find(place => place.id === 'baiterek').image = {
      src: 'assets/photos/missing-test.webp', alt: 'Тестовая фотография', width: 800, height: 600,
      credit: 'Тестовый автор', creditUrl: 'https://example.org/photo'
    };
    delete attractions.find(place => place.id === 'khan-shatyr').image;
  `);
  await page.route('**/assets/photos/missing-test.webp', (route) => route.abort());
  await openCatalogue(page);
  const brokenThumbnail = page.locator('[data-place-id="baiterek"] .place-thumbnail');
  await expect(brokenThumbnail).toHaveClass(/photo-unavailable/);
  await expect(brokenThumbnail.locator('img')).toHaveCount(0);
  await expect(brokenThumbnail.locator('svg')).toBeVisible();
  await page.locator('[data-place-id="baiterek"]').click();
  await expect(page.locator('.card-photo-wrap')).toHaveClass(/photo-unavailable/);
  await expect(page.locator('#card-photo')).toBeHidden();
  await expect(page.locator('#card-photo-fallback svg')).toBeVisible();
  await expect(page.locator('#card-photo-credit')).toBeHidden();
  await expect(page.locator('#card-photo-license')).toBeHidden();
  await page.locator('#next-place').click();
  await expect(page.locator('#card-name')).toHaveText('Хан Шатыр');
  await expect(page.locator('#card-photo-fallback svg')).toBeVisible();
  await expect(page.locator('#card-photo')).toBeHidden();
  await expect(page.locator('#card-photo-credit')).not.toHaveAttribute('href');
  expect(errors).toEqual([]);
});

test('a late photo failure from the previous place cannot hide the current photo or attribution', async ({ page }) => {
  await patchImages(page, `
    attractions.find(place => place.id === 'baiterek').image = {
      src: 'assets/photos/held-test.webp', alt: 'Предыдущее фото', width: 800, height: 600
    };
    attractions.find(place => place.id === 'khan-shatyr').image = {
      src: 'assets/photos/ready-test.webp', alt: 'Текущее фото', width: 800, height: 600,
      credit: 'Текущий автор', creditUrl: 'https://example.org/current-photo'
    };
  `);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/assets/photos/held-test.webp', async (route) => { await gate; await route.abort(); });
  await page.route('**/assets/photos/ready-test.webp', (route) => route.fulfill({ contentType: 'image/png', path: imageFixture }));
  try {
    await openCatalogue(page);
    await page.locator('[data-place-id="baiterek"]').click();
    await page.locator('#next-place').click();
    await expect(page.locator('#card-photo')).toHaveAttribute('alt', 'Текущее фото');
    await expect.poll(() => page.locator('#card-photo').evaluate((photo) => photo.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('#card-photo-credit')).toHaveText('Текущий автор');
    release();
    await expect(page.locator('[data-place-id="baiterek"] .place-thumbnail')).toHaveClass(/photo-unavailable/);
    await expect(page.locator('#card-photo')).toBeVisible();
    await expect(page.locator('.card-photo-wrap')).toHaveClass(/has-photo/);
    await expect(page.locator('#card-photo-fallback')).toBeHidden();
    await expect(page.locator('#card-photo-credit')).toHaveText('Текущий автор');
  } finally { release(); }
});
