import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      "@esotericsoftware/spine-webgl-4.0",
      "@esotericsoftware/spine-webgl-4.1",
      "@esotericsoftware/spine-webgl-4.2",
      "@esotericsoftware/spine-webgl-4.3",
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
