import { describe, it, expect } from 'vitest';
import { TextParser } from './TextParser';

describe('TextParser', () => {
	describe('parse', () => {
		it('should strip HTML tags and scripts/styles', async () => {
			const html = `
				<html>
				<style>body { color: red; }</style>
				<script>alert(1);</script>
				<body><p>Hello <b>World</b></p></body>
				</html>
			`;
			const result = await TextParser.parse(html, 'html');
			expect(result).toBe('Hello World');
		});

		it('should parse JSON into pretty format', async () => {
			const json = `{"a": 1, "b": {"c": 2}}`;
			const result = await TextParser.parse(json, 'json');
			expect(result).toContain('"a": 1');
			expect(result).toContain('"c": 2');
		});

		it('should parse JSONL correctly', async () => {
			const jsonl = `{"x": 1}\n{"y": 2}`;
			const result = await TextParser.parse(jsonl, 'jsonl');
			expect(result).toContain('"x": 1');
			expect(result).toContain('"y": 2');
		});

		it('should delegate YAML to parseYaml', async () => {
			const yaml = `key: value`;
			const result = await TextParser.parse(yaml, 'yaml');
			expect(result).toBe('key: value');
		});

		it('should pass through unknown extensions', async () => {
			const text = `plain text`;
			const result = await TextParser.parse(text, 'txt');
			expect(result).toBe(text);
		});
	});

	describe('parseYaml', () => {
		it('should parse simple key-value', () => {
			const yaml = `name: John\nage: 30`;
			const result = TextParser.parseYaml(yaml);
			expect(result).toBe('name: John\nage: 30');
		});

		it('should handle indentation and prefixes', () => {
			const yaml = `
parent:
  child1: value1
  child2:
    - listitem1
    - listitem2
`;
			const result = TextParser.parseYaml(yaml);
			expect(result).toContain('[parent]');
			expect(result).toContain('  child1: value1');
			expect(result).toContain('[child2]');
			expect(result).toContain('  • listitem1');
		});

		it('should ignore comments and empty lines', () => {
			const yaml = `
# comment
key: val

key2: val2
`;
			const result = TextParser.parseYaml(yaml);
			expect(result).toBe('key: val\nkey2: val2');
		});
	});
});
