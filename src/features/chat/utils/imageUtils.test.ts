import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
		const originalImage = globalThis.Image;
		const originalGetContext = HTMLCanvasElement.prototype.getContext;
		const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;

		afterEach(() => {
			globalThis.Image = originalImage;
			HTMLCanvasElement.prototype.getContext = originalGetContext;
			HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
			vi.restoreAllMocks();
		});

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

		it('이미지 크기와 용량이 모두 기준 이내일 경우 캔버스 렌더링 없이 원본을 반환한다', async () => {
			class SmallImage {
				public onload: (() => void) | null = null;
				public width = 800;
				public height = 600;
				public naturalWidth = 800;
				public naturalHeight = 600;
				private _src = '';

				set src(val: string) {
					this._src = val;
					queueMicrotask(() => this.onload?.());
				}
				get src() {
					return this._src;
				}
			}
			globalThis.Image = SmallImage as unknown as typeof Image;

			const getContextSpy = vi.fn();
			HTMLCanvasElement.prototype.getContext = getContextSpy as unknown as typeof HTMLCanvasElement.prototype.getContext;

			const smallDataUrl = 'data:image/png;base64,smallImageData';
			const res = await resizeImageDataUrl(smallDataUrl, 1568, 1024 * 1024);

			expect(res).toBe(smallDataUrl);
			expect(getContextSpy).not.toHaveBeenCalled();
		});

		it('이미지 긴 변이 maxEdge를 초과할 경우 종횡비를 맞춰 축소 렌더링한다', async () => {
			class LargeImage {
				public onload: (() => void) | null = null;
				public width = 3136;
				public height = 1568;
				public naturalWidth = 3136;
				public naturalHeight = 1568;
				private _src = '';

				set src(val: string) {
					this._src = val;
					queueMicrotask(() => this.onload?.());
				}
				get src() {
					return this._src;
				}
			}
			globalThis.Image = LargeImage as unknown as typeof Image;

			const drawImageSpy = vi.fn();
			HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
				drawImage: drawImageSpy,
			})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

			HTMLCanvasElement.prototype.toDataURL = vi.fn((format: string) => {
				return `data:${format};base64,resizedContent`;
			}) as unknown as typeof HTMLCanvasElement.prototype.toDataURL;

			const largeDataUrl = 'data:image/png;base64,largeImageData';
			const res = await resizeImageDataUrl(largeDataUrl, 1568, 10 * 1024 * 1024);

			expect(drawImageSpy).toHaveBeenCalledWith(expect.any(Object), 0, 0, 1568, 784);
			expect(res).toBe('data:image/png;base64,resizedContent');
		});

		it('리사이즈된 PNG 크기가 maxSizeBytes를 초과할 경우 JPEG 0.85 품질로 재압축한다', async () => {
			class HugeImage {
				public onload: (() => void) | null = null;
				public width = 4000;
				public height = 4000;
				public naturalWidth = 4000;
				public naturalHeight = 4000;
				private _src = '';

				set src(val: string) {
					this._src = val;
					queueMicrotask(() => this.onload?.());
				}
				get src() {
					return this._src;
				}
			}
			globalThis.Image = HugeImage as unknown as typeof Image;

			HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
				drawImage: vi.fn(),
			})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

			const toDataURLSpy = vi.fn((format: string, quality?: number) => {
				if (format === 'image/png') {
					// 50자 길이의 큰 문자열
					return 'data:image/png;base64,' + 'A'.repeat(100);
				}
				return `data:image/jpeg;base64,compressedJpeg_quality_${quality}`;
			});
			HTMLCanvasElement.prototype.toDataURL = toDataURLSpy as unknown as typeof HTMLCanvasElement.prototype.toDataURL;

			const hugeDataUrl = 'data:image/png;base64,' + 'A'.repeat(50);
			// maxSizeBytes를 60으로 설정하여 PNG(122자)가 기준을 초과하도록 함
			const res = await resizeImageDataUrl(hugeDataUrl, 1568, 60);

			expect(toDataURLSpy).toHaveBeenCalledWith('image/png');
			expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.85);
			expect(res).toBe('data:image/jpeg;base64,compressedJpeg_quality_0.85');
		});

		it('canvas 2D 컨텍스트 획득 실패 시 안전하게 원본 data URL을 반환한다', async () => {
			class LargeImage {
				public onload: (() => void) | null = null;
				public width = 2000;
				public height = 2000;
				public naturalWidth = 2000;
				public naturalHeight = 2000;
				private _src = '';

				set src(val: string) {
					this._src = val;
					queueMicrotask(() => this.onload?.());
				}
				get src() {
					return this._src;
				}
			}
			globalThis.Image = LargeImage as unknown as typeof Image;

			HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;

			const dataUrl = 'data:image/png;base64,largeImage';
			const res = await resizeImageDataUrl(dataUrl, 1000);

			expect(res).toBe(dataUrl);
		});
	});
});
