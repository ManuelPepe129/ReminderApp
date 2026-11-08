import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real stack (API + Vite dev server + Postgres).
 * Prerequisite: `docker compose up -d db mailpit` (Postgres on 5433).
 * Servers already running on :3000 / :5173 are reused.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'npm run dev -w @reminder/api',
          cwd: '..',
          url: 'http://localhost:3000/api/health',
          reuseExistingServer: true,
          timeout: 60_000,
          env: { AUTH_RATE_LIMIT_PER_15MIN: '500', LOG_LEVEL: 'warn' },
        },
        {
          command: 'npm run dev -w @reminder/web',
          cwd: '..',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 60_000,
        },
      ],
});
