/**
 * E2E 테스트 전용 로컬 OpenAI 호환 Mock LLM/STT 서버.
 * - 외부 API 키나 네트워크 과금 없이 스트리밍(SSE), 비스트리밍(Chat Completions),
 *   멀티파트 음성 전사(/v1/audio/transcriptions)를 결정론적으로 에뮬레이션합니다.
 */

import http from 'node:http';

const AVAILABLE_MODELS = [
	'mock-model-a',
	'mock-model-b',
	'mock-model-c',
	'mock-model-d',
	'mock-slow',
	'mock-error',
];

function setCorsHeaders(res) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', '*');
}

function readRequestBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on('data', (chunk) => chunks.push(chunk));
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

function extractTextContent(content) {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
			.filter(Boolean)
			.join('\n');
	}
	return '';
}

/**
 * 프롬프트 패턴에 따라 결정론적인 응답 본문을 생성합니다.
 */
function buildDeterministicReply(model, messages) {
	const systemText = (messages || [])
		.filter((m) => m.role === 'system')
		.map((m) => extractTextContent(m.content))
		.join('\n');
	const userMessages = (messages || []).filter((m) => m.role === 'user');
	const lastUserText = userMessages.length > 0
		? extractTextContent(userMessages[userMessages.length - 1].content)
		: '';
	const combinedText = `${systemText}\n${lastUserText}`;

	// 1. Batch Studio: 프론트매터 생성 레시피
	if (combinedText.includes('return 1 to 3 relevant topic tags and a 1-sentence summary')) {
		return JSON.stringify({
			tags: ['e2e-alpha', 'knowledge-graph'],
			description: 'Automated E2E generated summary description.',
		});
	}

	// 2. Batch Studio: 요약 콜아웃 생성 레시피
	if (combinedText.includes('Summarize the following markdown note in 2 to 3 concise sentences')) {
		return 'This is a concise E2E generated summary callout for the note.';
	}

	// 3. Batch Studio: AI 폴더 자동 분류(ai-route)
	if (combinedText.includes('Classify the following markdown note into the SINGLE most appropriate folder')) {
		const listMatch = lastUserText.match(/Allowed Candidate Folders:\s*([\s\S]*?)\n\nNote Title:/);
		let firstCandidate = 'NONE';
		if (listMatch && listMatch[1]) {
			const candidates = listMatch[1]
				.split('\n')
				.map((line) => line.replace(/^\s*-\s*/, '').trim())
				.filter(Boolean);
			if (candidates.length > 0) {
				firstCandidate = candidates[0];
			}
		}
		return JSON.stringify({
			folder: firstCandidate,
			reason: 'Matched by E2E AI router',
		});
	}

	// 4. Orphan Notes: AI 문맥 링크 삽입 제안
	if (combinedText.includes('Insert the EXACT wikilink')) {
		const linkMatch = combinedText.match(/Insert the EXACT wikilink "(\[\[[^\]]+\]\])"/);
		const wikilink = linkMatch ? linkMatch[1] : '[[Target]]';
		const hostMatch = lastUserText.match(/Host Note Content:\s*([\s\S]*)$/);
		const hostLines = hostMatch
			? hostMatch[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
			: [];
		const anchorLine = hostLines[0] || '';
		const replacementLine = anchorLine
			? `${anchorLine} Related: ${wikilink}.`
			: `Related: ${wikilink}.`;
		return JSON.stringify({
			anchorLine,
			replacementLine,
			reason: 'Contextual link added by E2E AI',
		});
	}

	// 5. Batch Studio: Custom Prompt 레시피
	if (combinedText.includes('E2E_CUSTOM_RECIPE')) {
		const snippet = lastUserText.replace(/\s+/g, ' ').trim().slice(0, 80);
		return `Custom E2E Output: ${snippet}`;
	}

	// 6. Voice-to-Note: 3종 템플릿 포맷팅
	if (systemText.includes('Output template: Meeting / Lecture Notes.')) {
		return [
			'> [!summary] Summary',
			'> - E2E meeting summary point',
			'',
			'## Meeting Minutes',
			'- Discussed VoiceTargetLink architecture',
			'',
			'## Action Items',
			'- [ ] Verify E2E review bar',
		].join('\n');
	}
	if (systemText.includes('Output template: Clean Smart Note.')) {
		return [
			'> [!summary] Summary',
			'> - E2E clean note summary',
			'',
			'## Key Points',
			'- Discussed VoiceTargetLink in clean format.',
		].join('\n');
	}
	if (systemText.includes('Output template: Verbatim Cleanup.')) {
		return 'Hello from E2E voice recording discussing VoiceTargetLink.';
	}

	// 7. Split Chat / 일반 채팅 자동 제목 생성 (비스트리밍 제목 프롬프트)
	if (
		/generate a short|concise title|title for this conversation|대화 제목/i.test(combinedText) &&
		lastUserText.length < 1500
	) {
		return 'E2E Comparison Title';
	}

	// 8. Split Chat 일반 대화 응답 (RAG 컨텍스트 접두/접미가 붙어도 E2E 프롬프트 식별자 보존)
	const e2eTokenMatch = lastUserText.match(/\b(E2E_[A-Z0-9_]+|MOBILE_SPLIT_E2E)\b/);
	const tailMatch = lastUserText.match(/(?:사용자 질문|User (?:Question|Query|Message))\s*:\s*([\s\S]+)$/i);
	const rawPromptPart = e2eTokenMatch ? e2eTokenMatch[1] : tailMatch ? tailMatch[1] : lastUserText;
	const cleanPrompt = rawPromptPart.replace(/\s+/g, ' ').trim().slice(0, 80);
	return `[RESP:${model}] Answer for: ${cleanPrompt}`;
}

/**
 * 멀티파트 폼 데이터에서 텍스트 필드와 파일 메타데이터를 추출합니다.
 */
function parseMultipartSummary(rawBuffer, contentType) {
	const boundaryMatch = (contentType || '').match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
	const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : '';
	const rawText = rawBuffer.toString('latin1');

	const extractField = (fieldName) => {
		const re = new RegExp(`name="${fieldName}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`, 'i');
		const m = rawText.match(re);
		return m ? Buffer.from(m[1], 'latin1').toString('utf8').trim() : '';
	};

	const filenameMatch = rawText.match(/name="file";\s*filename="([^"]*)"/i);
	return {
		boundary,
		model: extractField('model'),
		responseFormat: extractField('response_format'),
		language: extractField('language'),
		prompt: extractField('prompt'),
		filename: filenameMatch ? filenameMatch[1] : '',
		byteLength: rawBuffer.length,
	};
}

/**
 * 로컬 OpenAI-compatible Mock HTTP 서버를 시작합니다.
 */
export async function startMockOpenAiServer() {
	const chatRequests = [];
	const sttRequests = [];
	const failOnceModels = new Set();
	let batchDelayMs = 0;

	const server = http.createServer(async (req, res) => {
		setCorsHeaders(res);

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
		const pathname = reqUrl.pathname;

		// 1. 모델 목록 조회
		if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				object: 'list',
				data: AVAILABLE_MODELS.map((id) => ({ id, object: 'model', owned_by: 'e2e-mock' })),
			}));
			return;
		}

		// 2. Chat Completions (스트리밍 SSE & 비스트리밍 JSON)
		if (req.method === 'POST' && (pathname === '/v1/chat/completions' || pathname === '/chat/completions')) {
			let bodyJson = {};
			try {
				const raw = await readRequestBody(req);
				bodyJson = JSON.parse(raw.toString('utf8') || '{}');
			} catch {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
				return;
			}

			const model = typeof bodyJson.model === 'string' ? bodyJson.model : 'mock-model-a';
			const messages = Array.isArray(bodyJson.messages) ? bodyJson.messages : [];
			const stream = Boolean(bodyJson.stream);
			let responseClosed = false;
			res.on('close', () => {
				responseClosed = true;
			});

			chatRequests.push({
				model,
				messages,
				temperature: bodyJson.temperature,
				stream,
				timestamp: Date.now(),
			});

			// 단발성 실패 주입 확인
			if (failOnceModels.has(model)) {
				failOnceModels.delete(model);
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					error: { message: `Injected 500 error for ${model}`, type: 'mock_error' },
				}));
				return;
			}

			// slow 모델 스트리밍 (개별 슬롯 중단 테스트용)
			if (model === 'mock-slow' && stream) {
				res.writeHead(200, {
					'Content-Type': 'text/event-stream; charset=utf-8',
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive',
				});
				let count = 0;
				const sendTick = () => {
					if (responseClosed || res.writableEnded) return;
					count++;
					const chunk = {
						id: 'chatcmpl-mock-slow',
						object: 'chat.completion.chunk',
						model,
						choices: [{ index: 0, delta: { content: `slow-${count} ` }, finish_reason: null }],
					};
					res.write(`data: ${JSON.stringify(chunk)}\n\n`);
					if (count >= 30) {
						clearInterval(timer);
						res.write(`data: ${JSON.stringify({
							id: 'chatcmpl-mock-slow',
							object: 'chat.completion.chunk',
							model,
							choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
							usage: { prompt_tokens: 10, completion_tokens: count, total_tokens: 10 + count },
						})}\n\n`);
						res.write('data: [DONE]\n\n');
						res.end();
					}
				};
				const timer = setInterval(sendTick, 250);
				sendTick();
				res.on('close', () => {
					clearInterval(timer);
				});
				return;
			}

			const replyText = buildDeterministicReply(model, messages);

			if (stream) {
				// model-a는 빠르게, model-b/c/d는 약간의 지연을 두어 fastest 배지가 결정론적으로 나오게 함
				const initialDelay = model === 'mock-model-a' ? 20 : 120;
				await new Promise((r) => setTimeout(r, initialDelay));
				if (responseClosed || res.writableEnded) return;

				res.writeHead(200, {
					'Content-Type': 'text/event-stream; charset=utf-8',
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive',
				});

				const partLen = Math.max(1, Math.ceil(replyText.length / 3));
				const parts = [
					replyText.slice(0, partLen),
					replyText.slice(partLen, partLen * 2),
					replyText.slice(partLen * 2),
				].filter((p) => p.length > 0);

				for (const part of parts) {
					if (responseClosed || res.writableEnded) return;
					res.write(`data: ${JSON.stringify({
						id: `chatcmpl-${model}`,
						object: 'chat.completion.chunk',
						model,
						choices: [{ index: 0, delta: { content: part }, finish_reason: null }],
					})}\n\n`);
					await new Promise((r) => setTimeout(r, 15));
				}

				if (!responseClosed && !res.writableEnded) {
					res.write(`data: ${JSON.stringify({
						id: `chatcmpl-${model}`,
						object: 'chat.completion.chunk',
						model,
						choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
						usage: { prompt_tokens: 24, completion_tokens: 18, total_tokens: 42 },
					})}\n\n`);
					res.write('data: [DONE]\n\n');
					res.end();
				}
				return;
			}

			// 비스트리밍 JSON 응답 (Batch / Voice 포맷팅)
			if (batchDelayMs > 0) {
				await new Promise((r) => setTimeout(r, batchDelayMs));
			}

			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				id: `chatcmpl-${model}`,
				object: 'chat.completion',
				model,
				choices: [{
					index: 0,
					message: { role: 'assistant', content: replyText },
					finish_reason: 'stop',
				}],
				usage: { prompt_tokens: 24, completion_tokens: 18, total_tokens: 42 },
			}));
			return;
		}

		// 3. 음성 전사 (OpenAI Audio Transcriptions API)
		if (req.method === 'POST' && (pathname === '/v1/audio/transcriptions' || pathname === '/audio/transcriptions')) {
			const rawBuffer = await readRequestBody(req);
			const summary = parseMultipartSummary(rawBuffer, req.headers['content-type'] || '');
			sttRequests.push({
				...summary,
				timestamp: Date.now(),
			});

			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				text: 'Hello from E2E voice recording discussing VoiceTargetLink.',
				duration: 4.2,
				segments: [
					{ start: 0.0, end: 2.1, text: 'Hello from E2E voice recording' },
					{ start: 2.1, end: 4.2, text: 'discussing VoiceTargetLink.' },
				],
			}));
			return;
		}

		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: { message: `Not found: ${pathname}` } }));
	});

	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});

	const addr = server.address();
	const port = typeof addr === 'object' && addr ? addr.port : 0;
	const url = `http://127.0.0.1:${port}/v1`;

	return {
		url,
		port,
		availableModels: [...AVAILABLE_MODELS],
		getChatRequests: () => chatRequests.map((r) => ({ ...r })),
		getSttRequests: () => sttRequests.map((r) => ({ ...r })),
		clearRequests: () => {
			chatRequests.length = 0;
			sttRequests.length = 0;
		},
		setFailOnce: (modelId) => {
			failOnceModels.add(modelId);
		},
		setBatchDelayMs: (ms) => {
			batchDelayMs = Math.max(0, Number(ms) || 0);
		},
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections?.();
			}),
	};
}
