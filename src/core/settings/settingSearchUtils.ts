/**
 * settingSearchUtils.ts — 설정 화면 영문/현재 언어 양방향 검색 유틸리티
 */

import { getCurrentLoadedLocale, getEnLocale } from '../../shared/locales/helpers';

/**
 * 영어 ↔ 한국어 주요 설정 키워드 동의어 맵.
 * 한 언어로 검색하더라도 상대 언어 메뉴까지 모두 검색되도록 지원합니다.
 */
export const BILINGUAL_KEYWORDS: Record<string, string[]> = {
	model: ['모델', 'model'],
	모델: ['model', '모델'],
	chat: ['채팅', '대화', 'chat'],
	채팅: ['chat', '채팅'],
	대화: ['chat', 'conversation', '대화'],
	provider: ['제공자', '프로바이더', 'provider'],
	제공자: ['provider', '제공자'],
	프로바이더: ['provider', '프로바이더'],
	temperature: ['온도', '창의성', 'temperature'],
	온도: ['temperature', '온도'],
	창의성: ['temperature', '창의성'],
	token: ['토큰', 'token'],
	토큰: ['token', '토큰'],
	prompt: ['프롬프트', 'prompt'],
	프롬프트: ['prompt', '프롬프트'],
	search: ['검색', '탐색', 'search'],
	검색: ['search', '검색'],
	language: ['언어', 'language'],
	언어: ['language', '언어'],
	rag: ['임베딩', '지식', 'rag', 'embedding'],
	임베딩: ['embedding', 'rag', '임베딩'],
	embedding: ['임베딩', 'embedding', 'rag'],
	chunk: ['청크', '조각', 'chunk'],
	청크: ['chunk', '청크'],
	similarity: ['유사도', 'similarity'],
	유사도: ['similarity', '유사도'],
	mcp: ['도구', 'mcp', 'server'],
	server: ['서버', 'server'],
	서버: ['server', '서버'],
	advanced: ['고급', 'advanced'],
	고급: ['advanced', '고급'],
	project: ['프로젝트', 'project'],
	프로젝트: ['project', '프로젝트'],
	api: ['api', '키', 'key'],
	key: ['키', 'key'],
	키: ['key', '키'],
	vault: ['보관함', '볼트', 'vault'],
	보관함: ['vault', '보관함'],
	note: ['노트', '문서', 'note'],
	노트: ['note', '노트'],
	canvas: ['캔버스', 'canvas'],
	캔버스: ['canvas', '캔버스'],
	graph: ['그래프', 'graph'],
	그래프: ['graph', '그래프'],
	rerank: ['리랭커', '리랭크', 'rerank', 'reranker'],
	reranker: ['리랭커', 'reranker', 'rerank'],
	리랭커: ['reranker', 'rerank', '리랭커'],
	debug: ['디버그', '로그', 'debug', 'log'],
	디버그: ['debug', '디버그'],
	log: ['로그', '기록', 'log'],
	로그: ['log', 'debug', '로그'],
	sync: ['동기화', 'sync'],
	동기화: ['sync', '동기화'],
	history: ['히스토리', '기록', '이력', 'history'],
	히스토리: ['history', '히스토리'],
	web: ['웹', '인터넷', 'web'],
	웹: ['web', '웹'],
};

/**
 * 검색어로부터 동의어/교차 언어 검색어 목록을 추출합니다.
 * 예: "model" -> ["model", "모델"]
 *     "기본 모델" -> ["기본 모델", "model", "모델"]
 */
export function expandQueryTerms(rawQuery: string): string[] {
	const trimmed = rawQuery.trim().toLowerCase();
	if (!trimmed) return [];

	const terms = new Set<string>();
	terms.add(trimmed);

	// 개별 단어에 대한 동의어 추가
	const words = trimmed.split(/\s+/);
	for (const word of words) {
		const synonyms = BILINGUAL_KEYWORDS[word];
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
			for (const key of Object.keys(en as Record<string, unknown>)) {
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
