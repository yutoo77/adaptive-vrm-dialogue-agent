import { defineConfig } from "@playwright/test";

const isCI = Boolean(process.env["CI"]);
const backendPython = process.platform === "win32"
  ? "..\\.venv\\Scripts\\python.exe"
  : "python";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:15173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    launchOptions: {
      args: ["--use-gl=swiftshader"],
    },
  },
  webServer: [
    {
      command: `${backendPython} -m uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 18000`,
      env: {
        DIALOGUE_PROVIDER: "mock",
        VOICEVOX_BASE_URL: "http://127.0.0.1:59999",
      },
      url: "http://127.0.0.1:18000/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run dev -- --port 15173",
      env: {
        BACKEND_PROXY_TARGET: "http://127.0.0.1:18000",
      },
      url: "http://127.0.0.1:15173",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
