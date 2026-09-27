import type { LLMProviderConfig, FavoriteModel } from '../../../../shared/types/settings.types';
import {
	flattenProviderModels,
	sortWithFavorites,
	stripProviderSuffix,
	type FlattenedModel,
} from '../../../../shared/utils/modelUtils';

/**
 * 프로바이더 목록과 즐겨찾기 모델 목록을 평탄화하고 즐겨찾기 순으로 정렬합니다.
 */
export function getAllModels(
	providers: LLMProviderConfig[],
	favoriteModels: FavoriteModel[] = [],
): FlattenedModel[] {
	return sortWithFavorites(flattenProviderModels(providers, favoriteModels));
}

/**
 * 모델 목록을 검색 쿼리(대소문자 무시, 모델ID 및 프로바이더명)로 필터링합니다.
 */
export function filterModels(
	models: FlattenedModel[],
	searchQuery: string,
): FlattenedModel[] {
	const query = searchQuery.toLowerCase().trim();
	if (!query) return models;
	return models.filter(
		(item) =>
			item.modelId.toLowerCase().includes(query) ||
			stripProviderSuffix(item.providerName).toLowerCase().includes(query),
	);
}

/**
 * 프로바이더 ID와 모델 ID에 매칭되는 선택된 모델 객체를 검색합니다.
 */
export function findSelectedModel(
	models: FlattenedModel[],
	providerId?: string,
	modelId?: string,
): FlattenedModel | undefined {
	if (!providerId || !modelId) return undefined;
	return models.find((m) => m.providerId === providerId && m.modelId === modelId);
}
