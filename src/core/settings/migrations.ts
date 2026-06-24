/**
 * migrations.ts
 *
 * 설정 마이그레이션 유틸리티.
 * main.ts에서 분리되어 LuminaPlugin의 오케스트레이션 부담을 줄입니다.
 *
 * - migrateQuickActions: 기존 하드코딩된 퀵액션 이름을 다국어 키로 마이그레이션
 * - migrateExcludedPaths: chatHistory, configDir을 제외 경로에 자동 추가
 */

import { t } from '../../shared/locales/helpers';
import type LuminaPlugin from '../../main';

/** 마이그레이션 대상인 구버전 chat 설정 타입 */
interface LegacyChatSettings {
	useTokenLimit?: boolean;
	contextWindowTurns?: number;
	memoryMethod?: string;
}

const KNOWN_SUMMARIZE_NAMES = [
	'요약하기', 'Summarize', 'Resumir', 'Résumer', 'Riassumi',
	'要約する', 'Zusammenfassen', 'Резюмировать', '總結', '总结',
];

const KNOWN_TRANSLATE_NAMES = [
	'영어로 번역', '한국어로 번역',
	'Translate to English', 'Traducir al Inglés', 'Traducir al Español', 'Traducir al español',
	'Traduire en Anglais', 'Traduire en Français', 'Traduire en français', 'Traduci in Inglese', 'Traduci in Italiano',
	'英語に翻訳', '日本語に翻訳',
	'Ins Englische übersetzen', 'Ins Deutsche übersetzen',
	'Перевести на Английский', 'Перевести на Русский',
	'翻譯為英文', '翻譯為繁體中文', '翻译为英文', '翻译为中文',
	'Traduzir para Inglês', 'Traduzir para o Português',
];

const KNOWN_EXPLAIN_NAMES = [
	'설명하기', 'Explain', 'Explicar', 'Expliquer', 'Spiega',
	'説明する', 'Erklären', 'Объяснить', '解釋', '解释',
];

const matchNameCaseInsensitive = (name: string, list: string[]): boolean => {
	return list.some(item => item.toLowerCase() === name.toLowerCase());
};

/**
 * 퀵 액션의 이름/프롬프트를 다국어 키로 마이그레이션합니다.
 * 변경 사항이 있으면 자동으로 퀵액션을 재등록합니다.
 * @returns 변경 사항이 있으면 true
 */
export function migrateQuickActions(plugin: LuminaPlugin): boolean {
	const actions = plugin.settings.chat.quickActions;
	if (!actions) return false;
	let changed = false;

	for (const action of actions) {
		if (action.id === 'qa-summarize' && matchNameCaseInsensitive(action.name, KNOWN_SUMMARIZE_NAMES)) {
			action.name = t('settings.chat.quickActions.defaults.summarize.name');
			action.prompt = t('settings.chat.quickActions.defaults.summarize.prompt');
			changed = true;
		} else if (action.id === 'qa-translate' && matchNameCaseInsensitive(action.name, KNOWN_TRANSLATE_NAMES)) {
			action.name = t('settings.chat.quickActions.defaults.translate.name');
			action.prompt = t('settings.chat.quickActions.defaults.translate.prompt');
			changed = true;
		} else if (action.id === 'qa-explain' && matchNameCaseInsensitive(action.name, KNOWN_EXPLAIN_NAMES)) {
			action.name = t('settings.chat.quickActions.defaults.explain.name');
			action.prompt = t('settings.chat.quickActions.defaults.explain.prompt');
			changed = true;
		}
	}

	if (changed) {
		plugin.commandManager.registerQuickActions();
	}
	return changed;
}

/**
 * 제외 경로 마이그레이션을 수행합니다.
 * - chatHistory 폴더를 제외 경로에 추가 (hasMigratedChatHistory 플래그로 1회만)
 * - .obsidian configDir을 제외 경로에 추가
 * - 이전 방식(.obsidian) 제외 경로를 새 configDir로 갱신
 * @returns 변경 사항이 있으면 true
 */
export function migrateExcludedPaths(plugin: LuminaPlugin): boolean {
	let changed = false;

	if (!plugin.settings.misc.hasMigratedChatHistory) {
		if (!plugin.settings.rag.excludedPaths.includes('chatHistory')) {
			plugin.settings.rag.excludedPaths.push('chatHistory');
		}
		plugin.settings.misc.hasMigratedChatHistory = true;
		changed = true;
	}

	const configDir = plugin.app.vault.configDir;
	if (configDir && !plugin.settings.rag.excludedPaths.includes(configDir)) {
		plugin.settings.rag.excludedPaths.push(configDir);
		changed = true;
	}

	const oldConfigDir = '.' + 'obsidian';
	if (configDir !== oldConfigDir && plugin.settings.rag.excludedPaths.includes(oldConfigDir)) {
		plugin.settings.rag.excludedPaths = plugin.settings.rag.excludedPaths.filter(p => p !== oldConfigDir);
		changed = true;
	}

	if (!plugin.settings.rag.excludedPaths.includes('backups')) {
		plugin.settings.rag.excludedPaths.push('backups');
		changed = true;
	}

	return changed;
}

/**
 * RAG minSimilarity 기본값을 0.65에서 0.0으로 마이그레이션.
 * IBM Granite 모델의 코사인 유사도 분포가 0.5~0.6대에 집중되어 있어 0.65는 지나치게 높음.
 */
export function migrateMinSimilarity(plugin: LuminaPlugin): boolean {
	if (plugin.settings.rag.minSimilarity === 0.65) {
		plugin.settings.rag.minSimilarity = 0.0;
		return true;
	}
	return false;
}

/**
 * useTokenLimit 옵션을 memoryMethod로 마이그레이션.
 */
export function migrateMemoryMethod(plugin: LuminaPlugin): boolean {
	if (plugin.settings.chat.memoryMethod === undefined) {
		const legacyChat = plugin.settings.chat as LegacyChatSettings;
		if (legacyChat.useTokenLimit) {
			plugin.settings.chat.memoryMethod = 'tokens';
		} else {
			plugin.settings.chat.memoryMethod = 'auto_summary';
		}
		return true;
	}
	return false;
}

/**
 * contextWindowTurns가 새로운 최소값(5)보다 작을 경우 기본값(10)으로 마이그레이션.
 */
export function migrateContextWindowTurns(plugin: LuminaPlugin): boolean {
	if (plugin.settings.chat.contextWindowTurns < 5) {
		plugin.settings.chat.contextWindowTurns = 10;
		return true;
	}
	return false;
}

/**
 * Web Search 마이그레이션.
 * 기존 사용자 설정에 webSearch 속성이 없으면 기본값을 주입합니다.
 */
export function migrateWebSearch(plugin: LuminaPlugin): boolean {
	if (!plugin.settings.webSearch) {
		plugin.settings.webSearch = {
			enabled: false,
			providers: [
				{ type: 'tavily', apiKey: '' },
				{ type: 'brave', apiKey: '' },
				{ type: 'searxng', baseUrl: 'http://localhost:8080' },
			],
			activeProviderId: 'tavily',
			maxResults: 5,
			maxContentLength: 3000,
		};
		return true;
	}
	return false;
}

/**
 * 모든 마이그레이션을 순차 실행하고 변경이 있으면 저장합니다.
 * @returns 저장이 필요하면 true
 */
export function runMigrations(plugin: LuminaPlugin): boolean {
	let needsSave = false;
	if (migrateQuickActions(plugin)) needsSave = true;
	if (migrateExcludedPaths(plugin)) needsSave = true;
	if (migrateMinSimilarity(plugin)) needsSave = true;
	if (migrateMemoryMethod(plugin)) needsSave = true;
	if (migrateContextWindowTurns(plugin)) needsSave = true;
	if (migrateWebSearch(plugin)) needsSave = true;
	return needsSave;
}