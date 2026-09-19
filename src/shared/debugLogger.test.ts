import { describe, it, expect, vi, beforeEach } from 'vitest';
import { debugLogger } from './debugLogger';

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
});
