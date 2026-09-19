import { describe, it, expect, vi } from 'vitest';
import { formatMcpError, isDangerousTool, withTimeout } from './mcpUtils';

describe('mcpUtils', () => {
	describe('formatMcpError', () => {
		it('should return the error if already an Error instance', () => {
			const err = new Error('test error');
			expect(formatMcpError(err)).toBe(err);
		});

		it('should convert a string to an Error instance with context', () => {
			const err = formatMcpError('not found', 'FetchError');
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('FetchError: not found');
		});

		it('should convert unknown values without context', () => {
			const err = formatMcpError(404);
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('404');
		});
	});

	describe('isDangerousTool', () => {
		it('should detect standard dangerous verbs', () => {
			expect(isDangerousTool('create_note')).toBe(true);
			expect(isDangerousTool('write_file')).toBe(true);
			expect(isDangerousTool('delete_note')).toBe(true);
			expect(isDangerousTool('append_to_note')).toBe(true);
			expect(isDangerousTool('update_frontmatter')).toBe(true);
			expect(isDangerousTool('replace_note')).toBe(true);
			expect(isDangerousTool('move_note')).toBe(true);
			expect(isDangerousTool('patch_note')).toBe(true);
			expect(isDangerousTool('save_attachment')).toBe(true);
			expect(isDangerousTool('mkdir')).toBe(true);
		});

		it('should detect snake_case and delimiter-separated keywords like link, moc, shell, cmd', () => {
			expect(isDangerousTool('auto_link_note')).toBe(true);
			expect(isDangerousTool('generate_moc')).toBe(true);
			expect(isDangerousTool('link_note')).toBe(true);
			expect(isDangerousTool('run_shell_command')).toBe(true);
			expect(isDangerousTool('run_cmd')).toBe(true);
			expect(isDangerousTool('eval_js')).toBe(true);
			expect(isDangerousTool('bash_script')).toBe(true);
		});

		it('should NOT falsely detect safe tools containing substrings of keywords', () => {
			expect(isDangerousTool('fetch_hyperlink')).toBe(false);
			expect(isDangerousTool('mock_data')).toBe(false);
			expect(isDangerousTool('get_command_list')).toBe(false);
			expect(isDangerousTool('read_note')).toBe(false);
			expect(isDangerousTool('search_notes')).toBe(false);
			expect(isDangerousTool('get_backlinks')).toBe(false);
		});
	});

	describe('withTimeout', () => {
		it('should resolve if promise resolves before timeout', async () => {
			const result = await withTimeout(Promise.resolve('ok'), 1000);
			expect(result).toBe('ok');
		});

		it('should reject if promise times out', async () => {
			const slowPromise = new Promise((resolve) => setTimeout(resolve, 50));
			await expect(withTimeout(slowPromise, 10, 'timed out')).rejects.toThrow('timed out');
		});

		it('should clear timeout when promise finishes', async () => {
			const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
			await withTimeout(Promise.resolve(42), 500);
			expect(clearTimeoutSpy).toHaveBeenCalled();
			clearTimeoutSpy.mockRestore();
		});
	});
});

