import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
import * as llmProviders from '../../../core/llm-providers';
import { sessionModelId, sessionProviderId } from '../../../core/store/chatStore';
import type LuminaPlugin from '../../../main';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import {
	assembleVoiceNoteMarkdown,
	buildVoiceFormattingMessages,
	extractUserMemoDiff,
} from '../llm/voicePrompts';
import { processTranscriptToNote, resolveVoiceLlmProviderAndModel } from '../llm/voiceNoteProcessor';
import { DEFAULT_VOICE_PREFERENCES } from '../voicePreferences';

function makeNoteFile(path: string, basename: string): TFile {
	const f = new TFile();
	f.path = path;
	f.name = `${basename}.md`;
	f.basename = basename;
	f.extension = 'md';
	return f;
}

describe('voicePrompts & voiceNoteProcessor', () => {
	beforeEach(() => {
		sessionProviderId.set(null);
		sessionModelId.set(null);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('extractUserMemoDiff는 녹음 도중 추가된 사용자 메모 라인만 추출한다', () => {
		const before = '# 주간 회의\n기존 메모\n';
		const after = '# 주간 회의\n기존 메모\n- 일정 금요일 연기\n- 디자인 시안 확인';
		const diff = extractUserMemoDiff(before, after);
		expect(diff).toBe('- 일정 금요일 연기\n- 디자인 시안 확인');
		expect(extractUserMemoDiff(before, before)).toBe('');
	});

	it('buildVoiceFormattingMessages는 3종 템플릿·사용자 메모·고유명사 사전을 프롬프트에 주입한다', () => {
		const msgsMeeting = buildVoiceFormattingMessages({
			templateId: 'meeting',
			rawTranscript: '회의 내용',
			segments: [{ startSec: 12, endSec: 20, text: '일정을 금요일로 옮깁니다' }],
			userMemoDiff: '- 금요일 연기',
			activeNoteTitle: '프로젝트 A',
			customVocabulary: ['Lumina', 'Obsidian'],
			vaultNoteTitles: ['프로젝트 A', '디자인 가이드'],
		});

		expect(msgsMeeting[0].content).toContain('Meeting / Lecture Notes');
		expect(msgsMeeting[0].content).toContain('<user_notes>');
		expect(msgsMeeting[1].content).toContain('<active_note_title>프로젝트 A</active_note_title>');
		expect(msgsMeeting[1].content).toContain('Lumina, Obsidian');
		expect(msgsMeeting[1].content).toContain('[00:12] 일정을 금요일로 옮깁니다');

		const msgsClean = buildVoiceFormattingMessages({
			templateId: 'clean',
			rawTranscript: '생각 스케치',
			segments: [],
		});
		expect(msgsClean[0].content).toContain('Clean Smart Note');

		const msgsVerbatim = buildVoiceFormattingMessages({
			templateId: 'verbatim',
			rawTranscript: '받아쓰기 원문',
			segments: [],
		});
		expect(msgsVerbatim[0].content).toContain('Verbatim Cleanup');
	});

	it('assembleVoiceNoteMarkdown은 오디오 임베드, <think> 제거, 타임스탬프 접기 콜아웃을 조립한다', () => {
		const md = assembleVoiceNoteMarkdown({
			formattedBody: '<think>내부 추론</think>\n```markdown\n> [!summary] 요약\n> - 핵심 내용\n```',
			segments: [
				{ startSec: 0, endSec: 5, text: '첫 문장' },
				{ startSec: 75, endSec: 82, text: '둘째 문장' },
			],
			rawTranscript: '첫 문장 둘째 문장',
			audioVaultPath: 'Attachments/Voice/rec.webm',
			includeRawTranscript: true,
		});

		expect(md).toContain('![[Attachments/Voice/rec.webm]]');
		expect(md).not.toContain('내부 추론');
		expect(md).not.toContain('```markdown');
		expect(md).toContain('> [!summary] 요약');
		expect(md).toContain('> [!note]- ');
		expect(md).toContain('**[00:00](#lumina-ts=0)** 첫 문장');
		expect(md).toContain('**[01:15](#lumina-ts=75)** 둘째 문장');
	});

	it('processTranscriptToNote는 연결된 LLM을 사용해 정리하고 자동 위키링크([[...]])를 적용한다', async () => {
		const targetFile = makeNoteFile('Notes/Daily.md', 'Daily');
		const projectFile = makeNoteFile('Projects/Lumina.md', 'Lumina');
		const chatSpy = vi.fn().mockResolvedValue({
			content: '## 회의 정리\n오늘 Lumina 프로젝트 일정을 논의했습니다.',
		});
		vi.spyOn(llmProviders, 'createProvider').mockReturnValue({
			providerId: 'p1',
			listModels: vi.fn(),
			chat: chatSpy,
			stream: vi.fn(),
			embed: vi.fn(),
		});

		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as LuminaPlugin['settings'];
		const providerCfg: LLMProviderConfig = {
			id: 'p1',
			type: 'anthropic',
			credential: 'sk-ant',
			availableModels: ['claude-sonnet-4'],
			isVerified: true,
		};
		settings.connections.providers = [providerCfg];

		const plugin = {
			settings,
			app: {
				vault: {
					getMarkdownFiles: () => [targetFile, projectFile],
				},
				metadataCache: {
					getFileCache: () => null,
				},
			},
		} as unknown as LuminaPlugin;

		const out = await processTranscriptToNote({
			plugin,
			prefs: { ...DEFAULT_VOICE_PREFERENCES, autoWikiLink: true },
			templateId: 'clean',
			rawTranscript: '오늘 루미나 프로젝트 일정을 논의했습니다.',
			segments: [{ startSec: 0, endSec: 4, text: '오늘 루미나 프로젝트 일정을 논의했습니다.' }],
			targetFile,
		});

		expect(out.usedLlm).toBe(true);
		expect(chatSpy).toHaveBeenCalledTimes(1);
		expect(out.formattedBody).toContain('[[Lumina]]');
	});

	it('연결된 LLM이 없으면 원문 폴백(usedLlm: false)으로 안전 처리한다', async () => {
		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as LuminaPlugin['settings'];
		settings.connections.providers = [];

		const plugin = {
			settings,
			app: {
				vault: { getMarkdownFiles: () => [] },
				metadataCache: { getFileCache: () => null },
			},
		} as unknown as LuminaPlugin;

		expect(resolveVoiceLlmProviderAndModel(plugin, DEFAULT_VOICE_PREFERENCES)).toBeNull();

		const out = await processTranscriptToNote({
			plugin,
			prefs: { ...DEFAULT_VOICE_PREFERENCES, autoWikiLink: false },
			templateId: 'clean',
			rawTranscript: '연결된 모델 없이 녹음된 텍스트',
			segments: [],
			targetFile: null,
		});

		expect(out.usedLlm).toBe(false);
		expect(out.formattedBody).toBe('연결된 모델 없이 녹음된 텍스트');
	});

	it('템플릿별 하이브리드 라우팅: verbatim은 Task 모델을 우선하고, clean/meeting은 주력 모델을 쓰되 느린 추론 모델은 Task 모델로 우회한다', () => {
		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as LuminaPlugin['settings'];
		settings.connections.providers = [
			{
				id: 'main-prov',
				type: 'anthropic',
				credential: 'sk-ant',
				availableModels: ['claude-sonnet-4'],
				isVerified: true,
			},
			{
				id: 'task-prov',
				type: 'openai',
				credential: 'sk-oai',
				availableModels: ['gpt-4o-mini', 'o3-mini'],
				isVerified: true,
			},
		];
		settings.connections.taskProviderId = 'task-prov';
		settings.connections.taskModelId = 'gpt-4o-mini';

		const plugin = { settings } as unknown as LuminaPlugin;

		// 현재 채팅 세션이 claude-sonnet-4일 때:
		sessionProviderId.set('main-prov');
		sessionModelId.set('claude-sonnet-4');

		// 1) verbatim(받아쓰기)은 빠른 Task 모델(gpt-4o-mini)을 선택
		const verbatimChoice = resolveVoiceLlmProviderAndModel(plugin, DEFAULT_VOICE_PREFERENCES, 'verbatim');
		expect(verbatimChoice?.modelId).toBe('gpt-4o-mini');

		// 2) clean / meeting은 고품질 주력 채팅 모델(claude-sonnet-4)을 선택
		const cleanChoice = resolveVoiceLlmProviderAndModel(plugin, DEFAULT_VOICE_PREFERENCES, 'clean');
		expect(cleanChoice?.modelId).toBe('claude-sonnet-4');

		// 3) 만약 현재 채팅 세션이 느린 추론 모델(o3-mini)이면 자동으로 빠른 Task 모델(gpt-4o-mini)로 우회
		sessionProviderId.set('task-prov');
		sessionModelId.set('o3-mini');
		const bypassedChoice = resolveVoiceLlmProviderAndModel(plugin, DEFAULT_VOICE_PREFERENCES, 'meeting');
		expect(bypassedChoice?.modelId).toBe('gpt-4o-mini');
	});

	it('새 노트(targetFile=null)에서도 aliases 프론트매터를 포함한 자동 위키링크를 적용하고 CLI 프로바이더를 우회한다', async () => {
		const luminaFile = makeNoteFile('Projects/Lumina.md', 'Lumina');
		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as LuminaPlugin['settings'];
		settings.connections.providers = [
			{
				id: 'cli-prov',
				type: 'cli-claude-code',
				credential: '',
				availableModels: ['claude-sonnet'],
				isVerified: true,
			},
			{
				id: 'api-prov',
				type: 'openai',
				credential: 'sk-1',
				availableModels: ['gpt-4o-mini'],
				isVerified: true,
			},
		];

		// 1) CLI 프로바이더가 활성 세션이어도 일반 API 프로바이더를 우선 선택
		sessionProviderId.set('cli-prov');
		sessionModelId.set('claude-sonnet');
		const picked = resolveVoiceLlmProviderAndModel({ settings } as unknown as LuminaPlugin, DEFAULT_VOICE_PREFERENCES, 'clean');
		expect(picked?.providerConfig.id).toBe('api-prov');

		// 2) targetFile=null + aliases 자동 위키링크 (LLM 연결 및 빈 응답 원문 폴백 포함)
		const chatSpy = vi.fn().mockResolvedValue({ content: '   ' });
		vi.spyOn(llmProviders, 'createProvider').mockReturnValue({
			providerId: 'api-prov',
			chat: chatSpy,
		} as unknown as ReturnType<typeof llmProviders.createProvider>);

		const plugin = {
			settings,
			app: {
				vault: { getMarkdownFiles: () => [luminaFile] },
				metadataCache: {
					getFileCache: () => ({ frontmatter: { aliases: ['루미나', 'Lumina App'] } }),
				},
			},
		} as unknown as LuminaPlugin;

		const out = await processTranscriptToNote({
			plugin,
			prefs: { ...DEFAULT_VOICE_PREFERENCES, autoWikiLink: true },
			templateId: 'clean',
			rawTranscript: '새 음성 노트에서 루미나 앱 기능을 테스트했습니다.',
			segments: [],
			targetFile: null,
		});

		expect(out.usedLlm).toBe(true);
		expect(out.formattedBody).toContain('[[Lumina|루미나]]');

		// 3) LLM 호출 자체가 실패하면 에러를 호출자에게 전파
		chatSpy.mockRejectedValueOnce(new Error('LLM 503 Unavailable'));
		await expect(
			processTranscriptToNote({
				plugin,
				prefs: DEFAULT_VOICE_PREFERENCES,
				templateId: 'clean',
				rawTranscript: '실패 테스트',
				segments: [],
				targetFile: null,
			}),
		).rejects.toThrow('LLM 503 Unavailable');
	});
});
