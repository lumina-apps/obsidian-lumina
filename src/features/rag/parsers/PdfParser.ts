import { Platform } from 'obsidian';
import * as pdfjsLib from 'pdfjs-dist';
import { debugLogger } from '../../../shared/debugLogger';
import { normalizeError } from '../../../shared/utils/errorUtils';
import { decompressWorkerCode } from '../../../shared/utils/workerCodec';
import { PDF_WORKER_COMPRESSED_BASE64 } from './pdfWorkerCode';

let cachedPdfWorkerUrl: string | null = null;
let workerInitPromise: Promise<string | null> | null = null;

/** 모바일 플랫폼 여부를 안전하게 확인합니다. (부분 mock 환경 방어) */
function isMobilePlatform(): boolean {
	try {
		return typeof Platform !== 'undefined' && Boolean(Platform?.isMobile);
	} catch {
		return false;
	}
}

/** 워커 비동기 error 이벤트로 인한 실패임을 구분하기 위한 내부 오류 */
class PdfWorkerLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PdfWorkerLoadError';
	}
}

/**
 * 직접 생성한 모듈 Worker가 비동기 'error' 이벤트를 방출할 때
 * loadingTask.promise가 무한 대기하지 않도록 즉시 거부하고 리스너를 정리합니다.
 */
function awaitDocumentWithWorkerGuard(
	loadingTask: pdfjsLib.PDFDocumentLoadingTask,
	rawWorker: Worker,
): Promise<pdfjsLib.PDFDocumentProxy> {
	if (typeof rawWorker.addEventListener !== 'function') {
		return loadingTask.promise;
	}

	return new Promise<pdfjsLib.PDFDocumentProxy>((resolve, reject) => {
		let settled = false;
		const cleanupListener = (): void => {
			if (typeof rawWorker.removeEventListener === 'function') {
				rawWorker.removeEventListener('error', onWorkerError);
			}
		};
		const onWorkerError = (event: Event): void => {
			if (settled) {
				return;
			}
			settled = true;
			cleanupListener();
			const message = event instanceof ErrorEvent && event.message
				? event.message
				: 'PDF 모듈 워커 비동기 로드 오류';
			reject(new PdfWorkerLoadError(message));
		};

		rawWorker.addEventListener('error', onWorkerError);
		loadingTask.promise.then(
			(doc) => {
				if (settled) {
					void doc.cleanup?.().catch(() => undefined);
					return;
				}
				settled = true;
				cleanupListener();
				resolve(doc);
			},
			(err: unknown) => {
				if (settled) {
					return;
				}
				settled = true;
				cleanupListener();
				reject(err instanceof Error ? err : new Error(String(err)));
			},
		);
	});
}

/**
 * 번들에 포함된 압축 PDF.js legacy 워커를 해제하여 동일 출처 Blob URL로 초기화합니다.
 * 외부 CDN(unpkg.com) 접근 없이 오프라인/모바일 WebView에서도 안전하게 동작합니다.
 */
async function ensurePdfWorkerSrc(): Promise<string | null> {
	if (cachedPdfWorkerUrl) {
		return cachedPdfWorkerUrl;
	}
	if (workerInitPromise) {
		return workerInitPromise;
	}

	workerInitPromise = (async () => {
		try {
			if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
				return null;
			}
			const workerCode = await decompressWorkerCode(PDF_WORKER_COMPRESSED_BASE64);
			const blob = new Blob([workerCode], { type: 'text/javascript' });
			cachedPdfWorkerUrl = URL.createObjectURL(blob);
			pdfjsLib.GlobalWorkerOptions.workerSrc = cachedPdfWorkerUrl;
			return cachedPdfWorkerUrl;
		} catch (err) {
			debugLogger.logWarn('rag', `PDF 워커 Blob 초기화 실패: ${normalizeError(err).message}`);
			return null;
		} finally {
			workerInitPromise = null;
		}
	})();

	return workerInitPromise;
}

/** 캐시된 PDF 워커 Blob URL을 해제합니다. (플러그인 언로드 시 호출) */
export function disposePdfWorker(): void {
	if (cachedPdfWorkerUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
		URL.revokeObjectURL(cachedPdfWorkerUrl);
	}
	cachedPdfWorkerUrl = null;
	workerInitPromise = null;
}

export class PdfParser {
	/** PDF ArrayBuffer에서 텍스트를 추출합니다. */
	static async parse(buffer: ArrayBuffer): Promise<string> {
		let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
		let pdf: pdfjsLib.PDFDocumentProxy | null = null;
		let rawWorker: Worker | null = null;
		let pdfWorker: pdfjsLib.PDFWorker | null = null;

		try {
			const workerBlobUrl = await ensurePdfWorkerSrc();
			if (!workerBlobUrl) {
				debugLogger.logWarn('rag', 'PDF 워커 초기화 불가 환경으로 PDF 텍스트 추출을 건너뜁니다.');
				return '';
			}

			// capacitor://localhost 등 null-origin 모바일 WebView에서만 pdf.mjs의
			// _createCDNWrapper(await import("blob:null/..."))를 우회하기 위해 직접 module Worker를 생성하여 주입
			// 데스크탑은 기존 GlobalWorkerOptions.workerSrc 경로를 그대로 유지하여 동작 변경 없음
			if (isMobilePlatform()) {
				const pdfWorkerClass = (pdfjsLib as unknown as {
					PDFWorker?: { create: (params: { port?: Worker }) => pdfjsLib.PDFWorker };
				}).PDFWorker;
				if (typeof Worker === 'function' && typeof pdfWorkerClass?.create === 'function') {
					try {
						rawWorker = new Worker(workerBlobUrl, { type: 'module' });
						pdfWorker = pdfWorkerClass.create({ port: rawWorker });
					} catch (workerErr) {
						debugLogger.logWarn('rag', `직접 PDF 모듈 워커 생성 실패(workerSrc 폴백): ${normalizeError(workerErr).message}`);
						rawWorker?.terminate();
						rawWorker = null;
						pdfWorker = null;
					}
				}
			}

			if (pdfWorker && rawWorker) {
				// 1차 직접 워커 경로에서 ArrayBuffer가 transfer되더라도 폴백에 쓸 수 있도록 복사본 사용
				loadingTask = pdfjsLib.getDocument({
					data: new Uint8Array(buffer.slice(0)),
					useSystemFonts: true,
					worker: pdfWorker,
				});
				try {
					pdf = await awaitDocumentWithWorkerGuard(loadingTask, rawWorker);
				} catch (workerLoadErr) {
					if (!(workerLoadErr instanceof PdfWorkerLoadError)) {
						throw workerLoadErr;
					}
					debugLogger.logWarn('rag', `직접 PDF 모듈 워커 비동기 로드 실패(workerSrc 폴백): ${workerLoadErr.message}`);
					try {
						await loadingTask?.destroy?.();
					} catch {
						// 정리 중 오류 무시
					}
					try {
						pdfWorker?.destroy?.();
					} catch {
						// 정리 중 오류 무시
					}
					try {
						rawWorker?.terminate?.();
					} catch {
						// 정리 중 오류 무시
					}
					loadingTask = null;
					pdfWorker = null;
					rawWorker = null;

					loadingTask = pdfjsLib.getDocument({
						data: new Uint8Array(buffer),
						useSystemFonts: true,
					});
					pdf = await loadingTask.promise;
				}
			} else {
				const data = new Uint8Array(buffer);
				loadingTask = pdfjsLib.getDocument({
					data,
					useSystemFonts: true,
				});
				pdf = await loadingTask.promise;
			}
			let fullText = '';

			for (let i = 1; i <= pdf.numPages; i++) {
				const page = await pdf.getPage(i);
				const content = (await page.getTextContent()) as { items: Array<unknown> };
				const strings = content.items
					.filter((item): item is { str: string } => typeof item === 'object' && item !== null && 'str' in item)
					.map((item: { str: string }) => item.str);
				fullText += strings.join(' ') + '\n\n';
			}

			return fullText;
		} catch (error) {
			debugLogger.logError('rag', normalizeError(error, `PDF 파싱 오류: ${error}`));
			return '';
		} finally {
			try {
				await pdf?.cleanup?.();
			} catch {
				// 정리 중 오류 무시
			}
			try {
				await loadingTask?.destroy?.();
			} catch {
				// 정리 중 오류 무시
			}
			try {
				pdfWorker?.destroy?.();
			} catch {
				// 정리 중 오류 무시
			}
			try {
				rawWorker?.terminate?.();
			} catch {
				// 정리 중 오류 무시
			}
		}
	}
}
