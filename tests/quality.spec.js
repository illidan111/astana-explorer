import { test, expect } from '@playwright/test';
import { readdir } from 'node:fs/promises';

const localAssets = [
  ['/index.html', 'text/html'],
  ['/styles.css', 'text/css'],
  ['/app.js', 'text/javascript'],
  ['/data.js', 'text/javascript'],
  ['/favicon.svg', 'image/svg+xml'],
  ['/vendor/leaflet/leaflet.js', 'text/javascript'],
  ['/vendor/leaflet/leaflet.css', 'text/css'],
  ['/vendor/leaflet.markercluster/leaflet.markercluster.js', 'text/javascript']
];

test('public assets have correct types and HEAD responses preserve their content length', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'HTTP behavior is independent of viewport.');
  for (const [pathname, type] of localAssets) {
    const response = await request.get(`${pathname}?version=quality-check`);
    expect(response.status(), pathname).toBe(200);
    expect(response.headers()['content-type'], pathname).toContain(type);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    const body = await response.body();
    expect(body.length, pathname).toBeGreaterThan(0);
    expect(Number(response.headers()['content-length']), pathname).toBe(body.length);
    const head = await request.head(pathname);
    expect(head.status(), pathname).toBe(200);
    expect(Number(head.headers()['content-length']), pathname).toBe(body.length);
    expect(await head.body(), pathname).toHaveLength(0);
  }
  // Every local illustration added to the public assets directory must be reachable.
  const assets = await readdir('assets', { recursive: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const asset of assets.filter((name) => /\.(svg|png|jpe?g|webp|woff2)$/i.test(name))) {
    const pathname = `/assets/${asset.replaceAll('\\', '/')}`;
    const response = await request.get(pathname);
    expect(response.status(), pathname).toBe(200);
    expect((await response.body()).length, pathname).toBeGreaterThan(0);
  }
});

test('the preview server exposes only its public files', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'HTTP behavior is independent of viewport.');
  for (const pathname of [
    '/package.json', '/PACKAGE-LOCK.JSON', '/playwright.config.js', '/serve.mjs',
    '/README.md', '/docs/catalogue.md', '/tests/quality.spec.js', '/.git/config',
    '/assets/..%5Cpackage.json', '/vendor/..%5Cplaywright.config.js',
    '/assets/%2Eenv', '/vendor/leaflet/', '/unknown.svg'
  ]) {
    expect((await request.get(pathname)).status(), pathname).toBe(404);
  }
  const malformed = await request.get('/%E0%A4%A');
  expect(malformed.status()).toBe(400);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await request.fetch('/', { method });
    expect(response.status(), method).toBe(405);
    expect(response.headers().allow, method).toBe('GET, HEAD');
  }
});

test('sorting stays consistent while categories and themes change', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
  for (const illustration of await page.locator('#list-view img').all()) {
    if (!await illustration.isVisible()) continue;
    await illustration.scrollIntoViewIfNeeded();
    const source = await illustration.getAttribute('src');
    await expect.poll(() => illustration.evaluate((image) => image.complete && image.naturalWidth > 0), {
      message: `The local catalogue illustration must decode: ${source}`
    }).toBe(true);
  }
  await page.locator('#attraction-list').evaluate((list) => { list.scrollTop = 0; });
  const names = page.locator('.attraction-list-button .place-name');
  await expect(names.first()).toBeVisible();
  const curatedNames = await names.allTextContents();
  await page.locator('#sort-select').selectOption('name');
  await expect.poll(() => names.allTextContents()).toEqual([...curatedNames].sort((a, b) => a.localeCompare(b, 'ru')));
  await page.locator('[data-filter="park"]').click();
  const parkNames = await names.allTextContents();
  expect(parkNames.length).toBeGreaterThan(0);
  expect(parkNames).toEqual([...parkNames].sort((a, b) => a.localeCompare(b, 'ru')));
  await page.locator('#theme-toggle').click();
  await expect(page.locator('#sort-select')).toHaveValue('name');
  await expect(names).toHaveText(parkNames);
  await page.locator('#sort-select').selectOption('curated');
  await page.locator('[data-filter="all"]').click();
  await expect(names).toHaveText(curatedNames);
});

test('catalogue selection and dialog focus survive phone and desktop reflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One explicit viewport sequence covers orientation and breakpoints.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#view-list').click();
  await page.locator('[data-filter="culture"]').click();
  await page.locator('#search-input').fill('музей');
  const result = page.locator('.attraction-list-button').first();
  const id = await result.getAttribute('data-place-id');
  await result.click();
  await expect(page.locator('#attraction-card')).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.keyboard.press('Escape');
  await expect(page.locator(`.attraction-list-button[data-place-id="${id}"]`)).toBeFocused();
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(result).toBeVisible();
    await expect(page.locator('#search-input')).toHaveValue('музей');
    await expect(page.locator('[data-filter="culture"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
      message: `No horizontal overflow at ${viewport.width}×${viewport.height}`
    }).toBe(true);
  }
});
