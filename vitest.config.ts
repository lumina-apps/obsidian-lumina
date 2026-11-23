import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
	plugins: [svelte()],
	define: {
		__LUMINA_DEV_PRO__: false,
	},
	resolve: {
		conditions: ['browser', 'development', 'import'],
		alias: {
			ajv: resolve(__dirname, 'src/core/mocks/ajv.js'),
			'ajv-formats': resolve(__dirname, 'src/core/mocks/ajv-formats.js'),
			underscore: resolve(__dirname, 'src/core/mocks/underscore.js'),
			obsidian: resolve(__dirname, 'src/core/mocks/obsidian.js'),
			'pdfjs-dist': resolve(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
		},
		extensions: ['.svelte.ts', '.ts', '.js', '.svelte'],
	},
	test: {
		environment: 'jsdom',
		setupFiles: ['./vitest.setup.ts'],
		include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.{ts,svelte}'],
			exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/core/mocks/**', 'src/**/*.d.ts'],
		},
	},
});