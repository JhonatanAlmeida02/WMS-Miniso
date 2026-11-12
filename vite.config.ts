import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    // Supabase local acessível pelo mesmo endereço do app (VITE_SUPABASE_URL=/sb)
    proxy: {
      "/sb": { target: "http://127.0.0.1:54321", changeOrigin: true, ws: true, rewrite: (p) => p.replace(/^\/sb/, "") },
    },
  },
  preview: { port: 5180 },
  build: { chunkSizeWarningLimit: 700 },
});
