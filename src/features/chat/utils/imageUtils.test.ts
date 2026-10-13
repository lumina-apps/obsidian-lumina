import { describe, it, expect } from 'vitest';
import {
	computeTargetDimensions,
	resizeImageDataUrl,
	DEFAULT_MAX_IMAGE_EDGE,
} from './imageUtils';

describe('imageUtils', () => {
	describe('computeTargetDimensions', () => {
		it('returns original dimensions if longest edge is within maxEdge', () => {
			const res = computeTargetDimensions(1000, 800, 1568);
			expect(res).toEqual({ width: 1000, height: 800 });
		});

		it('scales down width-heavy image maintaining aspect ratio', () => {
			const res = computeTargetDimensions(3136, 1568, 1568);
			expect(res.width).toBe(1568);
			expect(res.height).toBe(784);
		});

		it('scales down height-heavy image maintaining aspect ratio', () => {
			const res = computeTargetDimensions(1000, 3136, 1568);
			expect(res.height).toBe(1568);
			expect(res.width).toBe(500);
		});

		it('handles square image over limit', () => {
			const res = computeTargetDimensions(2000, 2000, 1000);
			expect(res).toEqual({ width: 1000, height: 1000 });
		});

		it('handles zero or negative dimensions safely', () => {
			expect(computeTargetDimensions(0, 0)).toEqual({ width: 0, height: 0 });
		});
	});

	describe('resizeImageDataUrl', () => {
		it('does not modify non-image data URL', async () => {
			const nonImage = 'data:text/plain;base64,SGVsbG8=';
			const res = await resizeImageDataUrl(nonImage);
			expect(res).toBe(nonImage);
		});

		it('preserves GIF without canvas rendering', async () => {
			const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
			const res = await resizeImageDataUrl(gif);
			expect(res).toBe(gif);
		});

		it('returns dataUrl via timeout fallback when image is not loaded by jsdom', async () => {
			const dummyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
			const res = await resizeImageDataUrl(dummyPng);
			expect(res).toBe(dummyPng);
		});
	});
});
