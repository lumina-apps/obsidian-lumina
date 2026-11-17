import { App, TFile, Editor } from 'obsidian';
import { debugLogger } from '../../../../../shared/debugLogger';
import { t } from '../../../../../shared/locales/helpers';
import { approvalManager } from '../../../../store/approvalStore';

/** 인라인 Diff 승인 대기 최대 시간 (5분) */
const AUTO_LINK_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/** 한국어 대표 조사 목록 (긴 조사 우선 매칭) */
const KOREAN_PARTICLES =
	'(?:에서|에게|한테|으로|부터|까지|처럼|보다|이란|이라|이며|이고|이나|든지|라도|은|는|이|가|을|를|의|에|께|로|와|과|도|만|란|라|며|고|나)';

function escapeRegExp(string: string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTargetKey(targetPath: string): string {
	return targetPath.replace(/\.md$/i, '').trim().toLowerCase();
}

function buildTermRegex(term: string) {
	const isPureEnglish = /^[a-zA-Z0-9_-]+$/.test(term);
	const escaped = escapeRegExp(term);
	if (isPureEnglish) {
		return new RegExp(`\\b(${escaped})\\b`, 'gi');
	}
	// 비영문/공백 포함 단어: 앞쪽은 어절 경계, 뒤쪽은 어절 경계 또는 한국어 조사 + 어절 경계만 허용하여 복합어 훼손 방지
	return new RegExp(
		`(?<=^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}]|${KOREAN_PARTICLES}(?=$|[^\\p{L}\\p{N}]))`,
		'giu',
	);
}

export function applyAutoLink(content: string, terms: { originalTerm: string, path: string }[]): { newContent: string; linksAdded: number } {
	const protectedRegex = /(^---\r?\n[\s\S]*?\r?\n---(?:$|\r?\n)|```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\r\n]+`|\[\[[\s\S]*?\]\]|\[[\s\S]*?\]\([\s\S]*?\)|<https?:\/\/[^\s>]+>|https?:\/\/[^\s)]+|(?:\r?\n|^)#{1,6}\s+[^\r\n]*|(?:\s|^)#[a-zA-Z0-9_\-/]+)/g;

	const parts = content.split(protectedRegex);
	let textTokens: { text: string; isProtected: boolean }[] = [];
	const alreadyLinkedTargets = new Set<string>();
	
	for (let i = 0; i < parts.length; i++) {
		if (!parts[i]) continue;
		const isProtected = i % 2 !== 0;
		textTokens.push({ text: parts[i], isProtected });

		// 본문에 이미 존재하는 [[링크]] 대상은 중복 생성하지 않도록 수집 (1노트 1링크 원칙)
		if (isProtected && parts[i].startsWith('[[') && parts[i].endsWith(']]')) {
			const inner = parts[i].slice(2, -2);
			const linkTarget = inner.split('|')[0].split('#')[0].trim();
			if (linkTarget) {
				alreadyLinkedTargets.add(normalizeTargetKey(linkTarget));
				const base = linkTarget.split('/').pop();
				if (base) alreadyLinkedTargets.add(normalizeTargetKey(base));
			}
		}
	}

	let linksAdded = 0;

	for (const termObj of terms) {
		const termStr = termObj.originalTerm;
		if (termStr.length < 2) continue;

		const targetKey = normalizeTargetKey(termObj.path);
		const targetBaseKey = normalizeTargetKey(termObj.path.split('/').pop() || termObj.path);
		if (alreadyLinkedTargets.has(targetKey) || alreadyLinkedTargets.has(targetBaseKey)) {
			continue;
		}

		const regex = buildTermRegex(termStr);
		const newTokens: { text: string; isProtected: boolean }[] = [];
		let linkedThisTerm = false;

		for (const token of textTokens) {
			if (token.isProtected || linkedThisTerm) {
				newTokens.push(token);
				continue;
			}

			regex.lastIndex = 0;
			const match = regex.exec(token.text);
			if (match) {
				if (match.index > 0) {
					newTokens.push({ text: token.text.slice(0, match.index), isProtected: false });
				}

				const matchedStr = match[0];
				const linkText = termObj.path === matchedStr 
					? `[[${matchedStr}]]` 
					: `[[${termObj.path}|${matchedStr}]]`;

				newTokens.push({ text: linkText, isProtected: true });
				const afterIndex = match.index + matchedStr.length;
				if (afterIndex < token.text.length) {
					newTokens.push({ text: token.text.slice(afterIndex), isProtected: false });
				}

				linksAdded++;
				linkedThisTerm = true;
				alreadyLinkedTargets.add(targetKey);
				alreadyLinkedTargets.add(targetBaseKey);
			} else {
				newTokens.push(token);
			}
		}
		textTokens = newTokens;
	}

	return { newContent: textTokens.map(t => t.text).join(''), linksAdded };
}

export function calculateAutoLinks(
	app: App,
	file: TFile,
	content: string,
	isPathAllowed?: (path: string) => boolean,
): { newContent: string; linksAdded: number } {
	// 1. Vault 내 모든 노트 제목 및 별명(aliases) 수집
	const allFiles = app.vault.getMarkdownFiles();
	const termsMap = new Map<string, string>(); // key: term lower, value: original file basename

	for (const f of allFiles) {
		if (f.path === file.path) continue; // 자기 자신 제외
		if (isPathAllowed && !isPathAllowed(f.path)) continue;

		const normalizedBasename = f.basename.normalize('NFC');
		const basenameLower = normalizedBasename.toLowerCase();
		if (!termsMap.has(basenameLower)) {
			termsMap.set(basenameLower, normalizedBasename);
		}

		const cache = app.metadataCache.getFileCache(f);
		if (cache?.frontmatter?.aliases) {
			const aliases = Array.isArray(cache.frontmatter.aliases)
				? cache.frontmatter.aliases
				: [cache.frontmatter.aliases];
			
			for (const alias of aliases) {
				if (typeof alias === 'string' && alias.trim()) {
					const normalizedAlias = alias.trim().normalize('NFC');
					const aliasLower = normalizedAlias.toLowerCase();
					if (!termsMap.has(aliasLower)) {
						termsMap.set(aliasLower, normalizedBasename);
					}
				}
			}
		}
	}

	// 2. 검색어 목록 생성 및 길이 내림차순 정렬 (가장 긴 단어부터 매칭)
	const terms = Array.from(termsMap.entries()).map(([lower, path]) => ({
		originalTerm: lower, 
		path
	}));
	terms.sort((a, b) => b.originalTerm.length - a.originalTerm.length);

	// 3. 순수 함수로 치환 수행
	return applyAutoLink(content, terms);
}

export async function processAutoLink(
	app: App,
	file: TFile,
	editor?: Editor,
	requireApproval: boolean = true,
): Promise<{ success: boolean; linksAdded: number; message: string }> {
	try {
		const content = editor ? editor.getValue() : await app.vault.read(file);
		const { newContent, linksAdded } = calculateAutoLinks(app, file, content);

		if (linksAdded === 0) {
			return { success: true, linksAdded: 0, message: t('uiMessages.autoLinkNoChanges') };
		}

		let contentToSave = newContent;
		if (requireApproval) {
			const approval = await approvalManager.requestApproval(
				file.path,
				content,
				newContent,
				{ timeoutMs: AUTO_LINK_APPROVAL_TIMEOUT_MS },
			);
			if (!approval.approved) {
				return { success: true, linksAdded: 0, message: t('uiMessages.autoLinkRejected') };
			}
			contentToSave = approval.content;
		}

		// 4. 저장 (에디터가 주어졌다면 에디터 텍스트 수정, 아니면 파일 직접 수정)
		if (editor) {
			const cursor = editor.getCursor();
			editor.setValue(contentToSave);
			editor.setCursor(cursor);
		} else {
			await app.vault.modify(file, contentToSave);
		}

		return { success: true, linksAdded, message: t('uiMessages.autoLinkSuccess', { count: linksAdded }) };

	} catch (error) {
		debugLogger.logError('mcp', error instanceof Error ? error : new Error(String(error)));
		return {
			success: false,
			linksAdded: 0,
			message: t('uiMessages.autoLinkError', { error: error instanceof Error ? error.message : String(error) }),
		};
	}
}
