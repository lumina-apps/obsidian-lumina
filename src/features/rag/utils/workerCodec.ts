/**
 * Deflate 압축된 Base64 워커 소스코드를 브라우저 네이티브 API로 압축 해제합니다.
 */
export async function decompressWorkerCode(base64: string): Promise<string> {
	const binString = atob(base64);
	const len = binString.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binString.charCodeAt(i);
	}

	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});

	const decompressedStream = stream.pipeThrough(new DecompressionStream('deflate'));
	const response = new Response(decompressedStream);
	return response.text();
}