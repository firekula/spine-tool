import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  build: {
    outDir: "dist-offline",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./offline/index.html", import.meta.url)),
    },
  },
});
