/**
 * 이미지 리사이즈 및 해상도 최적화 유틸리티
 */

export const MAX_ATTACHMENT_FILE_SIZE = 20 * 1024 * 1024; // 20MB
export const DEFAULT_MAX_IMAGE_EDGE = 1568; // Claude / OpenAI 비전 권장 최적 긴 변
export const DEFAULT_MAX_IMAGE_BYTES = 3.5 * 1024 * 1024; // 3.5MB (Anthropic 5MB 제한 안전 마진)

/**
 * 긴 변을 기준으로 종횡비를 유지하며 축소할 너비와 높이를 계산합니다.
 */
export function computeTargetDimensions(
	width: number,
	height: number,
	maxEdge = DEFAULT_MAX_IMAGE_EDGE,
): { width: number; height: number } {
	if (width <= 0 || height <= 0) return { width, height };
	const longest = Math.max(width, height);
	if (longest <= maxEdge) {
		return { width, height };
	}

	const ratio = maxEdge / longest;
	return {
		width: Math.round(width * ratio),
		height: Math.round(height * ratio),
	};
}

/**
 * base64 data URL 이미지를 캔버스를 통해 축소/압축합니다.
 * GIF 파일은 애니메이션 프레임 보존을 위해 리사이즈를 건너뜁니다.
 */
export async function resizeImageDataUrl(
	dataUrl: string,
	maxEdge = DEFAULT_MAX_IMAGE_EDGE,
	maxSizeBytes = DEFAULT_MAX_IMAGE_BYTES,
): Promise<string> {
	if (!dataUrl.startsWith('data:image/')) return dataUrl;
	// GIF는 캔버스 렌더링 시 첫 프레임 정지화상이 되므로 변환 생략
	if (dataUrl.startsWith('data:image/gif')) return dataUrl;

	// Node/테스트 환경이거나 document가 없는 경우 원본 반환
	if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Image === 'undefined') {
		return dataUrl;
	}

	return new Promise((resolve) => {
		let timer: number | null = null;
		const img = new Image();

		const cleanup = () => {
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
			}
		};

		// jsdom이나 가상 환경에서 onload가 발화되지 않을 때를 대비한 안전 타임아웃
		timer = window.setTimeout(() => {
			cleanup();
			resolve(dataUrl);
		}, 200);

		img.onload = () => {
			cleanup();
			const width = img.naturalWidth || img.width;
			const height = img.naturalHeight || img.height;
			const { width: targetW, height: targetH } = computeTargetDimensions(
				width,
				height,
				maxEdge,
			);

			const isDimensionsOver = width > targetW || height > targetH;
			const isSizeOver = dataUrl.length > maxSizeBytes;

			if (!isDimensionsOver && !isSizeOver) {
				resolve(dataUrl);
				return;
			}

			try {
				const canvas = createEl('canvas');
				canvas.width = targetW;
				canvas.height = targetH;
				const ctx = canvas.getContext('2d');
				if (!ctx) {
					resolve(dataUrl);
					return;
				}

				ctx.drawImage(img, 0, 0, targetW, targetH);
				let output = canvas.toDataURL('image/png');
				if (output.length > maxSizeBytes) {
					output = canvas.toDataURL('image/jpeg', 0.85);
				}
				resolve(output);
			} catch {
				resolve(dataUrl);
			}
		};

		img.onerror = () => {
			cleanup();
			resolve(dataUrl);
		};

		img.src = dataUrl;
	});
}
