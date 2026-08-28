import { defineConfig } from "vite";

// GitHub Pages serves this from https://gizmo73.github.io/24-mile-hex-owlbear/,
// not from a domain root, so every built asset path needs the repo prefix.
export default defineConfig({
  base: "/24-mile-hex-owlbear/",
  build: {
    target: "es2020",
  },
});
