import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';
const testsDeployedEnvironment = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  // Staging and production use real authentication and rate limits. Running a
  // release smoke suite as a single stream avoids creating an artificial login
  // spike while local test servers can still use full parallelism.
  fullyParallel: !testsDeployedEnvironment,
  workers: testsDeployedEnvironment ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    {
      name: 'tv',
      use: {
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 MoonTVPlus-TV',
      },
    },
  ],
});
