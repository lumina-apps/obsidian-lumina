console.log("HELLO_WORLD_WORKER");

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

import { env, pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import type { WorkerRequest, WorkerResponse } from '../../../shared/types/rag.types';

// ─── ONNX Runtime Multi-threading Fix ─────────────────────────────────────────
// ONNX Runtime의 multi-threaded WASM(ort-wasm-threaded.min.js)은 내부적으로
// 별도 Web Worker를 생성하는데, Electron 환경의 Web Worker에서는 process 객체가
// null로 존재하여 `process.on` 참조 시 "Cannot read properties of null" 에러 발생.
// numThreads=1로 강제 설정 → single-threaded WASM만 사용 → 서브 워커 미생성.
env.backends.onnx.wasm.numThreads = 1;

// ─── Tokenizer Hotfix ─────────────────────────────────────────────────────────
// ibm-granite 97m-r2 모델의 tokenizer.json 내 merges가 배열의 배열 형식으로 되어 있어
// transformers.js v2의 BPE 토크나이저 초기화 시 (x.split is not a function) 에러가 발생합니다.
// 이를 배열의 문자열 형식("A B")으로 변환해주기 위해 JSON.parse를 가로챕니다.
const originalJSONParse = JSON.parse;
JSON.parse = function(text: string, reviver?: (this: any, key: string, value: any) => any) {
	const parsed = originalJSONParse(text, reviver);
	if (parsed && parsed.model && Array.isArray(parsed.model.merges) && parsed.model.merges.length > 0 && Array.isArray(parsed.model.merges[0])) {
		parsed.model.merges = parsed.model.merges.map((x: string[]) => x.join(' '));
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

async function initModel(modelName: string, cacheDir: string): Promise<void> {
	// 캐시 디렉토리 지정 (Electron 환경에서는 절대 경로 전달 필요)
	env.cacheDir = cacheDir;

	// 원격 모델 허용 (첫 실행 시 자동 다운로드)
	env.allowRemoteModels = true;

	// 환경 설정 (Transformers.js v2.x 기준)
	// blob url 형태의 worker에서는 '/models/' 로컬 fetch가 오류를 발생시키므로 false로 설정
	env.allowLocalModels = false;
	
	// Web Worker 환경에서 ONNX Runtime WASM 파일을 로드하기 위해 경로 명시
	env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';
	
	// ONNX Runtime multi-threading 비활성화
	// - multi-threaded WASM(ort-wasm-threaded.min.js)은 내부적으로 별도 Worker를 생성하는데,
	//   해당 서브 워커에서 process.on 참조 시 null 에러 발생
	// - numThreads=1로 설정하면 single-threaded WASM만 사용 → 서브 워커 생성 안 함
	env.backends.onnx.wasm.numThreads = 1;
	
	// 파이프라인 생성
	const pipelineOptions: any = {
		quantized: false,
		progress_callback: (progress: { status: string; progress?: number }) => {
			send({
				type: 'progress',
				progress: progress.progress != null ? progress.progress / 100 : 0,
				status: progress.status,
			});
		},
	};

	extractor = await pipeline('feature-extraction', modelName, pipelineOptions);

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

// ─── Message Handler ─────────────────────────────────────────────────────────

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
	const msg = event.data;

	switch (msg.type) {
		case 'init':
			await initModel(msg.modelName, msg.cacheDir).catch((err) => {
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

		case 'terminate':
			extractor = null;
			self.close();
			break;
	}
});
