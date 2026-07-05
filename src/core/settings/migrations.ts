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
import { createDefaultProject } from '../../shared/types/project.types';

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

	const configDir = plugin.app.vault.configDir;
	const oldConfigDir = '.' + 'obsidian';

	for (const p of plugin.settings.projects.list) {
		if (!plugin.settings.misc.hasMigratedChatHistory) {
			if (!p.ragExcludedPaths.includes('chatHistory')) {
				p.ragExcludedPaths.push('chatHistory');
				changed = true;
			}
		}

		if (configDir && !p.ragExcludedPaths.includes(configDir)) {
			p.ragExcludedPaths.push(configDir);
			changed = true;
		}

		if (configDir !== oldConfigDir && p.ragExcludedPaths.includes(oldConfigDir)) {
			p.ragExcludedPaths = p.ragExcludedPaths.filter(path => path !== oldConfigDir);
			changed = true;
		}

		if (!p.ragExcludedPaths.includes('backups')) {
			p.ragExcludedPaths.push('backups');
			changed = true;
		}
	}

	if (!plugin.settings.misc.hasMigratedChatHistory) {
		plugin.settings.misc.hasMigratedChatHistory = true;
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
 * Canvas 설정 마이그레이션.
 * 기존 사용자 설정에 canvas 속성이 없으면 기본값을 주입합니다.
 */
export function migrateCanvasSettings(plugin: LuminaPlugin): boolean {
	if (!plugin.settings.canvas) {
		plugin.settings.canvas = {
			depth: 1,
			layout: 'radial',
			bidirectional: true,
			includeAttachments: false,
			maxNodes: 200,
			folderDepth: 0,
			outputPath: 'canvasVisualize',
			showFolderGroups: false,
		};
		return true;
	}
	return false;
}

/**
 * Projects 설정 마이그레이션.
 * projects 필드가 없는 기존 사용자에게 Default 프로젝트를 초기화합니다.
 */
export function migrateProjects(plugin: LuminaPlugin): boolean {
	let needsSave = false;

	if (!plugin.settings.projects) {
		plugin.settings.projects = {
			list: [createDefaultProject()],
			activeProjectId: 'default',
		};
		needsSave = true;
	}
	// list가 비어있으면 Default 복구
	if (!plugin.settings.projects.list || plugin.settings.projects.list.length === 0) {
		plugin.settings.projects.list = [createDefaultProject()];
		plugin.settings.projects.activeProjectId = 'default';
		needsSave = true;
	}

	// ── 전역 RAG 설정을 프로젝트(Default) 단위로 이관 ──
	const legacyRag = plugin.settings.rag as any;
	if (legacyRag && (legacyRag.includedPaths !== undefined || legacyRag.excludedPaths !== undefined)) {
		const defaultProject = plugin.settings.projects.list.find(p => p.id === 'default');
		if (defaultProject) {
			if (legacyRag.includedPaths !== undefined) {
				defaultProject.ragIncludedPaths = legacyRag.includedPaths;
				delete legacyRag.includedPaths;
			}
			if (legacyRag.excludedPaths !== undefined) {
				defaultProject.ragExcludedPaths = legacyRag.excludedPaths;
				delete legacyRag.excludedPaths;
			}
			if (legacyRag.dataScope !== undefined) {
				delete legacyRag.dataScope;
			}
		}
		needsSave = true;
	}

	// ── 전역 디폴트 모델/프롬프트를 프로젝트 단위로 이관 ──
	const legacyConnections = plugin.settings.connections as any;
	const legacyChat = plugin.settings.chat as any;

	for (const p of plugin.settings.projects.list) {
		let projectChanged = false;
		if (p.defaultProviderId === undefined) {
			p.defaultProviderId = legacyConnections?.defaultProviderId || '';
			projectChanged = true;
		}
		if (p.defaultModelId === undefined) {
			p.defaultModelId = legacyConnections?.defaultModelId || '';
			projectChanged = true;
		}
		if (p.systemPromptId === undefined) {
			p.systemPromptId = legacyChat?.activeSystemPromptId || 'default';
			projectChanged = true;
		}
		if (projectChanged) needsSave = true;
	}

	// 구버전 전역 설정 클린업
	if (legacyConnections?.defaultProviderId !== undefined) {
		delete legacyConnections.defaultProviderId;
		needsSave = true;
	}
	if (legacyConnections?.defaultModelId !== undefined) {
		delete legacyConnections.defaultModelId;
		needsSave = true;
	}
	if (legacyChat?.activeSystemPromptId !== undefined) {
		delete legacyChat.activeSystemPromptId;
		needsSave = true;
	}

	return needsSave;
}

/**
 * 모든 마이그레이션을 순차 실행하고 변경이 있으면 저장합니다.
 * @returns 저장이 필요하면 true
 */
export function runMigrations(plugin: LuminaPlugin): boolean {
	let needsSave = false;
	// projects 마이그레이션을 가장 먼저 수행하여 p.ragExcludedPaths 등을 보장
	if (migrateProjects(plugin)) needsSave = true;
	
	if (migrateQuickActions(plugin)) needsSave = true;
	if (migrateExcludedPaths(plugin)) needsSave = true;
	if (migrateMinSimilarity(plugin)) needsSave = true;
	if (migrateMemoryMethod(plugin)) needsSave = true;
	if (migrateContextWindowTurns(plugin)) needsSave = true;
	if (migrateWebSearch(plugin)) needsSave = true;
	if (migrateCanvasSettings(plugin)) needsSave = true;
	return needsSave;
}