import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5050/admin/',
  },
  webServer: {
    command: 'npx http-server . -p 5050 -c-1',
    url: 'http://127.0.0.1:5050/admin/',
    reuseExistingServer: !process.env.CI,
  },
});
