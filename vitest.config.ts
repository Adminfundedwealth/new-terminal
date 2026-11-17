import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    reporters: ["default"],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    pool: "forks",
  },
  poolOptions: {
    forks: {
      singleFork: true,
    },
  },
  resolve: {
    extensions: [".mjs", ".mts", ".ts", ".tsx", ".js", ".jsx", ".json"],
    alias: { "@": path.resolve(rootDir, "./src") },
  },
});
