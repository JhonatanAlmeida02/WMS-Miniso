import { defineConfig, devices } from "@playwright/test";

/**
 * Teste ponta a ponta contra um Supabase local:
 *   npx supabase start && npx supabase functions serve
 *   SUPABASE_SERVICE_ROLE_KEY=... npm run test:e2e
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  workers: 1,
  use: { baseURL: "http://localhost:5180", trace: "off", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  webServer: { command: "npx vite --port 5180 --strictPort", port: 5180, reuseExistingServer: true, timeout: 60_000 },
});
