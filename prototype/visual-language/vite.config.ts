import { defineConfig } from 'vite';

// PROTOTYPE: lets the page import the engine and the factory Bank from the repo root.
export default defineConfig({ server: { fs: { allow: ['../..'] } } });
