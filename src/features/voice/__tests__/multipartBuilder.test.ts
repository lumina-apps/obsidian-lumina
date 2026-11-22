import { describe, it, expect } from 'vitest';
import { buildMultipartFormData } from '../stt/multipartBuilder';

describe('multipartBuilder', () => {
	it('텍스트 필드와 바이너리 파일 바이트를 올바른 multipart/form-data 형식으로 직렬화한다', () => {
		const payloadBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x02]);
		const { contentType, body } = buildMultipartFormData(
			{
				model: 'whisper-1',
				language: 'ko',
			},
			{
				fieldName: 'file',
				filename: 'meeting"1\r\n.wav',
				mimeType: 'audio/wav',
				bytes: payloadBytes,
			},
		);

		expect(contentType).toMatch(/^multipart\/form-data; boundary=----LuminaVoiceBoundary/);
		const boundary = contentType.split('boundary=')[1];
		const decoded = new TextDecoder().decode(new Uint8Array(body));

		expect(decoded).toContain(`--${boundary}\r\n`);
		expect(decoded).toContain('Content-Disposition: form-data; name="model"\r\n\r\nwhisper-1');
		expect(decoded).toContain('Content-Disposition: form-data; name="language"\r\n\r\nko');
		expect(decoded).toContain('filename="meeting_1__.wav"');
		expect(decoded).toContain('Content-Type: audio/wav');
		expect(decoded).toContain('RIFF');
		expect(decoded).toContain(`--${boundary}--\r\n`);
	});
});
