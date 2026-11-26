/**
 * voice.types.ts
 *
 * AI Voice-to-Note(스마트 음성 노트) 기능의 순수 타입 정의 모음.
 */

/** 녹음 및 텍스트 반영 방식 */
export type VoiceRecordMode = 'post-process' | 'live-insert';

/** 원본 오디오 파일 보관 방식 */
export type VoiceAudioStorageMode = 'vault' | 'discard';

/** 노트 정리 출력 템플릿 프리셋 */
export type VoiceTemplateId = 'clean' | 'meeting' | 'verbatim';

/** STT 엔진 선택 모드 */
export type VoiceSttEngineMode = 'auto' | 'provider' | 'local-whisper';

/** 모바일 녹음 캡처 방식 (자동 / 항상 저장 후 데스크톱에서 변환) */
export type VoiceMobileCaptureMode = 'auto' | 'defer-to-desktop';

/** 데스크톱 동기화 후 변환 대기 중인 음성 항목 상태 */
export type PendingVoiceStatus = 'ready' | 'waiting-audio';

/** 마크다운 노트에 기록된 데스크톱 변환 대기 음성 항목 */
export interface PendingVoiceItem {
	/** 마커 고유 식별자 */
	id: string;
	/** 대기 마커가 포함된 마크다운 노트 경로 */
	notePath: string;
	/** 볼트에 저장된 오디오 파일 경로 */
	audioPath: string;
	/** 변환 시 적용할 출력 템플릿 ID */
	templateId: VoiceTemplateId;
	/** 오디오 파일 동기화 완료 여부 */
	status: PendingVoiceStatus;
}

/** 사용자 설정에 선택적으로 저장되는 Voice-to-Note 선호 설정 */
export interface VoiceNotePreferences {
	/** 녹음 및 텍스트 반영 방식 (종료 후 AI 정리 / 실시간 커서 입력) */
	recordMode?: VoiceRecordMode;
	/** 원본 오디오 파일 보관 방식 (볼트 저장 / 변환 후 삭제) */
	audioStorageMode?: VoiceAudioStorageMode;
	/** 오디오 파일 볼트 저장 폴더 경로 */
	audioFolder?: string;
	/** 기본 출력 템플릿 ID */
	defaultTemplate?: VoiceTemplateId;
	/** STT 엔진 동작 모드 */
	sttMode?: VoiceSttEngineMode;
	/** 수동 지정 STT 프로바이더 ID (sttMode === 'provider'일 때 사용) */
	sttProviderId?: string;
	/** 수동 지정 STT 모델 ID */
	sttModelId?: string;
	/** 노트 후처리용 LLM 프로바이더 ID (비어 있으면 자동 선택) */
	llmProviderId?: string;
	/** 노트 후처리용 LLM 모델 ID */
	llmModelId?: string;
	/** 로컬 온디바이스 Whisper 모델 ID */
	localWhisperModel?: string;
	/** 노트 하단에 원본 타임라인 스크립트 접기 콜아웃 포함 여부 */
	includeRawTranscript?: boolean;
	/** 볼트 내 노트 제목/별칭 기반 자동 위키링크([[...]]) 적용 여부 */
	autoWikiLink?: boolean;
	/** 고유명사/전문용어 인식 힌트 목록 */
	customVocabulary?: string[];
	/** 음성 인식 언어 힌트 (예: 'auto', 'ko', 'en', 'ja') */
	language?: string;
	/** 좌측 리본에 Voice-to-Note 마이크 아이콘 표시 여부 */
	showRibbonIcon?: boolean;
	/** 모바일 환경 녹음 캡처 방식 */
	mobileCaptureMode?: VoiceMobileCaptureMode;
}

/** 타임스탬프가 포함된 단일 전사 세그먼트 */
export interface TranscriptSegment {
	/** 시작 시각 (초) */
	startSec: number;
	/** 종료 시각 (초) */
	endSec: number;
	/** 전사된 텍스트 */
	text: string;
}

/** STT 엔진 전사 결과 */
export interface SttTranscriptionResult {
	/** 전체 전사 원문 */
	text: string;
	/** 타임스탬프 포함 세그먼트 목록 */
	segments: TranscriptSegment[];
	/** 사용된 STT 엔진 표시명 */
	engineLabel: string;
	/** 전체 오디오 길이 (초) */
	durationSec?: number;
}

/** 음성 노트 세션 진행 상태 */
export type VoiceSessionStatus =
	| 'idle'
	| 'recording'
	| 'paused'
	| 'transcribing'
	| 'processing'
	| 'review'
	| 'error';

/** 에디터 문서 위치 좌표 */
export interface VoiceEditorPosition {
	/** 0 기반 줄 번호 */
	line: number;
	/** 줄 내 문자 오프셋 */
	ch: number;
}

/** 생성 직후 후처리(재정리/적용/되돌리기)에 필요한 검토 결과 */
export interface VoiceReviewResult {
	/** 반영된 대상 마크다운 파일 경로 */
	targetFilePath: string | null;
	/** 원본 전사 텍스트 */
	rawTranscript: string;
	/** 타임스탬프 포함 세그먼트 목록 */
	segments: TranscriptSegment[];
	/** 최종 조립된 마크다운 결과 */
	formattedMarkdown: string;
	/** 볼트에 저장된 오디오 파일 경로 (미저장 시 null) */
	audioVaultPath: string | null;
	/** 적용된 출력 템플릿 ID */
	templateId: VoiceTemplateId;
	/** 녹음 중 사용자가 노트에 직접 작성한 메모 변경분 */
	userMemoSnapshot: string;
	/** 현재 에디터에 삽입된 문서 범위 (되돌리기/교체용) */
	insertedRange?: {
		from: VoiceEditorPosition;
		to: VoiceEditorPosition;
	};
	/** 새 노트 생성으로 반영된 경우 true */
	createdNewFile?: boolean;
}
