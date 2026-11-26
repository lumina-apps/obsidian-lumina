/**
 * 로컬 OpenAI-compatible Mock 서버 단위 테스트 (node:test).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAiServer } from './mock-openai-server.mjs';

function parseSseContent(rawSse) {
	let out = '';
	for (const line of rawSse.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('data:')) continue;
		const payload = trimmed.slice(5).trim();
		if (payload === '[DONE]') continue;
		try {
			const obj = JSON.parse(payload);
			const delta = obj?.choices?.[0]?.delta?.content;
			if (typeof delta === 'string') out += delta;
		} catch {}
	}
	return out;
}

test('Mock OpenAI server handles models, SSE streaming, failOnce, recipes, slow abort, and STT multipart', async (t) => {
	const mock = await startMockOpenAiServer();
	t.after(async () => {
		await mock.close();
	});

	// 1. /v1/models
	const modelsRes = await fetch(`${mock.url}/models`);
	assert.equal(modelsRes.status, 200);
	const modelsJson = await modelsRes.json();
	assert.ok(Array.isArray(modelsJson.data));
	assert.ok(modelsJson.data.some((m) => m.id === 'mock-model-a'));
	assert.ok(modelsJson.data.some((m) => m.id === 'mock-slow'));

	// 2. SSE 스트리밍 + temperature 로그 확인
	const sseRes = await fetch(`${mock.url}/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'mock-model-a',
			temperature: 1.5,
			stream: true,
			messages: [{ role: 'user', content: 'Explain quantum mechanics' }],
		}),
	});
	assert.equal(sseRes.status, 200);
	const sseText = await sseRes.text();
	assert.ok(sseText.includes('data: [DONE]'));
	assert.ok(parseSseContent(sseText).includes('[RESP:mock-model-a]'));
	const reqsAfterSse = mock.getChatRequests();
	assert.equal(reqsAfterSse.length, 1);
	assert.equal(reqsAfterSse[0].temperature, 1.5);

	// 3. failOnce: 첫 요청 500 -> 재시도 200
	mock.setFailOnce('mock-error');
	const failRes = await fetch(`${mock.url}/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'mock-error',
			stream: true,
			messages: [{ role: 'user', content: 'Retry test' }],
		}),
	});
	assert.equal(failRes.status, 500);

	const retryRes = await fetch(`${mock.url}/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'mock-error',
			stream: true,
			messages: [{ role: 'user', content: 'Retry test' }],
		}),
	});
	assert.equal(retryRes.status, 200);
	const retryText = await retryRes.text();
	assert.ok(parseSseContent(retryText).includes('[RESP:mock-error]'));

	// 4. 비스트리밍 레시피 분기 (Frontmatter, Summary, AI Route, Orphan AI Link, Voice Meeting)
	const fmRes = await fetch(`${mock.url}/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'mock-model-a',
			stream: false,
			messages: [{
				role: 'user',
				content: 'Analyze the following markdown document and return 1 to 3 relevant topic tags and a 1-sentence summary in JSON format.',
			}],
		}),
	});
	const fmJson = await fmRes.json();
	const fmParsed = JSON.parse(fmJson.choices[0].message.content);
	assert.deepEqual(fmParsed.tags, ['e2e-alpha', 'knowledge-graph']);

	const routeRes = await fetch(`${mock.url}/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'mock-model-a',
			stream: false,
			messages: [{
				role: 'user',
				content: 'Classify the following markdown note into the SINGLE most appropriate folder.\nAllowed Candidate Folders:\n- FolderAlpha\n- FolderBeta\n\nNote Title: Test',
			}],
		}),
	});
	const routeJson = await routeRes.json();
	const routeParsed = JSON.parse(routeJson.choices[0].message.content);
	assert.equal(routeParsed.folder, 'FolderAlpha');

	const orphanRes = await fetch(`${mock.url}/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'mock-model-a',
			stream: false,
			messages: [{
				role: 'user',
				content: 'Insert the EXACT wikilink "[[HubNote]]" naturally.\nHost Note Content:\nThis line talks about Quantum.',
			}],
		}),
	});
	const orphanJson = await orphanRes.json();
	const orphanParsed = JSON.parse(orphanJson.choices[0].message.content);
	assert.equal(orphanParsed.anchorLine, 'This line talks about Quantum.');
	assert.ok(orphanParsed.replacementLine.includes('[[HubNote]]'));

	const voiceRes = await fetch(`${mock.url}/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'mock-model-a',
			stream: false,
			messages: [
				{ role: 'system', content: 'Output template: Meeting / Lecture Notes.' },
				{ role: 'user', content: '<transcript>test</transcript>' },
			],
		}),
	});
	const voiceJson = await voiceRes.json();
	assert.ok(voiceJson.choices[0].message.content.includes('## Meeting Minutes'));

	// 5. mock-slow 클라이언트 abort 동작 확인
	const ac = new AbortController();
	const slowRes = await fetch(`${mock.url}/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'mock-slow',
			stream: true,
			messages: [{ role: 'user', content: 'Slow stream' }],
		}),
		signal: ac.signal,
	});
	assert.equal(slowRes.status, 200);
	const reader = slowRes.body.getReader();
	const firstChunk = await reader.read();
	assert.equal(firstChunk.done, false);
	ac.abort();
	await reader.cancel().catch(() => {});

	// 6. /v1/audio/transcriptions 멀티파트 업로드 검증
	const form = new FormData();
	form.append('model', 'whisper-1');
	form.append('response_format', 'verbose_json');
	form.append('prompt', 'LuminaCustomTerm');
	form.append('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' }), 'test_audio.wav');

	const sttRes = await fetch(`${mock.url}/audio/transcriptions`, {
		method: 'POST',
		body: form,
	});
	assert.equal(sttRes.status, 200);
	const sttJson = await sttRes.json();
	assert.ok(sttJson.text.includes('VoiceTargetLink'));
	assert.equal(sttJson.segments.length, 2);

	const sttLogs = mock.getSttRequests();
	assert.equal(sttLogs.length, 1);
	assert.equal(sttLogs[0].filename, 'test_audio.wav');
	assert.equal(sttLogs[0].prompt, 'LuminaCustomTerm');
});
