import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const journeys = [
  { id: 'baiterek', category: 'attraction', query: 'Бәйтерек', destination: '51.128314,71.430519', address: 'Бульвар Нуржол, 14' },
  { id: 'nur-astana-mosque', category: 'attraction', query: 'Нур-Астана', destination: '51.126654,71.415796', address: 'Проспект Кабанбай батыра, 36' },
  { id: 'expo-nur-alem', category: 'culture', query: 'сингулярности', destination: '51.0892,71.4161', address: 'Проспект Мангилик Ел, блок B1 · EXPO' },
  { id: 'central-park', category: 'park', query: 'Центральный', destination: '51.152859,71.41902', address: 'Берег Есиля · Центральный парк' },
  { id: 'line-brew', category: 'food', query: 'Кенесары 20', destination: '51.163658,71.416047', address: 'Улица Кенесары, 20' },
  { id: 'duman-entertainment-center', category: 'attraction', query: 'Думан', destination: '51.147018,71.415143', address: 'Коргалжынское шоссе, 2 · комплекс Ailand' }
];

test('catalogue has real reviewed places, valid local icons and consistent demo host points', async () => {
  const context = {};
  vm.runInNewContext(await readFile('data.js', 'utf8') + '\nthis.catalogue = attractions; this.groups = categories;', context);
  const html = await readFile('index.html', 'utf8');
  const places = context.catalogue.filter(place => place.kind === 'place');
  const examples = context.catalogue.filter(place => place.kind === 'event');
  expect(places).toHaveLength(12);
  expect(examples).toHaveLength(3);
  expect(new Set(context.catalogue.map(place => place.id)).size).toBe(15);
  for (const place of places) {
    expect(place.demo).toBe(false);
    expect(place.verifiedAt).toBe('2026-10-05');
    expect(place.address || place.area).toBeTruthy();
    expect(place.pointLabel).toBeTruthy();
    expect(context.groups[place.category]).toBeTruthy();
    expect(place.coordinates[0]).toBeGreaterThan(51.08);
    expect(place.coordinates[0]).toBeLessThan(51.18);
    expect(place.coordinates[1]).toBeGreaterThan(71.39);
    expect(place.coordinates[1]).toBeLessThan(71.49);
    expect(html).toContain(`id="icon-${place.icon}"`);
    expect(new URL(place.sourceUrl).protocol).toBe('https:');
    expect(new URL(place.coordinateSourceUrl).protocol).toBe('https:');
    expect(place.googlePlaceId).toMatch(/^ChIJ[\w-]+$/);
    expect(place.routeQuery).toContain('Астана');
    expect(place.image).toBeUndefined();
  }
  expect(new Set(places.map(place => place.description)).size).toBe(12);
  for (const event of examples) {
    const venue = places.find(place => place.id === event.venueId);
    expect(venue).toBeTruthy();
    expect(event.coordinates).toEqual(venue.coordinates);
    expect(event.demo).toBe(true);
    expect(event.eventLabel).toContain('Пример');
  }
});

for (const journey of journeys) {
  test(`map → category → search → details → route: ${journey.id}`, async ({ page, context }) => {
    await page.goto('/');
    await expect(page.locator('#map .leaflet-tile-pane')).toBeAttached();
    await page.locator(`[data-filter="${journey.category}"]`).click();
    await page.locator('#search-input').fill(journey.query);
    await expect(page.locator('.attraction-list-button')).toHaveCount(1);
    const marker = page.locator(`[data-marker-id="${journey.id}"]`);
    await expect(marker).toBeVisible();
    await expect(page.locator('.attraction-icon')).toHaveCount(1);
    await marker.click();
    await expect(page.locator('#card-area')).toHaveText(journey.address);
    await expect(page.locator('#card-description')).not.toBeEmpty();
    await expect(page.locator('#card-verified')).toHaveText('Данные проверены 05.10.2026');
    await expect(page.locator('#card-coordinate-source')).toHaveAttribute('href', /^https:/);
    await expect(page.locator('#route-label')).toHaveText('Построить маршрут');
    const link = page.locator('#route-button');
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeInViewport();
    const url = new URL(await link.getAttribute('href'));
    expect(url.pathname).toBe('/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    const routeDestinations = {
      baiterek: '4CHJ+86C Bäiterek, Астана 01000',
      'nur-astana-mosque': '«Әбу Насыр Әл-Фараби» мешіті, Қабанбай батыр даңғылы 36, Астана 010000',
      'expo-nur-alem': 'Alem.ai - Международный центр искусственного интеллекта, пр-т. Мангилик Ел. 55/1, Астана 010000',
      'central-park': '5C4C+C2 Astanalyq Ortalyq Saiabaq, Астана 020000',
      'line-brew': 'Line Brew Astana, Кенесары көшесі 20, Астана 010000',
      'duman-entertainment-center': 'Ailand, Коргалжинское ш. 2, Астана 020000'
    };
    expect(url.searchParams.get('destination')).toBe(routeDestinations[journey.id]);
    await expect(page.locator('#card-point')).toContainText(journey.destination.split(',').map(Number).map(value => value.toFixed(6)).join(', '));
    const placeIds = {
      baiterek: 'ChIJ99yqDB6ERUIROR0Rh__gbE8',
      'nur-astana-mosque': 'ChIJzfILUyeERUIR_PY8wZBAHl4',
      'expo-nur-alem': 'ChIJBZWlvhnGhiARn_G8Kfrrwc0',
      'central-park': 'ChIJ476EiMWGRUIRK0nC8VtaaTw',
      'line-brew': 'ChIJ9-_Ll9CGRUIRDVUKzd8Pu4Q',
      'duman-entertainment-center': 'ChIJU1o1H-mDRUIRMEblwSZmPPs'
    };
    expect(url.searchParams.get('destination_place_id')).toBe(placeIds[journey.id]);
    expect(url.searchParams.has('origin')).toBe(false);
    // Capture the actual outgoing navigation without making CI depend on Google.
    await context.route('https://www.google.com/maps/dir/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Route navigation captured</title>' }));
    const popupPromise = page.waitForEvent('popup');
    await link.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    expect(new URL(popup.url()).searchParams.get('destination')).toBe(routeDestinations[journey.id]);
    await popup.close();
    await page.locator('#close-button').click();
    await expect(page.locator('#search-input')).toHaveValue(journey.query);
    await expect(page.locator(`[data-filter="${journey.category}"]`)).toHaveAttribute('aria-pressed', 'true');
  });
}

test('examples are explicit and route to their real host; switching cards clears optional links', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#places-counter')).toHaveText('12 мест');
  await page.locator('[data-filter="event"]').click();
  await expect(page.locator('[data-filter="event"]')).toContainText('Примеры');
  if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
  await expect(page.locator('#events-notice')).toBeVisible();
  await expect(page.locator('#places-counter')).toHaveText('3 примера событий');
  await page.locator('[data-place-id="demo-chamber-evening"]').click();
  await expect(page.locator('#card-notice')).toContainText('Это не анонс');
  await expect(page.locator('#card-area')).toHaveText('Улица Динмухамеда Кунаева, 1');
  await expect(page.locator('#route-label')).toHaveText('Построить маршрут к площадке');
  const url = new URL(await page.locator('#route-button').getAttribute('href'));
  expect(url.searchParams.get('destination')).toBe('Astana Operası, Дінмұхамед Қонаев көшесі 1, Астана 010000');
  expect(url.searchParams.get('destination_place_id')).toBe('ChIJ1bEghpmGRUIR4m_Boh67xl0');
  await expect(page.locator('#card-program')).toBeVisible();
  await page.locator('#close-button').click();
  await page.locator('[data-filter="all"]').click();
  await page.locator('#search-input').fill('Музей сингулярности');
  await page.locator('[data-place-id="expo-nur-alem"]').click();
  await expect(page.locator('#card-program')).toBeHidden();
  await expect(page.locator('#card-program')).not.toHaveAttribute('href');
  await expect(page.locator('#card-source')).toHaveAttribute('href', 'https://alem.ai/ru/');
  await expect(page.locator('#card-name')).toHaveText('Нур Алем · alem.ai');
});
