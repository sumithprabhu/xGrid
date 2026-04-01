import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const tapTradeRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      "@privy-io/react-auth": path.resolve(
        tapTradeRoot,
        "node_modules/@privy-io/react-auth",
      ),
      "@privy-io/wagmi": path.resolve(
        tapTradeRoot,
        "node_modules/@privy-io/wagmi",
      ),
      buffer: path.resolve(tapTradeRoot, "node_modules/buffer/index.js"),
    },
  },
  server: {
    proxy: {
      "/xstocks": {
        target: "https://api.backed.fi/api/v1",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/xstocks/, ""),
      },
    },
  },
});
