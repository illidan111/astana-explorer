import { test, expect } from '@playwright/test';

async function showList(page) {
  if (await page.locator('#view-list').isVisible()) await page.locator('#view-list').click();
}

test('removing favorites in another tab preserves focus on the next place or recovery action', async ({ page, context }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await showList(page);
  for (const id of ['baiterek', 'khan-shatyr']) {
    await page.locator(`[data-favorite-id="${id}"]`).click();
  }
  const peer = await context.newPage();
  await peer.goto('/', { waitUntil: 'domcontentloaded' });
  await showList(peer);
  await page.locator('#favorites-button').click();
  await page.locator('[data-place-id="baiterek"]').focus();
  await peer.locator('[data-favorite-id="baiterek"]').click();
  await expect(page.locator('[data-place-id="khan-shatyr"]')).toBeFocused();
  await expect(page.locator('.attraction-list-button')).toHaveCount(1);
  await peer.locator('[data-favorite-id="khan-shatyr"]').click();
  await expect(page.locator('.attraction-list-button')).toHaveCount(0);
  await expect(page.locator('#attraction-list .empty-state button')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#search-input')).toBeFocused();
  await expect(page.locator('.attraction-list-button')).toHaveCount(12);
});

test('theme follows the system until manually chosen and syncs across tabs', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-label', 'Включить светлую тему');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  const peer = await context.newPage();
  await peer.emulateMedia({ colorScheme: 'light' });
  await peer.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(peer.locator('html')).toHaveAttribute('data-theme', 'light');
  await peer.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'true');
  await peer.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await peer.evaluate(() => localStorage.removeItem('astana-explorer-theme'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
