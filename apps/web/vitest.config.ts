import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Crypto tests run in Node (which provides WebCrypto via globalThis.crypto).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
