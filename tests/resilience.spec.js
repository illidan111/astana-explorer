import { test, expect } from '@playwright/test';

async function list(page) {
  if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
  return page.locator('.attraction-list-button[data-place-id]').first();
}

test('geolocation success marks the user and denied access has useful recovery', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 51.1283, longitude: 71.4305, accuracy: 25 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#map .leaflet-tile-pane')).toBeAttached();
  await page.locator('#find-me-button').click();
  await expect(page.locator('.user-location-marker')).toBeVisible();
  await expect(page.locator('#location-status')).toContainText('Вы на карте');
  await expect(page.locator('#find-me-button')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#find-me-button')).toBeEnabled();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition(_success, error) { error({ code: 1 }); }
    } });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#map .leaflet-tile-pane')).toBeAttached();
  await page.locator('#find-me-button').click();
  await expect(page.locator('#location-status')).toContainText('Доступ к геолокации не разрешён');
  await expect(page.locator('#find-me-button')).toBeEnabled();
  await expect(page.locator('#find-me-button')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#fit-map').click();
  await (await list(page)).click();
  await expect(page.locator('#attraction-card')).toBeVisible();
});

test('missing map library leaves search, details and favorites available', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/vendor/leaflet/leaflet.js', (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#map-status')).toContainText('Не удалось загрузить карту');
  await page.locator('#search-input').fill('Байтерек');
  await (await list(page)).click();
  await expect(page.locator('#card-name')).toHaveText('Байтерек');
  await expect(page.locator('#explore-button')).toBeDisabled();
  await page.locator('#favorite-toggle').click();
  await expect(page.locator('#favorite-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-input')).toBeVisible();
  expect(errors).toEqual([]);
});

test('malformed and unavailable local storage do not break browsing', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('astana-explorer-favorites', '{broken-json');
      localStorage.setItem('astana-explorer-theme', 'invalid-theme');
    } catch { /* Another init script intentionally disables storage in the second phase. */ }
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#favorite-count')).toHaveText('0');
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);
  await (await list(page)).click();
  await expect(page.locator('#attraction-card')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Storage disabled for test', 'SecurityError'); }
    });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await (await list(page)).click();
  await page.locator('#favorite-toggle').click();
  await expect(page.locator('#favorite-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#card-notice')).toContainText('хранилище браузера недоступно');
  await page.keyboard.press('Escape');
  await page.locator('#favorites-button').click();
  await expect(page.locator('.attraction-list-button[data-place-id]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('coincident venue and event markers remain individually selectable', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await list(page);
  await page.locator('.attraction-list-button[data-place-id="astana-opera"]').click();
  await page.locator('#explore-button').click();
  const venue = page.locator('[data-marker-id="astana-opera"]');
  const event = page.locator('[data-marker-id="demo-chamber-evening"]');
  await expect(venue).toBeVisible();
  await expect(event).toBeVisible();
  await expect.poll(async () => {
    const venueBox = await venue.boundingBox();
    const eventBox = await event.boundingBox();
    return venueBox && eventBox ? Math.hypot(venueBox.x - eventBox.x, venueBox.y - eventBox.y) : 0;
  }).toBeGreaterThan(20);
  await event.click();
  await expect(page.locator('#card-notice')).toContainText('Демонстрационное событие');
});

test('modal contains keyboard focus and list favorite updates keep the focused control', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const firstCard = await list(page);
  await firstCard.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#close-button')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#favorite-toggle')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#close-button')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(firstCard).toBeFocused();
  const favorite = page.locator('.list-favorite').first();
  await favorite.focus();
  await page.keyboard.press('Enter');
  await expect(favorite).toBeFocused();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#favorites-button').click();
  await favorite.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#attraction-list button')).toBeFocused();
  await expect(page.locator('#attraction-list')).toContainText('Ваши открытия');
});
