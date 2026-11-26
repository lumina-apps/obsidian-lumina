/**
 * voiceStore.test.ts
 *
 * AI Voice-to-Note 런타임 스토어의 상태 패치, 실시간 세그먼트 필터링 추가 및 초기화를 검증합니다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	appendLiveSegment,
	getVoiceState,
	patchVoiceState,
	resetVoiceStore,
} from './voiceStore';

describe('voiceStore', () => {
	beforeEach(() => {
		resetVoiceStore();
	});

	it('patchVoiceState는 전달된 필드만 부분 갱신한다', () => {
		patchVoiceState({
			status: 'recording',
			elapsedSec: 12,
			audioLevel: 0.75,
			templateId: 'meeting',
		});

		const state = getVoiceState();
		expect(state.status).toBe('recording');
		expect(state.elapsedSec).toBe(12);
		expect(state.audioLevel).toBe(0.75);
		expect(state.templateId).toBe('meeting');
		expect(state.recordMode).toBe('post-process');
	});

	it('appendLiveSegment는 공백 전용 텍스트를 무시하고 유효한 세그먼트만 누적한다', () => {
		appendLiveSegment({ startSec: 0, endSec: 2, text: '   \n\t  ' });
		expect(getVoiceState().liveSegments).toHaveLength(0);

		appendLiveSegment({ startSec: 0, endSec: 3, text: '첫 번째 발화' });
		appendLiveSegment({ startSec: 3, endSec: 6, text: '두 번째 발화' });
		expect(getVoiceState().liveSegments).toEqual([
			{ startSec: 0, endSec: 3, text: '첫 번째 발화' },
			{ startSec: 3, endSec: 6, text: '두 번째 발화' },
		]);
	});

	it('resetVoiceStore는 변경된 모든 런타임 필드를 초기 상태로 되돌린다', () => {
		patchVoiceState({
			status: 'error',
			errorMessage: '마이크 오류',
			isDeferredCapture: true,
			hasRecoverableSession: true,
			pendingBannerDismissed: true,
		});
		appendLiveSegment({ startSec: 0, endSec: 1, text: '세그먼트' });

		resetVoiceStore();
		const reset = getVoiceState();
		expect(reset.status).toBe('idle');
		expect(reset.errorMessage).toBeNull();
		expect(reset.liveSegments).toEqual([]);
		expect(reset.isDeferredCapture).toBe(false);
		expect(reset.hasRecoverableSession).toBe(false);
		expect(reset.pendingBannerDismissed).toBe(false);
	});
});
