import { defineConfig } from "vite";

// Относительные пути: сайт работает из любой папки (GitHub Pages, Cloudflare Pages, локально)
export default defineConfig({
  base: "./",
});
