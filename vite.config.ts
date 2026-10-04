import { defineConfig } from 'vite';

// Relative asset paths, so the build works under any path: GitHub Pages
// serves it from /constellation-gen/.
export default defineConfig({ base: './' });
