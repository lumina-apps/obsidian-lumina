/**
 * multipartBuilder.ts
 *
 * Obsidian의 requestUrl은 브라우저 FormData 직렬화를 직접 지원하지 않으므로,
 * 데스크톱과 모바일 모두에서 CORS 없이 안전하게 파일을 전송하기 위한
 * 순수 Uint8Array 기반 multipart/form-data 본문 빌더입니다.
 */

/** 멀티파트 파일 파트 정의 */
export interface MultipartFilePart {
	/** 폼 필드명 (예: 'file') */
	fieldName: string;
	/** 전송 파일명 */
	filename: string;
	/** 파일 MIME 타입 */
	mimeType: string;
	/** 바이너리 바이트 배열 */
	bytes: Uint8Array;
}

/** 헤더 인젝션 방지를 위한 따옴표/개행 제거 */
function sanitizeHeaderParam(value: string): string {
	return value.replace(/[\r\n"]/g, '_');
}

/**
 * 텍스트 필드들과 바이너리 파일 1개를 RFC 7578 호환 multipart/form-data ArrayBuffer로 직렬화합니다.
 */
export function buildMultipartFormData(
	fields: Record<string, string>,
	file: MultipartFilePart,
): { contentType: string; body: ArrayBuffer } {
	const boundary = `----LuminaVoiceBoundary${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
	const encoder = new TextEncoder();
	const parts: Uint8Array[] = [];

	for (const [key, val] of Object.entries(fields)) {
		if (val === undefined || val === null) continue;
		const safeKey = sanitizeHeaderParam(key);
		const header =
			`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="${safeKey}"\r\n\r\n` +
			`${val}\r\n`;
		parts.push(encoder.encode(header));
	}

	const safeField = sanitizeHeaderParam(file.fieldName);
	const safeFilename = sanitizeHeaderParam(file.filename || 'audio.webm');
	const safeMime = (file.mimeType || 'application/octet-stream').replace(/[\r\n]/g, '');

	const fileHeader =
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="${safeField}"; filename="${safeFilename}"\r\n` +
		`Content-Type: ${safeMime}\r\n\r\n`;

	parts.push(encoder.encode(fileHeader));
	parts.push(file.bytes);
	parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

	let totalLength = 0;
	for (const p of parts) {
		totalLength += p.byteLength;
	}

	const merged = new Uint8Array(totalLength);
	let offset = 0;
	for (const p of parts) {
		merged.set(p, offset);
		offset += p.byteLength;
	}

	return {
		contentType: `multipart/form-data; boundary=${boundary}`,
		body: merged.buffer,
	};
}
