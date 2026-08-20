import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const backendTarget = env["BACKEND_PROXY_TARGET"] ?? "http://127.0.0.1:8000";

  return {
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: backendTarget,
        },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      proxy: {
        "/api": {
          target: backendTarget,
        },
      },
    },
    build: {
      target: "es2022",
      // Local-only VRMs live under public/models/private and must not be copied into deployable output.
      copyPublicDir: false,
    },
  };
});
