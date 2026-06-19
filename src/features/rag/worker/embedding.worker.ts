/**
 * embedding.worker.ts
 *
 * ESM 포맷으로 별도 번들됩니다 (esbuild 이중 빌드).
 * - import.meta.url 보존 → @xenova/transformers ONNX WASM 로드 정상 동작
 * - 메인 스레드에서 PostMessage로 통신
 *
 * ⚠️ 이 파일에서는 Obsidian API, Node.js fs 등 절대 사용 금지.
 *    순수 Web Worker + transformers.js 만 사용.
 */

import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { WorkerRequest, WorkerResponse } from '../../../shared/types/rag.types';
import { PdfParser } from '../parsers/PdfParser';
import { DocxParser } from '../parsers/DocxParser';
import { XlsxParser } from '../parsers/XlsxParser';

interface EnvWasmConfig {
	numThreads?: number;
	simd?: boolean;
	proxy?: boolean;
	wasmPaths?: string;
}
interface BackendsOnnxConfig {
	wasm?: EnvWasmConfig;
	executionProviders?: string[];
}
interface HuggingFaceEnv {
	wasm?: EnvWasmConfig;
	backends?: {
		onnx?: BackendsOnnxConfig;
	};
}
const customEnv = env as unknown as HuggingFaceEnv;

// ─── ONNX Runtime WASM 설정 ───────────────────────────────────────────────────────────────
//
// [SIMD] Obsidian(Electron) 환경에서 SIMD WASM은 정상 동작합니다.
//   simd=true 시 ONNX는 자동으로 `ort-wasm-simd-threaded.jsep.wasm`을 선택하며,
//   SIMD 명령어를 활용해 임베딩 속도가 크게 빨라집니다.
//
// [Multi-threading] SharedArrayBuffer 가용 여부를 런타임에서 체크합니다.
//   Obsidian 1.x는 COOP/COEP 헤더를 설정하므로 SharedArrayBuffer가 지원됩니다.
//   지원되지 않는 환경에서는 numThreads=1로 자동 폴백합니다.
//
// [proxy=false] Blob URL Worker는 proxy가 아니므로 false로 고정합니다.

// 다중 Worker 풀 구조에서는 각 Worker가 numThreads=1로 동작하고,
// Worker 풀이 병렬 처리를 담당합니다.
// SharedArrayBuffer가 없는 환경에서도 싱글스레드 WASM은 정상 동작합니다.
const numThreads = 1;

// [proxy=false] Blob URL Worker는 proxy가 아니므로 false로 고정합니다.
// 주의: transformers.js v3에서 proxy=false인 경우 ONNX 런타임이 Worker 내에서 직접
// WASM 파일을 로드합니다. import.meta.url이 "app://obsidian.md/"로 치환되어 있으므로
// wasmPaths를 CDN으로 명시 지정하지 않으면 WASM 파일을 찾을 수 없어 "Failed to fetch" 에러가 발생합니다.
// transformers.js의 backends/onnx.js 모듈은 ONNX_ENV.wasm.wasmPaths가 없을 때
// 자동으로 CDN URL을 설정하므로 여기서는 wasmPaths를 설정하지 않습니다.
// (wasmPaths 설정은 initModel()에서 env.wasm에 전달됩니다)

const wasmConfig: EnvWasmConfig = {
	numThreads,
	simd: true,
	proxy: false,
};

customEnv.wasm = wasmConfig;

// ─── Tokenizer Hotfix ─────────────────────────────────────────────────────────
// ibm-granite 97m-r2 모델의 tokenizer.json 내 merges가 배열의 배열 형식으로 되어 있어
// transformers.js v2의 BPE 토크나이저 초기화 시 (x.split is not a function) 에러가 발생합니다.
// 이를 배열의 문자열 형식("A B")으로 변환해주기 위해 JSON.parse를 가로챕니다.
interface TokenizerJson {
	model?: {
		merges?: unknown;
	};
}

const originalJSONParse = JSON.parse;
JSON.parse = function(text: string, reviver?: Parameters<typeof originalJSONParse>[1]): unknown {
	const parsed = originalJSONParse(text, reviver) as TokenizerJson | null;
	if (parsed && parsed.model && typeof parsed.model === 'object') {
		const model = parsed.model;
		const merges = model.merges;
		if (Array.isArray(merges) && merges.length > 0) {
			const first: unknown = merges[0];
			if (Array.isArray(first)) {
				model.merges = (merges as unknown[][]).map((x) => {
					if (Array.isArray(x)) {
						return x.join(' ');
					}
					return '';
				});
			}
		}
	}
	return parsed;
};

// ─── State ────────────────────────────────────────────────────────────────────

let extractor: FeatureExtractionPipeline | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(msg: WorkerResponse): void {
	self.postMessage(msg);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function initModel(modelName: string, cacheDir: string, pluginDir?: string): Promise<void> {
	// 캐시 디렉토리 지정 (Electron 환경에서는 절대 경로 전달 필요)
	env.cacheDir = cacheDir;

	// 원격 모델 허용 (첫 실행 시 자동 다운로드)
	env.allowRemoteModels = true;

	// 환경 설정
	// blob url 형태의 worker에서는 '/models/' 로컬 fetch가 오류를 발생시키므로 false로 설정
	env.allowLocalModels = false;
	
	// transformers.js v3는 외부 WASM 파일을 동적으로 로드해야 합니다.
	// Blob URL Worker에서는 import.meta.url이 "app://obsidian.md/"로 치환되어(esbuild post-process),
	// app:// 프로토콜로 fetch 시도 시 CORS/Origin 이슈로 실패합니다.
	// 
	// transformers.js의 backends/onnx.js 모듈은 ONNX_ENV.wasm.wasmPaths가 없으면
	// 자동으로 CDN URL(https://cdn.jsdelivr.net/npm/@huggingface/transformers@${version}/dist/)을
	// 설정합니다. 따라서 env.wasm.wasmPaths를 명시적으로 설정하여 ONNX 런타임이
	// Blob URL Worker에서 WASM 파일을 정상적으로 로드할 수 있도록 합니다.
	// (CDN .mjs 내부의 Node.js import('worker_threads')는 esbuild의 process 폴리필로 무력화됩니다.)
	const WASM_CDN_BASE = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/`;
	
	// env.wasm.wasmPaths를 설정하면 transformers.js가 이 값을 ONNX 런타임에 전달합니다.
	customEnv.wasm!.wasmPaths = WASM_CDN_BASE;
	
	console.log(`[EmbeddingWorker] WASM paths set to CDN: ${WASM_CDN_BASE}`);
	
	// 파이프라인 생성
	// transformers.js v3에서는 dtype으로 모델 파일을 선택합니다.
	// 이 모델은 quantized 버전(model_quantized.onnx)이 존재하지 않으므로 fp32로 지정합니다.
	const fileProgressMap = new Map<string, number>();
	let maxOverallPct = 0;

	interface ProgressInfo {
		status: string;
		file?: string;
		progress?: number;
	}

	const pipelineOptions = {
		dtype: 'fp32' as const,
		progress_callback: (info: ProgressInfo) => {
			if (info.status === 'ready') return;

			if (info.file) {
				if (info.status === 'initiate') {
					fileProgressMap.set(info.file, 0);
				} else if (info.status === 'progress') {
					fileProgressMap.set(info.file, info.progress ?? 0);
				} else if (info.status === 'done' || info.status === 'download') {
					fileProgressMap.set(info.file, 100);
				}
			}

			if (fileProgressMap.size > 0) {
				let total = 0;
				for (const pct of fileProgressMap.values()) {
					total += pct;
				}
				let overallPct = total / fileProgressMap.size;
				if (overallPct > maxOverallPct) {
					maxOverallPct = overallPct;
				}

				send({
					type: 'progress',
					progress: maxOverallPct / 100,
					status: info.status === 'progress' ? 'downloading' : info.status,
				});
			} else {
				send({
					type: 'progress',
					progress: info.progress != null ? info.progress / 100 : 0,
					status: info.status === 'progress' ? 'downloading' : info.status,
				});
			}
		},
	};

	const pipe = await pipeline('feature-extraction', modelName, pipelineOptions);
	extractor = pipe;

	send({ type: 'ready' });
}

// ─── Embed ────────────────────────────────────────────────────────────────────

async function embedTexts(requestId: string, texts: string[]): Promise<void> {
	if (!extractor) {
		send({ type: 'error', requestId, message: 'Model is not initialized. Send init message first.' });
		return;
	}

	try {
		// 배치 임베딩 처리
		const output = await extractor(texts, {
			pooling: 'mean',
			normalize: true,
		});

		// Tensor → number[][] 변환
		const embeddings: number[][] = [];
		const dims = output.dims; // [batchSize, hiddenSize]

		for (let i = 0; i < dims[0]; i++) {
			const vec: number[] = [];
			for (let j = 0; j < dims[1]; j++) {
				vec.push(output.data[i * dims[1] + j] as number);
			}
			embeddings.push(vec);
		}

		send({ type: 'result', requestId, embeddings });
	} catch (err) {
		send({
			type: 'error',
			requestId,
			message: err instanceof Error ? err.message : String(err),
		});
	}
}

// ─── Parse ────────────────────────────────────────────────────────────────────

async function parseDocument(requestId: string, buffer: ArrayBuffer, ext: string): Promise<void> {
	try {
		let text = '';
		if (ext === 'pdf') {
			text = await PdfParser.parse(buffer);
		} else if (ext === 'docx') {
			text = await DocxParser.parse(buffer);
		} else if (ext === 'xlsx' || ext === 'xls') {
			text = await XlsxParser.parse(buffer);
		}
		send({ type: 'parseResult', requestId, text });
	} catch (err) {
		send({
			type: 'error',
			requestId,
			message: err instanceof Error ? err.message : String(err),
		});
	}
}

// ─── Message Handler ─────────────────────────────────────────────────────────

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
	void (async () => {
		const msg = event.data;

		switch (msg.type) {
			case 'init':
				await initModel(msg.modelName, msg.cacheDir, msg.pluginDir).catch((err) => {
					send({
						type: 'error',
						requestId: 'init',
						message: `Model load failed: ${err instanceof Error ? err.message : String(err)}`,
					});
				});
				break;

			case 'embed':
				await embedTexts(msg.requestId, msg.texts);
				break;

			case 'parse':
				await parseDocument(msg.requestId, msg.buffer, msg.ext);
				break;

			case 'terminate':
				extractor = null;
				self.close();
				break;
		}
	})();
});
