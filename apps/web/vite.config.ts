import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

// Build targets:
//  - web (GitHub Pages): base "/Raven/", PWA service worker on
//  - app (Electron/Capacitor): relative base "./", no service worker
const target = process.env.BUILD_TARGET ?? "web";
const base = process.env.VITE_BASE ?? (target === "app" ? "./" : "/");

const pwa = VitePWA({
  disable: target === "app",
  registerType: "autoUpdate",
  includeAssets: ["raven.svg"],
  manifest: {
    name: "Raven — Encrypted Messenger",
    short_name: "Raven",
    description: "End-to-end encrypted messenger. The server only ever sees ciphertext.",
    theme_color: "#0b0d0c",
    background_color: "#0b0d0c",
    display: "standalone",
    orientation: "portrait",
    start_url: base,
    scope: base,
    icons: [
      { src: "raven.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "raven.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
      { src: "raven.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  },
  workbox: {
    globPatterns: ["**/*.{js,css,html,svg,woff2}"],
    navigateFallback: `${base}index.html`,
    cleanupOutdatedCaches: true,
  },
});

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), pwa],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
