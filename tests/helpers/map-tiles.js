import { fileURLToPath } from 'node:url';

export const tileUrl = 'https://tile.openstreetmap.org/**';
const tileFixture = fileURLToPath(new URL('../fixtures/tile.png', import.meta.url));

// Assertions about real OSM responses stay in the explorer smoke scenario.
// UI state and recovery tests use a real local PNG with predictable timing.
export async function useLocalMapTiles(page) {
  await page.route(tileUrl, (route) => route.fulfill({
    status: 200, contentType: 'image/png', path: tileFixture
  }));
}
