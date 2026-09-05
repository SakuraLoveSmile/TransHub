import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

// 开发时代理 /api 与 /health 到本机 FastAPI（默认 127.0.0.1:8765）。
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: false,
      },
      "/health": {
        target: "http://127.0.0.1:8765",
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
