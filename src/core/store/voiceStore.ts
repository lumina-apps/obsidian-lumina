/**
 * voiceStore.ts
 *
 * AI Voice-to-Note 기능의 전역 런타임 상태 스토어.
 * 녹음/변환/검토 UI 상태 관리 및 플러그인 언로드·권한 해제 시 상태 초기화를 지원합니다.
 */

import { get, writable } from 'svelte/store';
import type {
	TranscriptSegment,
	VoiceRecordMode,
	VoiceReviewResult,
	VoiceSessionStatus,
	VoiceTemplateId,
} from '../../shared/types/voice.types';

/** Voice-to-Note 런타임 상태 구조 */
export interface VoiceRuntimeState {
	/** 현재 세션 상태 */
	status: VoiceSessionStatus;
	/** 녹음 경과 시간 (초) */
	elapsedSec: number;
	/** 실시간 오디오 입력 레벨 (0.0 ~ 1.0) */
	audioLevel: number;
	/** 현재 선택된 출력 템플릿 */
	templateId: VoiceTemplateId;
	/** 현재 녹음 및 반영 모드 */
	recordMode: VoiceRecordMode;
	/** 녹음 중 누적된 준실시간 전사 세그먼트 목록 */
	liveSegments: TranscriptSegment[];
	/** 현재 처리 단계 (1~3) */
	progressStep: number;
	/** 처리 단계 상세 메시지 */
	progressDetail: string;
	/** 오류 발생 시 사용자 표시 메시지 */
	errorMessage: string | null;
	/** 생성 직후 검토 결과 (후처리 액션 바용) */
	reviewResult: VoiceReviewResult | null;
	/** 비정상 종료로 복구 가능한 녹음 백업 존재 여부 */
	hasRecoverableSession: boolean;
}

function createInitialVoiceState(): VoiceRuntimeState {
	return {
		status: 'idle',
		elapsedSec: 0,
		audioLevel: 0,
		templateId: 'clean',
		recordMode: 'post-process',
		liveSegments: [],
		progressStep: 0,
		progressDetail: '',
		errorMessage: null,
		reviewResult: null,
		hasRecoverableSession: false,
	};
}

/** Voice-to-Note 런타임 상태 스토어 */
export const voiceStore = writable<VoiceRuntimeState>(createInitialVoiceState());

/** 현재 Voice-to-Note 런타임 상태 스냅샷 반환 */
export function getVoiceState(): VoiceRuntimeState {
	return get(voiceStore);
}

/** Voice-to-Note 런타임 상태 부분 업데이트 */
export function patchVoiceState(patch: Partial<VoiceRuntimeState>): void {
	voiceStore.update((state) => ({
		...state,
		...patch,
	}));
}

/** 실시간 전사 세그먼트 추가 */
export function appendLiveSegment(segment: TranscriptSegment): void {
	if (!segment.text.trim()) return;
	voiceStore.update((state) => ({
		...state,
		liveSegments: [...state.liveSegments, segment],
	}));
}

/** Voice-to-Note 런타임 상태 완전 초기화 */
export function resetVoiceStore(): void {
	voiceStore.set(createInitialVoiceState());
}
