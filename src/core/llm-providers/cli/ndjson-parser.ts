import type { AutopilotEvent } from '../../../shared/types/autopilot.types';

/**
 * ANSI Escape 코드를 안전하게 제거합니다.
 */
export function stripAnsiCodes(str: string): string {
	return str
		.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
		.replace(/\u001b\]8;;.*?\u001b\\/g, '')
		.replace(/\r/g, '');
}

/**
 * CLI 응답 객체(JSON 구조 또는 일반 문자열)로부터 텍스트를 재귀적/포괄적으로 추출합니다.
 */
export function extractTextFromUnknown(val: unknown): string {
	if (val === null || val === undefined) return '';
	if (typeof val === 'string') return stripAnsiCodes(val);
	if (typeof val === 'number' || typeof val === 'boolean') return String(val);
	if (Array.isArray(val)) {
		return val
			.map((item) => extractTextFromUnknown(item))
			.filter(Boolean)
			.join('\n');
	}
	if (typeof val === 'object') {
		const obj = val as Record<string, unknown>;

		// 0. OpenCode part support
		if (obj.part && typeof obj.part === 'object') {
			const p = obj.part as Record<string, unknown>;
			if (typeof p.text === 'string') return stripAnsiCodes(p.text);
			if (typeof p.content === 'string') return stripAnsiCodes(p.content);
		}

		// 0.1 Codex item support
		if (obj.item && typeof obj.item === 'object') {
			const it = obj.item as Record<string, unknown>;
			if (typeof it.text === 'string') return stripAnsiCodes(it.text);
			if (typeof it.content === 'string') return stripAnsiCodes(it.content);
			if (typeof it.message === 'string') return stripAnsiCodes(it.message);
		}

		// 1. Anthropic delta
		if (obj.delta && typeof obj.delta === 'object') {
			const d = obj.delta as Record<string, unknown>;
			if (typeof d.text === 'string') return stripAnsiCodes(d.text);
			if (typeof d.content === 'string') return stripAnsiCodes(d.content);
		}

		// 2. Direct text fields
		if (typeof obj.text === 'string') return stripAnsiCodes(obj.text);
		if (typeof obj.delta === 'string') return stripAnsiCodes(obj.delta);
		if (typeof obj.rawText === 'string') return stripAnsiCodes(obj.rawText);
		if (typeof obj.output === 'string') return stripAnsiCodes(obj.output);
		if (typeof obj.result === 'string') return stripAnsiCodes(obj.result);
		if (typeof obj.message === 'string') return stripAnsiCodes(obj.message);

		// 3. Nested content/message fields
		if (obj.content !== undefined) {
			const extracted = extractTextFromUnknown(obj.content);
			if (extracted) return extracted;
		}
		if (obj.message !== undefined && typeof obj.message === 'object') {
			const extracted = extractTextFromUnknown(obj.message);
			if (extracted) return extracted;
		}
		if (obj.result !== undefined && typeof obj.result === 'object') {
			const extracted = extractTextFromUnknown(obj.result);
			if (extracted) return extracted;
		}
	}
	return '';
}

/**
 * 일반 텍스트 라인에서 에이전트의 사고(Thinking), 파일 읽기, 편집, 명령어 실행을 자동 구조화합니다.
 */
export function parseRawCliLine(line: string, raw: unknown): AutopilotEvent | null {
	const text = stripAnsiCodes(line).trim();
	if (!text) return null;

	// 1. 사고 과정 (Thinking / Reasoning)
	const thinkMatch = text.match(/^(?:thinking|thought|reasoning):\s*(.+)$/i);
	if (thinkMatch) {
		return { type: 'thinking', content: thinkMatch[1] + '\n', raw };
	}

	// 2. 파일 읽기 / 검사 (File Read)
	const readMatch = text.match(/^(?:reading|viewing|inspecting|loading)\s+(?:file\s+)?([^\s:]+)/i);
	if (readMatch) {
		return {
			type: 'tool_call',
			toolCall: { name: 'Read', arguments: { path: readMatch[1] } },
			raw,
		};
	}

	// 3. 파일 편집 / 작성 (File Edit)
	const editMatch = text.match(/^(?:editing|modifying|writing|updating)\s+(?:file\s+)?([^\s:]+)/i);
	if (editMatch) {
		return {
			type: 'tool_call',
			toolCall: { name: 'Edit', arguments: { path: editMatch[1] } },
			raw,
		};
	}

	// 4. 터미널 명령어 실행 (Command / Bash)
	const cmdMatch = text.match(/^(?:running|executing)\s+(?:command\s+)?[:$]?\s*(.+)$/i);
	if (cmdMatch) {
		return {
			type: 'tool_call',
			toolCall: { name: 'Bash', arguments: { command: cmdMatch[1] } },
			raw,
		};
	}

	// 5. 검색 (Search / Grep)
	const searchMatch = text.match(/^(?:searching|finding|grepping)\s+(?:for\s+)?[:$]?\s*(.+)$/i);
	if (searchMatch) {
		return {
			type: 'tool_call',
			toolCall: { name: 'Search', arguments: { query: searchMatch[1] } },
			raw,
		};
	}

	return { type: 'text', content: text + '\n', raw };
}

/**
 * NDJSON (Newline Delimited JSON) 스트림 파서
 * stdout 스트림으로부터 들어오는 불완전한 청크들을 버퍼링하여 완전한 JSON 라인별로 파싱합니다.
 */
export class NdjsonParser {
	private buffer = '';

	/**
	 * 새로운 텍스트 청크를 받아 완전한 라인들의 파싱된 객체 배열을 반환합니다.
	 */
	public parseChunk(chunk: string): unknown[] {
		this.buffer += chunk;
		const results: unknown[] = [];
		const lines = this.buffer.split('\n');

		// 마지막 요소는 아직 줄바꿈을 만나지 못한 불완전한 버퍼
		this.buffer = lines.pop() ?? '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			// 1. 단일 JSON 라인 파싱 시도
			try {
				const parsed = JSON.parse(trimmed);
				results.push(parsed);
				continue;
			} catch {
				const stripped = stripAnsiCodes(trimmed);
				if (stripped !== trimmed) {
					try {
						const parsed = JSON.parse(stripped);
						results.push(parsed);
						continue;
					} catch {
						// 단일 JSON 파싱 실패 시 임베디드 시도
					}
				}
			}

			// 2. 라인 내에 포함된 임베디드 JSON 객체 추출 (예: 로그 프리픽스 뒤의 JSON 또는 연결된 다중 JSON)
			const jsonMatches = this.extractEmbeddedJson(trimmed);
			if (jsonMatches.length > 0) {
				for (const item of jsonMatches) {
					results.push(item);
				}
			} else {
				// 3. 순수 텍스트 라인인 경우
				results.push({ rawText: stripAnsiCodes(trimmed) });
			}
		}

		return results;
	}

	/**
	 * 문자열 내에 포함된 유효한 JSON 오브젝트들을 찾아 파싱합니다.
	 */
	private extractEmbeddedJson(str: string): unknown[] {
		const extracted: unknown[] = [];
		let startIndex = str.indexOf('{');
		while (startIndex !== -1) {
			let braceCount = 0;
			let inString = false;
			let escape = false;
			let endIndex = -1;

			for (let i = startIndex; i < str.length; i++) {
				const char = str[i];
				if (escape) {
					escape = false;
					continue;
				}
				if (char === '\\') {
					escape = true;
					continue;
				}
				if (char === '"') {
					inString = !inString;
					continue;
				}
				if (!inString) {
					if (char === '{') braceCount++;
					else if (char === '}') {
						braceCount--;
						if (braceCount === 0) {
							endIndex = i;
							break;
						}
					}
				}
			}

			if (endIndex !== -1) {
				const jsonCandidate = str.substring(startIndex, endIndex + 1);
				try {
					const parsed = JSON.parse(jsonCandidate);
					extracted.push(parsed);
				} catch {
					// ignore parsing failure
				}
				startIndex = str.indexOf('{', endIndex + 1);
			} else {
				break;
			}
		}
		return extracted;
	}

	/**
	 * 스트림 종료 시 버퍼에 남아있는 마지막 내용을 반환합니다.
	 */
	public flush(): unknown[] {
		const results: unknown[] = [];
		const trimmed = this.buffer.trim();
		this.buffer = '';
		if (trimmed) {
			try {
				results.push(JSON.parse(trimmed));
			} catch {
				const jsonMatches = this.extractEmbeddedJson(trimmed);
				if (jsonMatches.length > 0) {
					for (const item of jsonMatches) {
						results.push(item);
					}
				} else {
					results.push({ rawText: stripAnsiCodes(trimmed) });
				}
			}
		}
		return results;
	}

	/**
	 * 버퍼 초기화
	 */
	public reset(): void {
		this.buffer = '';
	}
}
