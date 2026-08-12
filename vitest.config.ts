import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
	plugins: [svelte()],
	resolve: {
		conditions: ['browser', 'development', 'import'],
		alias: {
			bluebird: resolve(__dirname, 'src/core/mocks/bluebird.js'),
			'bluebird/js/release/promise': resolve(__dirname, 'src/core/mocks/bluebird.js'),
			ajv: resolve(__dirname, 'src/core/mocks/ajv.js'),
			'ajv-formats': resolve(__dirname, 'src/core/mocks/ajv-formats.js'),
			underscore: resolve(__dirname, 'src/core/mocks/underscore.js'),
			obsidian: resolve(__dirname, 'src/core/mocks/obsidian.js'),
		},
		extensions: ['.svelte.ts', '.ts', '.js', '.svelte'],
	},
	test: {
		environment: 'jsdom',
		setupFiles: ['./vitest.setup.ts'],
		include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
	},
});