import { describe, it, expect, vi, beforeEach } from 'vitest';
import { debugLogger, redactBase64Images, formatMessagesForDebugLog, MAX_DEBUG_ENTRIES } from './debugLogger';

describe('debugLogger', () => {
	beforeEach(() => {
		debugLogger.clear();
		debugLogger.setEnabled(false);
	});

	it('should respect setEnabled for debug logs', () => {
		debugLogger.setEnabled(false);
		expect(debugLogger.isEnabled).toBe(false);
		debugLogger.logDebug('test', 'should not be logged');
		expect(debugLogger.getEntries()).toHaveLength(0);

		debugLogger.setEnabled(true);
		expect(debugLogger.isEnabled).toBe(true);
		debugLogger.logDebug('test', 'should be logged');
		const entries = debugLogger.getEntries();
		expect(entries).toHaveLength(1);
		expect(entries[0].type).toBe('system');
		if (entries[0].type === 'system') {
			expect(entries[0].message).toBe('[test] should be logged');
		}
	});

	it('should support logInfo when enabled', () => {
		debugLogger.setEnabled(true);
		debugLogger.logInfo('domain', 'info message');
		const entries = debugLogger.getEntries();
		expect(entries).toHaveLength(1);
		expect(entries[0].type).toBe('system');
		if (entries[0].type === 'system') {
			expect(entries[0].event).toBe('info');
			expect(entries[0].message).toBe('[domain] info message');
		}
	});

	it('should always logError even when disabled and log to console.error', () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		debugLogger.setEnabled(false);

		debugLogger.logError('test-domain', new Error('critical error'));

		const entries = debugLogger.getEntries();
		expect(entries).toHaveLength(1);
		expect(entries[0].type).toBe('error');
		if (entries[0].type === 'error') {
			expect(entries[0].message).toBe('critical error');
		}
		expect(consoleErrorSpy).toHaveBeenCalledWith('[Lumina:test-domain]', expect.any(Error));

		consoleErrorSpy.mockRestore();
	});

	it('should isolate listener errors without crashing other listeners', () => {
		const faultyListener = vi.fn(() => {
			throw new Error('Listener crash');
		});
		const goodListener = vi.fn();

		const unsub1 = debugLogger.onLog(faultyListener);
		const unsub2 = debugLogger.onLog(goodListener);

		debugLogger.setEnabled(true);
		debugLogger.logSystem('test', 'system event');

		expect(faultyListener).toHaveBeenCalled();
		expect(goodListener).toHaveBeenCalled();

		unsub1();
		unsub2();
	});

	it('should redact base64 image data URLs in logRequest and formatMessagesForDebugLog', () => {
		debugLogger.setEnabled(true);
		const fakeBase64 = 'A'.repeat(4096);
		const rawDataUrl = `data:image/png;base64,${fakeBase64}`;

		expect(redactBase64Images(rawDataUrl)).toMatch(/^\[image data: ~\d+KB\]$/);

		const formatted = formatMessagesForDebugLog([
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'Describe this image' },
					{ type: 'image_url', image_url: { url: rawDataUrl } },
				],
			},
		]);
		expect(formatted[0].content).not.toContain(fakeBase64);
		expect(formatted[0].content).toContain('[image data: ~');

		const reqId = debugLogger.logRequest({
			provider: 'openai',
			model: 'gpt-4o',
			temperature: 0.7,
			maxTokens: 1000,
			stream: true,
			systemPrompt: 'sys',
			messages: [{ role: 'user', content: ` inline ${rawDataUrl} ` }],
		});
		expect(reqId).toBeTruthy();
		expect(MAX_DEBUG_ENTRIES).toBe(200);

		const entries = debugLogger.getEntries();
		expect(entries).toHaveLength(1);
		if (entries[0].type === 'llm-request') {
			expect(entries[0].messages[0].content).not.toContain(fakeBase64);
			expect(entries[0].messages[0].content).toContain('[image data: ~');
		}
	});
});
