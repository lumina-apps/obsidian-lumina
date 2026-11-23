import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetDocument = vi.fn();
const mockPdfWorkerDestroy = vi.fn();
const mockPdfWorkerCreate = vi.fn((_params?: { port?: Worker }) => ({ destroy: mockPdfWorkerDestroy }));

vi.mock('pdfjs-dist', () => ({
	GlobalWorkerOptions: { workerSrc: '' },
	version: '6.2.108',
	getDocument: (...args: unknown[]) => mockGetDocument(...args),
	PDFWorker: {
		create: (params: { port?: Worker }) => mockPdfWorkerCreate(params),
	},
}));

const mockDecompressWorkerCode = vi.fn(async (_base64: string) => '/* mock legacy worker */');
vi.mock('../../../shared/utils/workerCodec', () => ({
	decompressWorkerCode: (base64: string) => mockDecompressWorkerCode(base64),
}));

import { Platform } from 'obsidian';
import * as pdfjsLib from 'pdfjs-dist';
import { PdfParser, disposePdfWorker } from './PdfParser';

describe('PdfParser', () => {
	const origCreateObjectURL = URL.createObjectURL;
	const origRevokeObjectURL = URL.revokeObjectURL;
	const origWorker = globalThis.Worker;
	const origIsMobile = Platform.isMobile;

	beforeEach(() => {
		disposePdfWorker();
		(Platform as { isMobile: boolean }).isMobile = false;
		pdfjsLib.GlobalWorkerOptions.workerSrc = '';
		mockGetDocument.mockReset();
		mockPdfWorkerCreate.mockClear();
		mockPdfWorkerDestroy.mockClear();
		mockDecompressWorkerCode.mockReset();
		mockDecompressWorkerCode.mockResolvedValue('/* mock legacy worker */');
		URL.createObjectURL = vi.fn(() => 'blob:app://obsidian.md/mock-pdf-worker');
		URL.revokeObjectURL = vi.fn();
	});

	afterEach(() => {
		disposePdfWorker();
		(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		URL.createObjectURL = origCreateObjectURL;
		URL.revokeObjectURL = origRevokeObjectURL;
		globalThis.Worker = origWorker;
		vi.restoreAllMocks();
	});

	it('외부 CDN 대신 번들 압축 워커 Blob URL을 초기화하고 텍스트 추출 후 리소스를 정리한다', async () => {
		const mockPdfCleanup = vi.fn().mockResolvedValue(undefined);
		const mockTaskDestroy = vi.fn().mockResolvedValue(undefined);
		const mockPdf = {
			numPages: 2,
			getPage: vi.fn(async (pageNum: number) => ({
				getTextContent: async () => ({
					items: [{ str: `Page ${pageNum}` }, { str: 'Hello' }],
				}),
			})),
			cleanup: mockPdfCleanup,
		};
		mockGetDocument.mockReturnValue({
			promise: Promise.resolve(mockPdf),
			destroy: mockTaskDestroy,
		});

		const text = await PdfParser.parse(new Uint8Array([1, 2, 3]).buffer);

		expect(pdfjsLib.GlobalWorkerOptions.workerSrc).toMatch(/^blob:/);
		expect(pdfjsLib.GlobalWorkerOptions.workerSrc).not.toContain('unpkg.com');
		expect(text).toContain('Page 1 Hello');
		expect(text).toContain('Page 2 Hello');
		expect(mockPdfCleanup).toHaveBeenCalledTimes(1);
		expect(mockTaskDestroy).toHaveBeenCalledTimes(1);
	});

	it('잘못된 PDF 데이터 오류 시 예외를 전파하지 않고 빈 문자열을 반환한다', async () => {
		mockGetDocument.mockReturnValue({
			promise: Promise.reject(new Error('Invalid PDF structure')),
			destroy: vi.fn(),
		});

		const text = await PdfParser.parse(new Uint8Array([0, 0]).buffer);
		expect(text).toBe('');
	});

	it('워커 압축 해제 실패 시 getDocument를 호출하지 않고 빈 문자열을 반환한다', async () => {
		mockDecompressWorkerCode.mockRejectedValueOnce(new Error('DecompressionStream unavailable'));
		const text = await PdfParser.parse(new Uint8Array([1, 2, 3]).buffer);
		expect(text).toBe('');
		expect(mockGetDocument).not.toHaveBeenCalled();
	});

	it('모바일 환경에서 Worker 지원 시 직접 모듈 Worker와 PDFWorker 포트를 주입하고 종료 시 정리한다', async () => {
		(Platform as { isMobile: boolean }).isMobile = true;
		const terminateSpy = vi.fn();
		const workerCtorSpy = vi.fn();
		const addEventListenerSpy = vi.fn();
		const removeEventListenerSpy = vi.fn();
		class MockWebWorker {
			terminate = terminateSpy;
			addEventListener = addEventListenerSpy;
			removeEventListener = removeEventListenerSpy;
			constructor(url: string, opts?: WorkerOptions) {
				workerCtorSpy(url, opts);
			}
		}
		globalThis.Worker = MockWebWorker as unknown as typeof Worker;

		const mockPdf = {
			numPages: 1,
			getPage: vi.fn(async () => ({
				getTextContent: async () => ({ items: [{ str: 'Direct Worker PDF' }] }),
			})),
			cleanup: vi.fn().mockResolvedValue(undefined),
		};
		mockGetDocument.mockReturnValue({
			promise: Promise.resolve(mockPdf),
			destroy: vi.fn().mockResolvedValue(undefined),
		});

		const text = await PdfParser.parse(new Uint8Array([1, 2, 3]).buffer);
		expect(workerCtorSpy).toHaveBeenCalledWith('blob:app://obsidian.md/mock-pdf-worker', { type: 'module' });
		expect(mockPdfWorkerCreate).toHaveBeenCalledWith({ port: expect.any(MockWebWorker) });
		expect(mockGetDocument).toHaveBeenCalledWith(expect.objectContaining({ worker: expect.any(Object) }));
		expect(addEventListenerSpy).toHaveBeenCalledWith('error', expect.any(Function));
		expect(removeEventListenerSpy).toHaveBeenCalledWith('error', expect.any(Function));
		expect(mockPdfWorkerDestroy).toHaveBeenCalledTimes(1);
		expect(terminateSpy).toHaveBeenCalledTimes(1);
		expect(text).toContain('Direct Worker PDF');
	});

	it('데스크탑 환경에서는 직접 Worker/PDFWorker를 생성하지 않고 기본 workerSrc 경로로 getDocument를 호출한다', async () => {
		(Platform as { isMobile: boolean }).isMobile = false;
		const workerCtorSpy = vi.fn();
		class MockWebWorker {
			terminate = vi.fn();
			constructor(url: string, opts?: WorkerOptions) {
				workerCtorSpy(url, opts);
			}
		}
		globalThis.Worker = MockWebWorker as unknown as typeof Worker;

		const mockPdf = {
			numPages: 1,
			getPage: vi.fn(async () => ({
				getTextContent: async () => ({ items: [{ str: 'Desktop WorkerSrc PDF' }] }),
			})),
			cleanup: vi.fn().mockResolvedValue(undefined),
		};
		mockGetDocument.mockReturnValue({
			promise: Promise.resolve(mockPdf),
			destroy: vi.fn().mockResolvedValue(undefined),
		});

		const text = await PdfParser.parse(new Uint8Array([4, 5, 6]).buffer);
		expect(workerCtorSpy).not.toHaveBeenCalled();
		expect(mockPdfWorkerCreate).not.toHaveBeenCalled();
		expect(mockGetDocument).toHaveBeenCalledTimes(1);
		const docInit = mockGetDocument.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
		expect(docInit).toBeDefined();
		expect(docInit?.useSystemFonts).toBe(true);
		expect(docInit?.data).toBeInstanceOf(Uint8Array);
		expect(docInit).not.toHaveProperty('worker');
		expect(text).toContain('Desktop WorkerSrc PDF');
	});

	it('모바일 환경에서 직접 모듈 Worker가 비동기 error 이벤트를 방출하면 즉시 정리 후 기본 workerSrc 경로로 1회 폴백한다', async () => {
		(Platform as { isMobile: boolean }).isMobile = true;
		const terminateSpy = vi.fn();
		const removeEventListenerSpy = vi.fn();
		class MockFailingWorker {
			terminate = terminateSpy;
			removeEventListener = removeEventListenerSpy;
			addEventListener(type: string, listener: EventListener): void {
				if (type === 'error') {
					queueMicrotask(() => {
						listener(new Event('error'));
					});
				}
			}
		}
		globalThis.Worker = MockFailingWorker as unknown as typeof Worker;

		const firstTaskDestroy = vi.fn().mockResolvedValue(undefined);
		const fallbackTaskDestroy = vi.fn().mockResolvedValue(undefined);
		const fallbackPdf = {
			numPages: 1,
			getPage: vi.fn(async () => ({
				getTextContent: async () => ({ items: [{ str: 'Fallback WorkerSrc PDF' }] }),
			})),
			cleanup: vi.fn().mockResolvedValue(undefined),
		};

		mockGetDocument
			.mockReturnValueOnce({
				// error 이벤트가 없으면 무한 대기하는 프라미스 시뮬레이션
				promise: new Promise(() => undefined),
				destroy: firstTaskDestroy,
			})
			.mockReturnValueOnce({
				promise: Promise.resolve(fallbackPdf),
				destroy: fallbackTaskDestroy,
			});

		const text = await PdfParser.parse(new Uint8Array([7, 8, 9]).buffer);
		expect(mockGetDocument).toHaveBeenCalledTimes(2);
		const firstCallArgs = mockGetDocument.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
		const fallbackCallArgs = mockGetDocument.mock.calls[1]?.[0] as Record<string, unknown> | undefined;
		expect(firstCallArgs).toHaveProperty('worker');
		expect(fallbackCallArgs).not.toHaveProperty('worker');
		expect(fallbackCallArgs?.useSystemFonts).toBe(true);
		expect(Array.from(fallbackCallArgs?.data as Uint8Array)).toEqual([7, 8, 9]);
		expect(removeEventListenerSpy).toHaveBeenCalledWith('error', expect.any(Function));
		expect(firstTaskDestroy).toHaveBeenCalledTimes(1);
		expect(mockPdfWorkerDestroy).toHaveBeenCalledTimes(1);
		expect(terminateSpy).toHaveBeenCalledTimes(1);
		expect(fallbackTaskDestroy).toHaveBeenCalledTimes(1);
		expect(text).toContain('Fallback WorkerSrc PDF');
	});
});
