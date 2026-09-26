import { describe, it, expect } from 'vitest';
import { sanitizeSafeTitle, generateTitle } from './titleGenerator';
import type { UIChatMessage } from '../../../shared/types/chat.types';

describe('titleGenerator', () => {
	describe('sanitizeSafeTitle', () => {
		it('금지 문자(/\\:*?"<>|) 및 제어문자를 언더스코어로 대체한다', () => {
			const dirty = 'My/Test:Title*With?"Bad<Chars>|And.Spaces. ';
			const cleaned = sanitizeSafeTitle(dirty);
			expect(cleaned).toBe('My_Test_Title_With__Bad_Chars__And.Spaces');
			expect(cleaned).not.toMatch(/[\\/:*?"<>|]/);
		});

		it('빈 문자열이나 공백만 있는 경우 기본 제목을 반환한다', () => {
			expect(sanitizeSafeTitle('')).toBe('New Chat');
			expect(sanitizeSafeTitle('   ')).toBe('New Chat');
		});
	});

	describe('generateTitle', () => {
		it('첫 번째 사용자 메시지 내용으로 최대 40자의 제목을 생성한다', () => {
			const messages: UIChatMessage[] = [
				{
					id: '1',
					role: 'user',
					content: '옵시디언 플러그인 개발 방법에 대해 자세히 알려주세요.',
					timestamp: 1000,
					isStreaming: false,
				},
				{
					id: '2',
					role: 'assistant',
					content: '네, 옵시디언 플러그인은...',
					timestamp: 2000,
					isStreaming: false,
				},
			];
			const title = generateTitle(messages);
			expect(title).toBe('옵시디언 플러그인 개발 방법에 대해 자세히 알려주세요.');
		});

		it('40자가 넘는 긴 메시지는 40자에서 자르고 말줄임표(…)를 붙인다', () => {
			const longText = '가'.repeat(50);
			const messages: UIChatMessage[] = [
				{
					id: '1',
					role: 'user',
					content: longText,
					timestamp: 1000,
					isStreaming: false,
				},
			];
			const title = generateTitle(messages);
			expect(title).toBe('가'.repeat(40) + '…');
		});

		it('메시지 텍스트가 없고 첨부파일만 있을 때는 첫 번째 첨부파일 이름을 제목으로 사용한다', () => {
			const messages: UIChatMessage[] = [
				{
					id: '1',
					role: 'user',
					content: '',
					attachments: [{ name: 'document.pdf', type: 'file', path: 'document.pdf' }],
					timestamp: 1000,
					isStreaming: false,
				},
			];
			const title = generateTitle(messages);
			expect(title).toBe('document.pdf');
		});

		it('사용자 메시지가 없는 경우 기본 제목을 반환한다', () => {
			expect(generateTitle([])).toBe('New Chat');
		});
	});
});
