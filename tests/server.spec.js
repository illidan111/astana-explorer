import { test, expect } from '@playwright/test';

test('static server serves the app without exposing internal files', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'HTTP server behavior does not depend on viewport.');
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  const head = await request.head('/');
  expect(head.status()).toBe(200);
  expect(await head.body()).toHaveLength(0);
  for (const pathname of ['/.git/config', '/.env', '/node_modules/@playwright/test/package.json', '/NODE_MODULES/@playwright/test/package.json', '/..%5C..%5CWindows/win.ini']) {
    const privateFile = await request.get(pathname);
    expect(privateFile.status(), pathname).toBe(404);
  }
  const unsupportedMethod = await request.post('/');
  expect(unsupportedMethod.status()).toBe(405);
});
