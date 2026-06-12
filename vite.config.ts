import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const tauriPlatform = process.env.TAURI_ENV_PLATFORM ?? process.env.TAURI_PLATFORM;
const isWindowsTarget = tauriPlatform === "windows" || (!tauriPlatform && process.platform === "win32");
const isTauriDebug = (process.env.TAURI_ENV_DEBUG ?? process.env.TAURI_DEBUG) === "true";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: isWindowsTarget ? "chrome105" : "safari13",
    minify: !isTauriDebug ? "esbuild" : false,
    sourcemap: isTauriDebug,
  },
});
