/**
 * geminiSttEngine.ts
 *
 * 사용자가 연결한 Google Gemini API 키를 재사용해 오디오를 직접 입력하고
 * 타임스탬프가 포함된 전사 텍스트를 추출하는 멀티모달 STT 엔진입니다.
 */

import { raiseApiError, requestUrlWithAbort } from '../../../core/llm-providers/provider-helpers';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import type { SttTranscriptionResult, TranscriptSegment } from '../../../shared/types/voice.types';
import { isEmbeddingModel } from '../../../shared/utils/modelUtils';
import type { ISttEngine, SttTranscribeOptions } from './sttTypes';

interface GeminiTranscriptJson {
	text?: string;
	segments?: Array<{
		startSec?: number;
		endSec?: number;
		text?: string;
	}>;
}

/** ArrayBuffer를 스택 오버플로 없이 Base64 문자열로 변환 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;
	const chunks: string[] = [];
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const sub = bytes.subarray(i, i + chunkSize);
		chunks.push(String.fromCharCode(...sub));
	}
	return btoa(chunks.join(''));
}

/** 연결된 Google 프로바이더에서 오디오 입력에 적합한 Gemini 모델 선택 */
export function resolveGeminiSttModel(config: LLMProviderConfig, explicitModel?: string): string {
	if (explicitModel?.trim()) {
		return explicitModel.trim();
	}
	const models = config.availableModels.filter((m) => !isEmbeddingModel('google', m));
	const flash = models.find((m) => m.toLowerCase().includes('flash'));
	return flash ?? models[0] ?? 'gemini-2.5-flash';
}

/**
 * Google Gemini 멀티모달 오디오 전사 기반 STT 엔진
 */
export class GeminiSttEngine implements ISttEngine {
	readonly id: string;
	readonly label: string;
	private apiKey: string;
	private model: string;

	constructor(config: LLMProviderConfig, explicitModel?: string) {
		this.apiKey = config.credential.trim();
		this.model = resolveGeminiSttModel(config, explicitModel);
		this.id = `stt-google-${config.id}`;
		this.label = `Gemini (${this.model})`;
	}

	async transcribe(
		blob: Blob,
		_filename: string,
		options: SttTranscribeOptions = {},
	): Promise<SttTranscriptionResult> {
		const arrayBuf = await blob.arrayBuffer();
		const base64Audio = arrayBufferToBase64(arrayBuf);
		const mimeType = (blob.type || 'audio/webm').split(';')[0].trim();
		const offsetSec = options.offsetSec ?? 0;

		const langGuide =
			options.language && options.language !== 'auto'
				? `Primary spoken language hint: ${options.language}.`
				: 'Preserve the original spoken language(s) accurately (including mixed technical terms).';
		const vocabGuide = options.promptHint?.trim()
			? `Vocabulary & context hints: ${options.promptHint.trim().slice(0, 500)}`
			: '';

		const prompt = [
			'Transcribe the attached audio verbatim with timestamps.',
			'Do not summarize, answer, or add commentary. If there is no speech, return empty text and empty segments.',
			langGuide,
			vocabGuide,
			'Respond strictly in JSON matching: {"text": "full verbatim transcript", "segments": [{"startSec": 0, "endSec": 5, "text": "segment text"}]}',
		]
			.filter(Boolean)
			.join('\n');

		const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;

		try {
			const res = await requestUrlWithAbort(
				{
					url,
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-goog-api-key': this.apiKey,
					},
					body: JSON.stringify({
						contents: [
							{
								role: 'user',
								parts: [
									{
										inlineData: {
											mimeType,
											data: base64Audio,
										},
									},
									{ text: prompt },
								],
							},
						],
						generationConfig: {
							temperature: 0,
							responseMimeType: 'application/json',
						},
					}),
				},
				options.signal,
			);

			const data = (res.json ?? JSON.parse(res.text)) as {
				candidates?: Array<{
					content?: {
						parts?: Array<{ text?: string }>;
					};
				}>;
			};

			const rawText =
				data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

			return this.parseGeminiOutput(rawText, offsetSec);
		} catch (err: unknown) {
			raiseApiError(err, this.label);
		}
	}

	private parseGeminiOutput(rawText: string, offsetSec: number): SttTranscriptionResult {
		const trimmed = rawText.trim();
		if (!trimmed) {
			return { text: '', segments: [], engineLabel: this.label };
		}

		// JSON 코드 펜스 제거 후 파싱 시도
		const jsonCandidate = trimmed
			.replace(/^```json\s*/i, '')
			.replace(/^```\s*/i, '')
			.replace(/\s*```$/, '')
			.trim();

		try {
			const parsed = JSON.parse(jsonCandidate) as GeminiTranscriptJson;
			const segments: TranscriptSegment[] = [];
			if (Array.isArray(parsed.segments)) {
				for (const seg of parsed.segments) {
					const segText = (seg.text ?? '').trim();
					if (!segText) continue;
					const start = Math.max(0, Number(seg.startSec ?? 0) + offsetSec);
					const end = Math.max(start, Number(seg.endSec ?? start) + offsetSec);
					segments.push({ startSec: start, endSec: end, text: segText });
				}
			}
			const fullText = (parsed.text ?? segments.map((s) => s.text).join(' ')).trim();
			if (segments.length === 0 && fullText) {
				segments.push({ startSec: offsetSec, endSec: offsetSec, text: fullText });
			}
			return {
				text: fullText,
				segments,
				engineLabel: this.label,
			};
		} catch {
			// JSON 파싱 실패 시 일반 텍스트 응답으로 안전 폴백
			return {
				text: trimmed,
				segments: [{ startSec: offsetSec, endSec: offsetSec, text: trimmed }],
				engineLabel: this.label,
			};
		}
	}
}
