import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import {
	utf8ToBase64,
	base64ToUtf8,
	extractFrontmatter,
	parseFrontmatterFromContent,
	parseTimestamp,
	parseTimestampFromFilename,
	sanitizeAttachmentsForStorage,
	serializeSession,
} from './historySerializer';
import type { ChatSession } from '../../../shared/types/chat.types';

describe('historySerializer', () => {
	describe('utf8ToBase64 and base64ToUtf8', () => {
		it('인코딩 및 디코딩이 유니코드(한글, 이모지 등)를 온전하게 보존한다', () => {
			const original = '안녕하세요 Lumina AI ✦ 테스트 문자열 with emoji 🚀 & special chars: <>&"';
			const encoded = utf8ToBase64(original);
			const decoded = base64ToUtf8(encoded);
			expect(decoded).toBe(original);
		});

		it('긴 문자열(청크 크기 초과)도 안정적으로 변환한다', () => {
			const longStr = 'A'.repeat(20000) + '가나다라' + 'B'.repeat(20000);
			const encoded = utf8ToBase64(longStr);
			const decoded = base64ToUtf8(encoded);
			expect(decoded).toBe(longStr);
		});
	});

	describe('extractFrontmatter', () => {
		it('마크다운 frontmatter 블록을 정확히 파싱한다', () => {
			const md = [
				'---',
				'id: session-123',
				'title: "테스트 세션"',
				'provider: openai',
				'model: gpt-4o',
				'---',
				'# 본문 내용',
			].join('\n');

			const result = extractFrontmatter(md);
			expect(result).toEqual({
				id: 'session-123',
				title: '"테스트 세션"',
				provider: 'openai',
				model: 'gpt-4o',
			});
		});

		it('frontmatter가 없는 마크다운 텍스트는 null을 반환한다', () => {
			const md = '# 일반 마크다운 파일\n내용입니다.';
			expect(extractFrontmatter(md)).toBeNull();
		});
	});

	describe('parseFrontmatterFromContent', () => {
		it('파일과 content로부터 메타데이터를 올바르게 추출한다', () => {
			const mockFile = new TFile();
			mockFile.stat = { ctime: 1000, mtime: 2000, size: 100 };

			const content = [
				'---',
				'id: session-abc',
				'title: "세션 제목"',
				'provider: anthropic',
				'model: claude-3-5-sonnet',
				'created: 1500',
				'updated: 2500',
				'---',
			].join('\n');

			const res = parseFrontmatterFromContent(content, mockFile);
			expect(res).not.toBeNull();
			expect(res?.id).toBe('session-abc');
			expect(res?.title).toBe('세션 제목');
			expect(res?.provider).toBe('anthropic');
			expect(res?.model).toBe('claude-3-5-sonnet');
			expect(res?.created).toBe('1500');
			expect(res?.updated).toBe('2500');
		});
	});

	describe('parseTimestamp and parseTimestampFromFilename', () => {
		it('숫자 및 유효한 날짜 문자열을 timestamp로 변환한다', () => {
			expect(parseTimestamp(12345, 0)).toBe(12345);
			const now = Date.now();
			expect(parseTimestamp(new Date(now).toISOString(), 0)).toBe(now);
			expect(parseTimestamp(undefined, 999)).toBe(999);
			expect(parseTimestamp('invalid-date', 999)).toBe(999);
		});

		it('파일명(YYMMDD_HHMM - title.md) 형식에서 timestamp를 정상 파싱한다', () => {
			const filename = '260924_0800 - Test Chat.md';
			const ts = parseTimestampFromFilename(filename);
			expect(ts).not.toBeNull();
			const d = new Date(ts!);
			expect(d.getFullYear()).toBe(2026);
			expect(d.getMonth()).toBe(8); // 0-indexed (9월)
			expect(d.getDate()).toBe(24);
			expect(d.getHours()).toBe(8);
			expect(d.getMinutes()).toBe(0);
		});

		it('형식이 맞지 않는 파일명은 null을 반환한다', () => {
			expect(parseTimestampFromFilename('invalid-file-format.md')).toBeNull();
		});
	});

	describe('sanitizeAttachmentsForStorage and serializeSession', () => {
		it('첨부파일의 content(base64 등)를 제거하고 메타데이터만 남긴다', () => {
			const sanitized = sanitizeAttachmentsForStorage([
				{ name: 'image.png', type: 'file', content: 'data:image/png;base64,...', path: '/vault/image.png' },
			]);
			expect(sanitized).toBeDefined();
			expect(sanitized![0].name).toBe('image.png');
			expect(sanitized![0].content).toBeUndefined();
			expect(sanitized![0].path).toBe('/vault/image.png');
		});

		it('세션을 마크다운 및 Base64 블록으로 안전하게 직렬화한다', () => {
			const session: ChatSession = {
				id: 'sess-001',
				title: '테스트 대화',
				createdAt: 1700000000000,
				updatedAt: 1700000001000,
				providerId: 'openai',
				modelId: 'gpt-4o',
				messages: [
					{
						id: 'm1',
						role: 'user',
						content: '안녕하세요',
						timestamp: 1700000000000,
						isStreaming: false,
					},
					{
						id: 'm2',
						role: 'assistant',
						content: '<think>생각중...</think>반갑습니다!',
						timestamp: 1700000001000,
						model: 'gpt-4o',
						isStreaming: false,
					},
				],
			};

			const serialized = serializeSession(session);
			expect(serialized).toContain('id: sess-001');
			expect(serialized).toContain('**👤 You**');
			expect(serialized).toContain('**✦ Lumina**');
			expect(serialized).toContain('<!-- LUMINA_HISTORY_DATA_V2:');
			// <think> 태그는 sanitizeDisplayContent에 의해 본문에서 정제됨
			expect(serialized).toContain('반갑습니다!');
			expect(serialized).not.toContain('<think>생각중...</think>');
		});
	});
});
