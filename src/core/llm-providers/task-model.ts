/**
 * task-model.ts
 *
 * 백그라운드 작업(제목 생성, 컨텍스트 요약 등)을 수행할 때 사용할 모델을 결정하는 헬퍼.
 * 명시적인 Task 모델이 설정되어 있다면 해당 모델을 사용하고,
 * 설정되어 있지 않다면 기본 채팅 모델(Fallback)을 반환합니다.
 */

import type { LuminaSettings } from '../settings/settings.types';

export interface ResolvedTaskModel {
	providerId: string;
	modelId: string;
}

/**
 * Task 전용 모델을 확인하고 없으면 기본 채팅 모델을 반환합니다.
 * @param settings 플러그인 설정 객체
 * @returns 사용할 providerId와 modelId
 */
export function getResolvedTaskModel(settings: LuminaSettings): ResolvedTaskModel {
	const c = settings.connections;

	// 사용자가 Task 전용 모델을 명시적으로 설정한 경우
	if (c.taskProviderId && c.taskModelId) {
		return {
			providerId: c.taskProviderId,
			modelId: c.taskModelId,
		};
	}

	// 설정하지 않은 경우 메인 채팅 모델로 Fallback
	return {
		providerId: c.defaultProviderId,
		modelId: c.defaultModelId,
	};
}
