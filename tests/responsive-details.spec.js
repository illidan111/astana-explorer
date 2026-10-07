import { test, expect } from '@playwright/test';

// These viewports cover short windows as well as portrait and landscape phones.
const viewports = [[320, 400], [320, 568], [667, 375], [390, 844], [820, 600], [1440, 1000]];

async function expectUncovered(locator) {
  await expect(locator).toBeInViewport();
  expect(await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
}

async function expectVisibleMapIcon(page) {
  await expect.poll(() => page.locator('#map').evaluate((map) => {
    const bounds = map.getBoundingClientRect();
    return [...map.querySelectorAll('.attraction-icon, .custom-marker-cluster')].some((icon) => {
      const rect = icon.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.left < bounds.left || rect.right > bounds.right
        || rect.top < bounds.top || rect.bottom > bounds.bottom) return false;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === icon || icon.contains(hit);
    });
  }), { message: 'At least one complete, uncovered marker or cluster must be inside the map' }).toBe(true);
}

for (const [width, height] of viewports) {
  test(`error, empty state, list and scrolled dialogs stay usable at ${width}×${height}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Explicit viewport coverage runs once.');
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/tile.openstreetmap.org/**', (route) => route.abort());
    await page.goto('/');
    if (await page.locator('#view-map').isVisible()) await page.locator('#view-map').click();
    await expect(page.locator('#retry-map')).toBeVisible();
    await expectVisibleMapIcon(page);
    await page.locator('#fit-map').click();
    await expectVisibleMapIcon(page);
    for (const id of ['fit-map', 'find-me-button', 'zoom-in', 'zoom-out']) {
      await expectUncovered(page.locator(`#${id}`));
    }
    // A failed tile layer may not cover the retry action or the zoom controls.
    await page.locator('#retry-map').scrollIntoViewIfNeeded();
    await expectUncovered(page.locator('#retry-map'));

    await page.locator('#search-input').fill('несуществующееместо');
    const reset = page.locator('#map-reset-filters');
    await reset.scrollIntoViewIfNeeded();
    await expectUncovered(reset);
    await reset.click();
    await expect(page.locator('#search-input')).toHaveValue('');

    if (width <= 760) {
      await page.locator('#view-list').click();
      const bounds = await page.evaluate(() => ({
        listBottom: document.getElementById('list-view').getBoundingClientRect().bottom,
        navigationTop: document.querySelector('.mobile-view-switch').getBoundingClientRect().top
      }));
      expect(bounds.listBottom).toBeLessThanOrEqual(bounds.navigationTop);
    }
    const place = page.locator('[data-place-id="nur-astana-mosque"]');
    await place.click();
    await expect(page.locator('#attraction-card')).toBeVisible();
    await expectUncovered(page.locator('#card-name'));
    await expectUncovered(page.locator('#route-button'));
    await expectUncovered(page.locator('#close-button'));
    await page.locator('#attraction-card').evaluate((dialog) => { dialog.scrollTop = dialog.scrollHeight; });
    await expectUncovered(page.locator('#close-button'));
    await page.locator('#close-button').click();
    await expect(place).toBeFocused();

    await page.locator('#about-button').click();
    await page.locator('#info-dialog').evaluate((dialog) => { dialog.scrollTop = dialog.scrollHeight; });
    await expectUncovered(page.locator('#info-close'));
    await page.locator('#info-close').click();
    await expect(page.locator('#info-dialog')).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}
