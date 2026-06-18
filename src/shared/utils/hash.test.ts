/**
 * hash.test.ts
 * DJB2 해시 함수 검증
 */
import { describe, it, expect } from 'vitest';
import { hashString } from './hash';

describe('hashString', () => {
	it('빈 문자열은 고정된 해시값을 반환한다', () => {
		expect(hashString('')).toBe(5381 >>> 0);
	});

	it('동일 입력에 대해 항상 동일한 해시값을 반환한다', () => {
		const h1 = hashString('hello world');
		const h2 = hashString('hello world');
		expect(h1).toBe(h2);
	});

	it('다른 입력은 (거의 확실히) 다른 해시값을 반환한다', () => {
		const h1 = hashString('hello');
		const h2 = hashString('world');
		expect(h1).not.toBe(h2);
	});

	it('반환값은 32비트 unsigned integer 범위 내에 있다', () => {
		const h = hashString('some long string for testing');
		expect(h).toBeGreaterThanOrEqual(0);
		expect(h).toBeLessThanOrEqual(0xffffffff);
	});

	it('문자열 길이에 민감하다 (한 글자 차이로도 해시가 달라짐)', () => {
		const h1 = hashString('abc');
		const h2 = hashString('abcd');
		expect(h1).not.toBe(h2);
	});
});