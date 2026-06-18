/**
 * llmTextSanitizer.test.ts
 * LLM 응답 텍스트 정제 함수 검증
 */
import { describe, it, expect } from 'vitest';
import {
	stripMaskTokens,
	stripThinkTags,
	stripToolCallTags,
	extractThinkBlocks,
	sanitizeDisplayContent,
} from './llmTextSanitizer';

// ── stripMaskTokens ──

describe('stripMaskTokens', () => {
	it('mask 토큰 블록을 제거한다', () => {
		const input = 'Hello <|mask_start|>secret<|mask_end|> World';
		expect(stripMaskTokens(input)).toBe('Hello  World');
	});

	it('여러 mask 블록을 모두 제거한다', () => {
		const input = '<|mask_start|>a<|mask_end|> keep <|mask_start|>b<|mask_end|>';
		expect(stripMaskTokens(input)).toBe('keep');
	});

	it('mask 토큰이 없으면 원본 그대로 반환', () => {
		expect(stripMaskTokens('plain text')).toBe('plain text');
	});
});

// ── stripThinkTags ──

describe('stripThinkTags', () => {
	it('<think> 블록을 제거한다', () => {
		const input = '<think>reasoning process</think> final answer';
		expect(stripThinkTags(input)).toBe('final answer');
	});

	it('<thinking> 블록도 제거한다', () => {
		const input = '<thinking>analyzing</thinking> result';
		expect(stripThinkTags(input)).toBe('result');
	});

	it('닫는 태그 없이 열린 경우에도 제거', () => {
		const input = '<think>unclosed reasoning';
		expect(stripThinkTags(input)).toBe('');
	});

	it('think 태그가 없으면 원본 유지', () => {
		expect(stripThinkTags('normal text')).toBe('normal text');
	});
});

// ── stripToolCallTags ──

describe('stripToolCallTags', () => {
	it('tool_call 태그 블록을 제거한다', () => {
		const input = '<tool_call>{"name":"fn"}</tool_call> result';
		expect(stripToolCallTags(input)).toBe('result');
	});

	it('lumina_tool_call 태그 블록을 제거한다', () => {
		const input = 'pre <lumina_tool_call>something</lumina_tool_call> post';
		expect(stripToolCallTags(input)).toBe('pre  post');
	});
});

// ── extractThinkBlocks ──

describe('extractThinkBlocks', () => {
	it('<think> 블록 내용을 추출한다', () => {
		const input = '<think>step 1</think> answer <think>step 2</think>';
		const blocks = extractThinkBlocks(input);
		expect(blocks).toEqual(['step 1', 'step 2']);
	});

	it('<thinking> 블록 내용도 추출한다', () => {
		const input = '<thinking>analysis</thinking> result';
		expect(extractThinkBlocks(input)).toEqual(['analysis']);
	});

	it('think 블록이 없으면 빈 배열', () => {
		expect(extractThinkBlocks('no blocks here')).toEqual([]);
	});

	it('빈 think 블록은 필터링', () => {
		const input = '<think></think> <think>valid</think>';
		expect(extractThinkBlocks(input)).toEqual(['valid']);
	});
});

// ── sanitizeDisplayContent ──

describe('sanitizeDisplayContent', () => {
	it('모든 특수 태그를 제거하고 텍스트만 반환', () => {
		const input = '<think>reason</think><tool_call>x</tool_call>final<|mask_start|>y<|mask_end|>';
		expect(sanitizeDisplayContent(input)).toBe('final');
	});

	it('일반 텍스트는 그대로 반환', () => {
		expect(sanitizeDisplayContent('Hello, world!')).toBe('Hello, world!');
	});
});