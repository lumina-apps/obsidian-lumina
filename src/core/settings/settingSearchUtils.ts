/**
 * settingSearchUtils.ts — 설정 화면 영문/현재 언어 양방향 검색 유틸리티
 */

import { getCurrentLoadedLocale, getEnLocale, getLanguage } from '../../shared/locales/helpers';

/**
 * 언어 공통 기술 약어/동의어 목록 (모든 언어에 공통 적용).
 */
export const COMMON_SYNONYMS: string[][] = [
	['rag', 'embedding', 'vector'],
	['mcp', 'server', 'tools'],
	['temp', 'temperature'],
	['api', 'apikey', 'key'],
	['rerank', 'reranker'],
];

/**
 * 언어별 주요 설정 키워드 동의어 그룹 목록.
 * 각 그룹 내의 모든 단어는 상호 동의어로 자동 확장됩니다.
 */
export const LOCALE_SYNONYMS: Record<string, string[][]> = {
	ko: [
		['model', '모델'],
		['chat', '채팅', '대화', 'conversation'],
		['provider', '제공자', '프로바이더'],
		['temperature', '온도', '창의성'],
		['token', '토큰'],
		['prompt', '프롬프트'],
		['search', '검색', '탐색'],
		['language', '언어'],
		['rag', 'embedding', '임베딩', '지식'],
		['chunk', '청크', '조각'],
		['similarity', '유사도'],
		['mcp', 'server', '서버', '도구'],
		['advanced', '고급'],
		['project', '프로젝트'],
		['api', 'key', '키'],
		['vault', '보관함', '볼트'],
		['note', '노트', '문서'],
		['canvas', '캔버스'],
		['graph', '그래프'],
		['rerank', 'reranker', '리랭커', '리랭크'],
		['debug', 'log', '디버그', '로그', '기록'],
		['sync', '동기화'],
		['history', '히스토리', '기록', '이력'],
		['web', '웹', '인터넷'],
	],
	ja: [
		['model', 'モデル'],
		['chat', 'チャット', '対話', '会話', 'conversation'],
		['provider', 'プロバイダー', '提供者'],
		['temperature', '温度', '創造性'],
		['token', 'トークン'],
		['prompt', 'プロンプト'],
		['search', '検索', 'サーチ'],
		['language', '言語'],
		['rag', 'embedding', '埋め込み', 'ベクター', '知識'],
		['chunk', 'チャンク', '断片'],
		['similarity', '類似度'],
		['mcp', 'server', 'サーバー', 'ツール'],
		['advanced', '高度', '詳細'],
		['project', 'プロジェクト'],
		['api', 'key', 'キー'],
		['vault', '保管庫', 'ボルト'],
		['note', 'ノート', '文書'],
		['canvas', 'キャンバス'],
		['graph', 'グラフ'],
		['rerank', 'reranker', 'リランカー', 'リランク'],
		['debug', 'log', 'デバッグ', 'ログ', '記録'],
		['sync', '同期'],
		['history', '履歴', 'ヒストリー'],
		['web', 'ウェブ', 'インターネット'],
	],
	zh: [
		['model', '模型'],
		['chat', '聊天', '对话', 'conversation'],
		['provider', '提供商', '提供者'],
		['temperature', '温度', '创造力'],
		['token', '令牌'],
		['prompt', '提示词', '提示'],
		['search', '搜索', '查找'],
		['language', '语言'],
		['rag', 'embedding', '嵌入', '向量', '知识库', '知识'],
		['chunk', '分块', '切片'],
		['similarity', '相似度'],
		['mcp', 'server', '服务器', '工具'],
		['advanced', '高级'],
		['project', '项目'],
		['api', 'key', '密钥'],
		['vault', '仓库', '保险库'],
		['note', '笔记', '文档'],
		['canvas', '白板', '画布'],
		['graph', '图谱', '关系图'],
		['rerank', 'reranker', '重排', '重排序'],
		['debug', 'log', '调试', '日志', '记录'],
		['sync', '同步'],
		['history', '历史', '记录'],
		['web', '网络', '网页'],
	],
	'zh-tw': [
		['model', '模型'],
		['chat', '聊天', '對話', 'conversation'],
		['provider', '提供商', '提供者'],
		['temperature', '溫度', '創造力'],
		['token', '權杖'],
		['prompt', '提示詞', '提示'],
		['search', '搜尋', '查找'],
		['language', '語言'],
		['rag', 'embedding', '嵌入', '向量', '知識庫', '知識'],
		['chunk', '分塊', '切片'],
		['similarity', '相似度'],
		['mcp', 'server', '伺服器', '工具'],
		['advanced', '進階', '高級'],
		['project', '專案', '項目'],
		['api', 'key', '金鑰'],
		['vault', '儲存庫', '保險庫'],
		['note', '筆記', '文件'],
		['canvas', '白板', '畫布'],
		['graph', '圖譜', '關聯圖'],
		['rerank', 'reranker', '重排', '重排序'],
		['debug', 'log', '除錯', '記錄檔', '日誌'],
		['sync', '同步'],
		['history', '歷史', '紀錄'],
		['web', '網路', '網頁'],
	],
};

/**
 * 동의어 그룹 목록으로부터 단어별 양방향 동의어 맵을 생성합니다.
 */
export function buildSynonymMap(groups: string[][]): Map<string, string[]> {
	const map = new Map<string, Set<string>>();
	for (const group of groups) {
		const words = group.map(w => w.trim().toLowerCase()).filter(Boolean);
		for (const w of words) {
			let set = map.get(w);
			if (!set) {
				set = new Set<string>();
				map.set(w, set);
			}
			for (const other of words) {
				set.add(other);
			}
		}
	}
	const result = new Map<string, string[]>();
	for (const [k, v] of map.entries()) {
		result.set(k, Array.from(v));
	}
	return result;
}

const synonymCache = new Map<string, Map<string, string[]>>();

/**
 * 특정 로케일(또는 언어 무관 공통/전체)에 해당하는 동의어 맵을 반환합니다.
 */
export function getSynonymMapForLocale(locale?: string): Map<string, string[]> {
	const lang = (locale || getLanguage() || 'all').toLowerCase().replace('_', '-');
	const baseLang = lang.split('-')[0];

	const cacheKey = LOCALE_SYNONYMS[lang]
		? lang
		: LOCALE_SYNONYMS[baseLang]
		? baseLang
		: (lang === 'en' || lang === 'system' || !locale)
		? 'all'
		: lang;

	const cached = synonymCache.get(cacheKey);
	if (cached) return cached;

	let groups: string[][] = [...COMMON_SYNONYMS];
	if (cacheKey !== 'all') {
		const localeGroups = LOCALE_SYNONYMS[cacheKey];
		if (localeGroups) {
			groups = groups.concat(localeGroups);
		}
	} else {
		for (const localeGroups of Object.values(LOCALE_SYNONYMS)) {
			groups = groups.concat(localeGroups);
		}
	}

	const map = buildSynonymMap(groups);
	synonymCache.set(cacheKey, map);
	return map;
}

/**
 * 하위 호환성을 위해 유지되는 한국어 동의어 맵.
 */
export const BILINGUAL_KEYWORDS: Record<string, string[]> = (() => {
	const map = getSynonymMapForLocale('ko');
	const record: Record<string, string[]> = {};
	for (const [k, v] of map.entries()) {
		record[k] = v;
	}
	return record;
})();

/**
 * 검색어로부터 동의어/교차 언어 검색어 목록을 추출합니다.
 * 예: "model" -> ["model", "모델"] (한국어 모드) 또는 ["model", "モデル"] (일본어 모드)
 *     "기본 모델" -> ["기본 모델", "model", "모델"]
 */
export function expandQueryTerms(rawQuery: string, locale?: string): string[] {
	const trimmed = rawQuery.trim().toLowerCase();
	if (!trimmed) return [];

	const terms = new Set<string>();
	terms.add(trimmed);

	const synonymMap = getSynonymMapForLocale(locale);

	// 전체 검색어 매칭 확인
	const fullSynonyms = synonymMap.get(trimmed);
	if (fullSynonyms) {
		for (const syn of fullSynonyms) {
			terms.add(syn);
		}
	}

	// 개별 단어에 대한 동의어 추가
	const words = trimmed.split(/\s+/);
	for (const word of words) {
		const synonyms = synonymMap.get(word);
		if (synonyms) {
			for (const syn of synonyms) {
				terms.add(syn);
			}
		}
	}

	return Array.from(terms);
}

/**
 * en.json과 현재 로드된 로케일 객체를 순회하여
 * 화면 텍스트 ↔ 영문 원본 텍스트 매핑 인덱스를 생성합니다.
 */
export function buildTranslationIndex(
	currentLocale: unknown,
	enLocale: unknown
): Map<string, string> {
	const map = new Map<string, string>();

	function walk(cur: unknown, en: unknown) {
		if (!cur || !en) return;
		if (typeof cur === 'string' && typeof en === 'string') {
			const c = cur.replace(/\s+/g, ' ').trim().toLowerCase();
			const e = en.replace(/\s+/g, ' ').trim().toLowerCase();
			if (c && e) {
				map.set(c, e);
				map.set(e, c);
			}
			return;
		}
		if (typeof cur === 'object' && typeof en === 'object') {
			for (const key of Object.keys(en)) {
				walk(
					(cur as Record<string, unknown>)[key],
					(en as Record<string, unknown>)[key]
				);
			}
		}
	}

	walk(currentLocale, enLocale);
	return map;
}

/**
 * 현재 활성화된 로케일과 en.json 간의 번역 인덱스를 반환합니다.
 */
export function getActiveTranslationIndex(): Map<string, string> {
	return buildTranslationIndex(getCurrentLoadedLocale(), getEnLocale());
}

/**
 * 설정 항목(이름, 설명, 추가 텍스트)이 다국어 검색어와 일치하는지 검사합니다.
 */
export function isSettingItemMatchBilingual(
	name: string,
	desc: string,
	otherText: string,
	queryTerms: string[],
	translationMap: Map<string, string>
): boolean {
	const n = name.replace(/\s+/g, ' ').trim().toLowerCase();
	const d = desc.replace(/\s+/g, ' ').trim().toLowerCase();
	const o = otherText.replace(/\s+/g, ' ').trim().toLowerCase();

	const enName = translationMap.get(n) ?? '';
	const enDesc = translationMap.get(d) ?? '';

	for (const term of queryTerms) {
		// 1. 현재 화면 텍스트 직접 매칭
		if (n.includes(term) || d.includes(term) || o.includes(term)) {
			return true;
		}
		// 2. 번역된 영문/현지어 원문 매칭
		if (enName && enName.includes(term)) {
			return true;
		}
		if (enDesc && enDesc.includes(term)) {
			return true;
		}
	}

	return false;
}
