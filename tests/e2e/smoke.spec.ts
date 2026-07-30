import { expect, test } from '@playwright/test';

test('login surface renders without an uncaught application error', async ({
  page,
}) => {
  const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator('body')).not.toContainText(
    'Application error: a client-side exception has occurred'
  );
});

test('admin health endpoints are protected', async ({ request }) => {
  const response = await request.get('/api/admin/source-health');
  expect([401, 403]).toContain(response.status());
});

test('authenticated search respects the twelve-source request ceiling', async ({
  request,
}) => {
  test.skip(
    !process.env.E2E_USERNAME || !process.env.E2E_PASSWORD,
    'staging credentials are required'
  );
  const login = await request.post('/api/login', {
    data: {
      username: process.env.E2E_USERNAME,
      password: process.env.E2E_PASSWORD,
    },
  });
  expect(login.ok()).toBeTruthy();

  const search = await request.get('/api/search?q=%E7%8B%82%E9%A3%99');
  expect(search.ok()).toBeTruthy();
  const attempted = Number(search.headers()['x-moontv-sources-attempted'] || 0);
  expect(attempted).toBeLessThanOrEqual(12);
});

test('owner can open the operations dashboard with all configured sources', async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_USERNAME || !process.env.E2E_PASSWORD,
    'staging credentials are required'
  );
  const login = await page.request.post('/api/login', {
    data: {
      username: process.env.E2E_USERNAME,
      password: process.env.E2E_PASSWORD,
    },
  });
  expect(login.ok()).toBeTruthy();

  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: '运行概览与资源健康' })
  ).toBeVisible();
  await expect(page.getByText('72', { exact: true }).first()).toBeVisible();
});
