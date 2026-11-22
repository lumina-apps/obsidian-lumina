/**
 * sttTypes.ts
 *
 * 음성 인식(STT) 엔진 공통 인터페이스 및 옵션 타입 정의.
 */

import type { SttTranscriptionResult } from '../../../shared/types/voice.types';

/** STT 전사 요청 옵션 */
export interface SttTranscribeOptions {
	/** 음성 언어 힌트 ('auto' 또는 ISO 코드) */
	language?: string;
	/** 고유명사 및 노트 제목 기반 인식 힌트 */
	promptHint?: string;
	/** 요청 취소 시그널 */
	signal?: AbortSignal;
	/** 분할 청크인 경우 원본 기준 시작 오프셋 (초) */
	offsetSec?: number;
	/** 모델 로딩 또는 청크 진행률 콜백 */
	onProgress?: (progress: number, status: string) => void;
}

/** STT 엔진 공통 추상화 인터페이스 */
export interface ISttEngine {
	/** 엔진 식별자 */
	readonly id: string;
	/** 사용자 표시용 엔진 레이블 */
	readonly label: string;
	/** 오디오 Blob을 텍스트 및 타임스탬프 세그먼트로 전사 */
	transcribe(
		blob: Blob,
		filename: string,
		options?: SttTranscribeOptions,
	): Promise<SttTranscriptionResult>;
	/** 엔진 내부 리소스(예: 전용 Worker) 정리 */
	destroy?(): void;
}
