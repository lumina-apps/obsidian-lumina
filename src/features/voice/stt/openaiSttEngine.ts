/**
 * openaiSttEngine.ts
 *
 * 사용자가 이미 연결한 OpenAI, Groq, 또는 OpenAI 호환(Custom) 프로바이더의
 * /audio/transcriptions 엔드포인트를 재사용해 음성을 전사하는 STT 엔진입니다.
 */

import { raiseApiError, requestUrlWithAbort } from '../../../core/llm-providers/provider-helpers';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import type { SttTranscriptionResult, TranscriptSegment } from '../../../shared/types/voice.types';
import { buildMultipartFormData } from './multipartBuilder';
import type { ISttEngine, SttTranscribeOptions } from './sttTypes';

interface OpenAIWhisperSegmentRaw {
	start?: number;
	end?: number;
	text?: string;
}

interface OpenAIWhisperResponseRaw {
	text?: string;
	duration?: number;
	segments?: OpenAIWhisperSegmentRaw[];
}

/**
 * 프로바이더 설정으로부터 전사 API 엔드포인트 URL을 결정합니다.
 */
export function resolveOpenAiTranscriptionUrl(config: LLMProviderConfig): string {
	switch (config.type) {
		case 'openai':
			return 'https://api.openai.com/v1/audio/transcriptions';
		case 'groq':
			return 'https://api.groq.com/openai/v1/audio/transcriptions';
		case 'custom': {
			const trimmed = (config.baseUrl ?? '').trim().replace(/\/+$/, '');
			if (!trimmed) {
				throw new Error('Custom provider baseUrl is required for STT.');
			}
			if (trimmed.endsWith('/v1') || trimmed.endsWith('/openai/v1')) {
				return `${trimmed}/audio/transcriptions`;
			}
			return `${trimmed}/v1/audio/transcriptions`;
		}
		default:
			throw new Error(`Provider type "${config.type}" does not support OpenAI-compatible STT.`);
	}
}

/**
 * 프로바이더별 기본 STT 모델을 결정합니다.
 */
export function resolveDefaultOpenAiSttModel(config: LLMProviderConfig, explicitModel?: string): string {
	if (explicitModel?.trim()) {
		return explicitModel.trim();
	}
	switch (config.type) {
		case 'groq':
			return 'whisper-large-v3-turbo';
		case 'openai':
			return 'whisper-1';
		default:
			return 'whisper-1';
	}
}

/**
 * OpenAI 호환 Audio Transcriptions API 기반 STT 엔진
 */
export class OpenAiSttEngine implements ISttEngine {
	readonly id: string;
	readonly label: string;
	private config: LLMProviderConfig;
	private model: string;

	constructor(config: LLMProviderConfig, explicitModel?: string) {
		this.config = config;
		this.model = resolveDefaultOpenAiSttModel(config, explicitModel);
		this.id = `stt-${config.type}-${config.id}`;
		this.label = `${config.type.toUpperCase()} (${this.model})`;
	}

	async transcribe(
		blob: Blob,
		filename: string,
		options: SttTranscribeOptions = {},
	): Promise<SttTranscriptionResult> {
		const url = resolveOpenAiTranscriptionUrl(this.config);
		const apiKey = this.config.credential?.trim() ?? '';
		const audioBuffer = await blob.arrayBuffer();
		const audioBytes = new Uint8Array(audioBuffer);
		const offsetSec = options.offsetSec ?? 0;
		const cleanMime = (blob.type || 'audio/webm').split(';')[0].trim() || 'audio/webm';

		const preferVerbose = !this.model.toLowerCase().includes('gpt-4o');
		const firstFormat = preferVerbose ? 'verbose_json' : 'json';

		try {
			const parsed = await this.sendRequest(
				url,
				apiKey,
				audioBytes,
				cleanMime,
				filename,
				firstFormat,
				options,
			);
			return this.normalizeResponse(parsed, offsetSec);
		} catch (err: unknown) {
			// verbose_json 미지원 서버/모델인 경우 json 포맷으로 1회 자동 폴백
			const status = (err as { status?: number })?.status;
			if (preferVerbose && status === 400 && !options.signal?.aborted) {
				try {
					const fallbackParsed = await this.sendRequest(
						url,
						apiKey,
						audioBytes,
						cleanMime,
						filename,
						'json',
						options,
					);
					return this.normalizeResponse(fallbackParsed, offsetSec);
				} catch (fallbackErr: unknown) {
					raiseApiError(fallbackErr, this.label);
				}
			}
			raiseApiError(err, this.label);
		}
	}

	private async sendRequest(
		url: string,
		apiKey: string,
		bytes: Uint8Array,
		mimeType: string,
		filename: string,
		responseFormat: 'verbose_json' | 'json',
		options: SttTranscribeOptions,
	): Promise<OpenAIWhisperResponseRaw> {
		const fields: Record<string, string> = {
			model: this.model,
			response_format: responseFormat,
		};

		if (options.language && options.language !== 'auto') {
			fields.language = options.language.trim();
		}
		if (options.promptHint?.trim()) {
			fields.prompt = options.promptHint.trim().slice(0, 600);
		}

		const { contentType, body } = buildMultipartFormData(fields, {
			fieldName: 'file',
			filename,
			mimeType,
			bytes,
		});

		const headers: Record<string, string> = {
			'Content-Type': contentType,
		};
		if (apiKey) {
			headers.Authorization = `Bearer ${apiKey}`;
		}

		const res = await requestUrlWithAbort(
			{
				url,
				method: 'POST',
				headers,
				body,
			},
			options.signal,
		);

		return (res.json ?? JSON.parse(res.text)) as OpenAIWhisperResponseRaw;
	}

	private normalizeResponse(
		raw: OpenAIWhisperResponseRaw,
		offsetSec: number,
	): SttTranscriptionResult {
		const text = (raw.text ?? '').trim();
		const segments: TranscriptSegment[] = [];

		if (Array.isArray(raw.segments) && raw.segments.length > 0) {
			for (const seg of raw.segments) {
				const segText = (seg.text ?? '').trim();
				if (!segText) continue;
				const start = Math.max(0, (seg.start ?? 0) + offsetSec);
				const end = Math.max(start, (seg.end ?? seg.start ?? 0) + offsetSec);
				segments.push({
					startSec: start,
					endSec: end,
					text: segText,
				});
			}
		} else if (text) {
			segments.push({
				startSec: offsetSec,
				endSec: offsetSec + (raw.duration ?? 0),
				text,
			});
		}

		return {
			text,
			segments,
			engineLabel: this.label,
			durationSec: raw.duration,
		};
	}
}
