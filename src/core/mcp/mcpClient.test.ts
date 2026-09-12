import { describe, it, expect, vi } from 'vitest';
import { LuminaMcpClient } from './mcpClient';
import type { McpServerConfig } from '../../shared/types/settings.types';

describe('LuminaMcpClient', () => {
	it('disconnect 호출 시 transport.close()가 에러를 던져도 transport 참조를 null로 정리한다', async () => {
		const config: McpServerConfig = {
			id: 'test-server',
			name: 'Test Server',
			transport: 'streamable-http',
			url: 'http://localhost:3000/sse',
			enabled: true,
			status: 'connected',
		};

		const client = new LuminaMcpClient(config);

		// transport mock 설정
		const mockTransport = {
			close: vi.fn().mockRejectedValue(new Error('Network error on closing socket')),
		};
		// private transport 주입
		(client as any).transport = mockTransport;

		// disconnect 호출 시 예외를 던져도 정상적으로 catch되거나 throw되더라도 transport는 null이어야 함
		await expect(client.disconnect()).rejects.toThrow('Network error on closing socket');

		// finally에 의해 transport가 null로 초기화되었는지 검증
		expect((client as any).transport).toBeNull();
	});

	it('정상적인 transport.close() 시 transport가 null로 정리된다', async () => {
		const config: McpServerConfig = {
			id: 'test-server',
			name: 'Test Server',
			transport: 'streamable-http',
			url: 'http://localhost:3000/sse',
			enabled: true,
			status: 'connected',
		};

		const client = new LuminaMcpClient(config);

		const mockTransport = {
			close: vi.fn().mockResolvedValue(undefined),
		};
		(client as any).transport = mockTransport;

		await client.disconnect();
		expect((client as any).transport).toBeNull();
		expect(mockTransport.close).toHaveBeenCalledTimes(1);
	});
});

