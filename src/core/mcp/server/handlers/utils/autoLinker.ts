import { App, TFile, Editor } from 'obsidian';

function escapeRegExp(string: string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTermRegex(term: string) {
	// 순수 영문/숫자 혼합 단어인 경우 단어 경계(\b)를 사용해 오작동을 방지
	// 한글 등 타 언어 포함 시 띄어쓰기나 조사 결합이 잦으므로 경계 미사용
	const isPureEnglish = /^[a-zA-Z0-9_-]+$/.test(term);
	const escaped = escapeRegExp(term);
	if (isPureEnglish) {
		return new RegExp(`\\b(${escaped})\\b`, 'gi');
	} else {
		return new RegExp(`(${escaped})`, 'gi');
	}
}

export function applyAutoLink(content: string, terms: { originalTerm: string, path: string }[]): { newContent: string; linksAdded: number } {
	const protectedRegex = /(^---\n[\s\S]*?\n---(?:$|\n)|```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|\[\[.*?\]\]|\[.*?\]\(.*?\)|<https?:\/\/[^\s>]+>|https?:\/\/[^\s)]+)/g;

	const parts = content.split(protectedRegex);
	let textTokens: { text: string; isProtected: boolean }[] = [];
	
	for (let i = 0; i < parts.length; i++) {
		if (!parts[i]) continue;
		textTokens.push({ text: parts[i], isProtected: i % 2 !== 0 });
	}

	let linksAdded = 0;

	for (const termObj of terms) {
		const termStr = termObj.originalTerm;
		if (termStr.length < 2) continue;

		const regex = buildTermRegex(termStr);
		const newTokens: { text: string; isProtected: boolean }[] = [];

		for (const token of textTokens) {
			if (token.isProtected) {
				newTokens.push(token);
				continue;
			}

			let lastIndex = 0;
			regex.lastIndex = 0;
			let match;

			while ((match = regex.exec(token.text)) !== null) {
				if (match.index > lastIndex) {
					newTokens.push({ text: token.text.slice(lastIndex, match.index), isProtected: false });
				}

				const matchedStr = match[0];
				const linkText = termObj.path === matchedStr 
					? `[[${matchedStr}]]` 
					: `[[${termObj.path}|${matchedStr}]]`;

				newTokens.push({ text: linkText, isProtected: true });
				linksAdded++;
				lastIndex = regex.lastIndex;
			}

			if (lastIndex < token.text.length) {
				newTokens.push({ text: token.text.slice(lastIndex), isProtected: false });
			}
		}
		textTokens = newTokens;
	}

	return { newContent: textTokens.map(t => t.text).join(''), linksAdded };
}

export async function processAutoLink(app: App, file: TFile, editor?: Editor): Promise<{ success: boolean; linksAdded: number; message: string }> {
	try {
		const content = editor ? editor.getValue() : await app.vault.read(file);

		// 1. Vault 내 모든 노트 제목 및 별명(aliases) 수집
		const allFiles = app.vault.getMarkdownFiles();
		const termsMap = new Map<string, string>(); // key: term lower, value: original file basename

		for (const f of allFiles) {
			if (f.path === file.path) continue; // 자기 자신 제외

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
		const { newContent, linksAdded } = applyAutoLink(content, terms);

		if (linksAdded === 0) {
			return { success: true, linksAdded: 0, message: "추가할 링크가 없습니다." };
		}

		// 4. 저장 (에디터가 주어졌다면 에디터 텍스트 수정, 아니면 파일 직접 수정)
		if (editor) {
			const cursor = editor.getCursor();
			editor.setValue(newContent);
			editor.setCursor(cursor);
		} else {
			await app.vault.modify(file, newContent);
		}

		return { success: true, linksAdded, message: `총 ${linksAdded}개의 백링크가 생성되었습니다.` };

	} catch (error) {
		console.error('[Lumina] AutoLink Error:', error);
		return { success: false, linksAdded: 0, message: `오류 발생: ${error}` };
	}
}
