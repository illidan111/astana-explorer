import { test, expect } from '@playwright/test';

async function openList(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.attraction-list-button').first()).toBeAttached();
  if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
}

async function markerContext(page, id, referenceId) {
  return page.locator('#map').evaluate((map, { id, referenceId }) => {
    const bounds = map.getBoundingClientRect();
    const markers = [...map.querySelectorAll('.attraction-icon[data-marker-id]')];
    const selected = markers.find((marker) => marker.dataset.markerId === id);
    const reference = markers.find((marker) => referenceId
      ? marker.dataset.markerId === referenceId : marker.dataset.markerId !== id);
    if (!selected || !reference) return null;
    const rect = selected.getBoundingClientRect();
    const other = reference.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      referenceId: reference.dataset.markerId,
      offsetX: x - bounds.left - bounds.width / 2,
      offsetY: y - bounds.top - bounds.height / 2,
      distance: Math.hypot(x - other.left - other.width / 2, y - other.top - other.height / 2),
      uncovered: rect.left >= bounds.left && rect.right <= bounds.right
        && rect.top >= bounds.top && rect.bottom <= bounds.bottom
        && (hit === selected || selected.contains(hit))
    };
  }, { id, referenceId });
}

test('saving an inline favorite preserves the current place in a long list', async ({ page }) => {
  await openList(page);
  const favorite = page.locator('.list-favorite[data-favorite-id="presidential-park"]');
  await favorite.scrollIntoViewIfNeeded();
  await favorite.focus();
  const before = await page.locator('#attraction-list').evaluate((list) => list.scrollTop);
  expect(before).toBeGreaterThan(200);
  await page.keyboard.press('Enter');
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await expect(favorite).toBeFocused();
  const after = await page.locator('#attraction-list').evaluate((list) => list.scrollTop);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  await expect(favorite).toBeInViewport();
});

test('a slow optional clustering script cannot discard early search input', async ({ page }) => {
  let releasePlugin;
  const gate = new Promise((resolve) => { releasePlugin = resolve; });
  let requestedPlugin;
  const requested = new Promise((resolve) => { requestedPlugin = resolve; });
  await page.route('**/vendor/leaflet.markercluster/leaflet.markercluster.js', async (route) => {
    requestedPlugin();
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await requested;
    const search = page.locator('#search-input');
    await expect(search).toBeEnabled();
    await search.fill('Байтерек');
    const initialTheme = await page.locator('html').getAttribute('data-theme');
    await page.locator('#theme-toggle').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', initialTheme);
    if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
    await expect(search).toHaveValue('Байтерек');
    // The catalogue must work before an optional map enhancement finishes.
    await expect(page.locator('.attraction-list-button')).toHaveCount(1);
    await expect(page.locator('.attraction-list-button')).toHaveAttribute('data-place-id', 'baiterek');
    await expect(page.locator('#map-count-text')).toHaveText('1 точка на карте');
    releasePlugin();
    await expect(page.locator('#map .leaflet-tile-pane')).toBeAttached();
    await expect(page.locator('.attraction-list-button')).toHaveCount(1);
  } finally {
    releasePlugin();
  }
});

test('an active category can be toggled off without discarding the search', async ({ page }) => {
  await openList(page);
  const park = page.locator('[data-filter="park"]');
  await park.click();
  await expect(park).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.attraction-list-button')).toHaveCount(2);
  await park.click();
  await expect(park).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-filter="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.attraction-list-button')).toHaveCount(12);
  await page.locator('#search-input').fill('парк');
  const searchCount = await page.locator('.attraction-list-button').count();
  await park.click();
  await expect(page.locator('.attraction-list-button')).toHaveCount(2);
  await park.click();
  await expect(page.locator('#search-input')).toHaveValue('парк');
  await expect(page.locator('.attraction-list-button')).toHaveCount(searchCount);
  await page.locator('#clear-search').click();
  await expect(page.locator('#search-input')).toHaveValue('');
  await expect(page.locator('#search-input')).toBeFocused();
  await expect(page.locator('.attraction-list-button')).toHaveCount(12);
});

test('closing details retains query, category, list position and the selected map context', async ({ page }) => {
  await openList(page);
  await expect(page.locator('#map')).toHaveAttribute('aria-busy', 'false');
  await page.locator('[data-filter="attraction"]').click();
  await page.locator('#search-input').fill('а');
  const last = page.locator('.attraction-list-button').last();
  const selectedId = await last.getAttribute('data-place-id');
  await last.scrollIntoViewIfNeeded();
  const beforeScroll = await page.locator('#attraction-list').evaluate((list) => list.scrollTop);
  const beforeView = await page.locator('body').getAttribute('data-mobile-view');
  await expect(page.locator('.leaflet-zoom-anim')).toHaveCount(0);
  await last.click();
  await expect(page.locator('#attraction-card')).toBeVisible();
  await expect(page.locator('.leaflet-zoom-anim')).toHaveCount(0);
  const mapVisible = await page.locator('#map').isVisible();
  // A user may adjust the map while reading desktop details. Closing its split
  // panel must retain that geographic view as the map canvas grows again.
  if (mapVisible) await page.locator('#zoom-out').click();
  await expect.poll(() => markerContext(page, selectedId)).not.toBeNull();
  const selectedContext = await markerContext(page, selectedId);
  await page.keyboard.press('Escape');
  await expect(last).toBeFocused();
  await expect(page.locator('#search-input')).toHaveValue('а');
  await expect(page.locator('[data-filter="attraction"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', beforeView);
  expect(await page.locator('#attraction-list').evaluate((list) => list.scrollTop)).toBe(beforeScroll);
  await expect(last).toHaveAttribute('aria-current', 'true');
  await expect.poll(async () => {
    const current = await markerContext(page, selectedId, selectedContext.referenceId);
    if (!current) return Infinity;
    return Math.max(Math.abs(current.offsetX - selectedContext.offsetX),
      Math.abs(current.offsetY - selectedContext.offsetY),
      Math.abs(current.distance - selectedContext.distance));
  }, { message: 'Closing details must retain the map centre and the scale between real place markers' }).toBeLessThanOrEqual(2);
  if (mapVisible) {
    expect((await markerContext(page, selectedId, selectedContext.referenceId)).uncovered).toBe(true);
  }
});

test('rapid searches supersede cluster expansion and leave map and list in agreement', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openList(page);
  await page.locator('.attraction-list-button[data-place-id="astana-opera"]').click();
  await page.locator('#explore-button').click();
  for (const query of ['парк', 'EXPO', 'опера', 'несуществующаяточка', 'Байтерек']) {
    await page.locator('#search-input').fill(query);
  }
  await expect(page.locator('.attraction-list-button')).toHaveCount(1);
  await expect(page.locator('.attraction-list-button')).toHaveAttribute('data-place-id', 'baiterek');
  await expect(page.locator('[data-marker-id="baiterek"]')).toBeVisible();
  await expect(page.locator('.attraction-icon')).toHaveCount(1);
  await expect(page.locator('.custom-marker-cluster')).toHaveCount(0);
  await expect(page.locator('#attraction-card')).not.toBeVisible();
  await expect(page.locator('#map-count-text')).toHaveText('1 точка на карте');
  await page.locator('#clear-search').click();
  await expect(page.locator('.attraction-list-button')).toHaveCount(12);
  await expect.poll(() => page.locator('#map').evaluate((map) => {
    const singleMarkers = map.querySelectorAll('.attraction-icon').length;
    const clustered = [...map.querySelectorAll('.custom-marker-cluster')]
      .reduce((sum, marker) => sum + Number(marker.textContent), 0);
    return singleMarkers + clustered;
  })).toBe(12);
  expect(errors).toEqual([]);
});

test('result changes are announced in map view and markers have usable accessible names', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#view-map').isVisible()) await page.locator('#view-map').click();
  await expect(page.locator('[data-filter="park"]')).toBeVisible();
  await page.locator('[data-filter="park"]').click();
  const status = page.getByRole('status').filter({ hasText: 'Найдено объектов: 2.' });
  await expect(status).toHaveCount(1);
  await expect(page.locator('#results-status')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#map').getByRole('button', { name: 'Центральный парк · Парки', exact: true })).toBeVisible();
  await expect(page.locator('#map').getByRole('button', { name: 'Президентский парк · Парки', exact: true })).toBeVisible();
  await page.locator('#search-input').fill('несуществующаяточка');
  await expect(page.getByRole('status').filter({ hasText: 'Найдено объектов: 0.' })).toHaveCount(1);
  await expect(page.locator('#map-empty')).toBeVisible();
  await page.locator('#map-reset-filters').click();
  await expect(page.locator('#results-status')).toContainText('Найдено объектов: 12.');
});

test('map marker buttons open with Enter and Space and restore keyboard focus', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#view-map').isVisible()) await page.locator('#view-map').click();
  await page.locator('#search-input').fill('Байтерек');
  const marker = page.locator('[data-marker-id="baiterek"]');
  await expect(marker).toBeVisible();
  for (const key of ['Enter', 'Space']) {
    await marker.focus();
    await page.keyboard.press(key);
    await expect(page.getByRole('dialog', { name: 'Байтерек', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(marker).toBeFocused();
  }
});
