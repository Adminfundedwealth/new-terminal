import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath } from "node:url";

const localApiProxy = {
  "/api/kite/login": { target: "http://127.0.0.1:4002", changeOrigin: true },
  "/api/kite/callback": { target: "http://127.0.0.1:4002", changeOrigin: true },
  "/api/kite-proxy": { target: "http://127.0.0.1:4002", changeOrigin: true },
  "/api/kite/status": { target: "http://127.0.0.1:4002", changeOrigin: true },
  "/api/dhan-proxy": { target: "http://127.0.0.1:4002", changeOrigin: true },
  "/api/nse-proxy": { target: "http://127.0.0.1:4002", changeOrigin: true },
  "/api/tv-scan": { target: "http://127.0.0.1:4002", changeOrigin: true },
  "/api/yahoo-chart": { target: "http://127.0.0.1:4002", changeOrigin: true },
  "/api/indian-news": { target: "http://127.0.0.1:4002", changeOrigin: true },
  "/api/test-connection": { target: "http://127.0.0.1:4002", changeOrigin: true },
  "/health": { target: "http://127.0.0.1:4002", changeOrigin: true },
  "/api/terminal": { target: "http://127.0.0.1:4011", changeOrigin: true },
};

const vendorChunks = {
  "vendor-react": ["react", "react-dom", "react-router-dom", "@tanstack/react-query"],
  "vendor-charts": ["recharts", "lightweight-charts"],
  "vendor-ui": [
    "@radix-ui/react-dialog",
    "@radix-ui/react-popover",
    "@radix-ui/react-select",
    "@radix-ui/react-tabs",
    "@radix-ui/react-tooltip",
    "@radix-ui/react-dropdown-menu",
    "@radix-ui/react-context-menu",
    "@radix-ui/react-scroll-area",
    "@radix-ui/react-toggle",
    "@radix-ui/react-toggle-group",
    "@radix-ui/react-switch",
    "@radix-ui/react-label",
    "@radix-ui/react-separator",
    "@radix-ui/react-slot",
  ],
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 4001,
    proxy: localApiProxy,
    hmr: {
      overlay: false,
    },
  },
  preview: {
    proxy: localApiProxy,
  },
  plugins: [react()],
  resolve: {
    extensions: [".mjs", ".mts", ".ts", ".tsx", ".js", ".jsx", ".json"],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll("\\", "/");
          for (const [chunkName, packages] of Object.entries(vendorChunks)) {
            if (packages.some((name) => normalizedId.includes(`/node_modules/${name}/`))) {
              return chunkName;
            }
          }
        },
      },
    },
  },
}));
