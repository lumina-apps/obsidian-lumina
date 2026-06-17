/**
 * pythonArgsParser.ts
 *
 * Python 스타일 키워드 인자 문자열 파서.
 * 예: `path="foo.md", content="bar"` → `{ path: "foo.md", content: "bar" }`
 *
 * textToolParser.ts에서 분리되어 독립적으로 테스트/유지보수 가능.
 */

// ─── 내부 헬퍼 ────────────────────────────────────────────────────────────────

/** 현재 인덱스부터 공백을 건너뛴다. */
function skipWhitespace(input: string, i: number, len: number): number {
	while (i < len && /\s/.test(input[i])) {
		i++;
	}
	return i;
}

/** 현재 인덱스부터 키 이름([a-zA-Z0-9_-])을 읽는다. */
function readKey(input: string, i: number, len: number): { key: string; next: number } {
	let key = '';
	while (i < len && /[a-zA-Z0-9_-]/.test(input[i])) {
		key += input[i];
		i++;
	}
	return { key, next: i };
}

/** 큰/작은따옴표로 감싼 문자열 값을 읽는다 (삼중따옴표, 이스케이프 지원). */
function readQuotedString(
	input: string,
	i: number,
	len: number,
	quoteChar: string,
): { value: string; next: number } {
	let isTriple = false;
	if (i + 2 < len && input[i + 1] === quoteChar && input[i + 2] === quoteChar) {
		isTriple = true;
		i += 3;
	} else {
		i++;
	}

	let strValue = '';
	while (i < len) {
		if (isTriple) {
			if (i + 2 < len && input[i] === quoteChar && input[i + 1] === quoteChar && input[i + 2] === quoteChar) {
				i += 3;
				break;
			}
		} else {
			if (input[i] === quoteChar && input[i - 1] !== '\\') {
				i++;
				break;
			}
		}
		if (!isTriple && input[i] === '\\' && i + 1 < len) {
			const next = input[i + 1];
			if (next === 'n') strValue += '\n';
			else if (next === 't') strValue += '\t';
			else if (next === 'r') strValue += '\r';
			else strValue += next;
			i += 2;
		} else {
			strValue += input[i];
			i++;
		}
	}
	return { value: strValue, next: i };
}

/** 중괄호/대괄호로 감싼 구조({...}, [...])를 읽는다. 내부 중첩을 추적한다. */
function readBracketedValue(
	input: string,
	i: number,
	len: number,
	openChar: string,
	closeChar: string,
): { value: unknown; next: number } {
	let depth = 0;
	let raw = '';
	while (i < len) {
		const c = input[i];
		raw += c;
		if (c === openChar) depth++;
		else if (c === closeChar) {
			depth--;
			if (depth === 0) {
				i++;
				break;
			}
		}
		i++;
	}
	try {
		return { value: JSON.parse(raw.replace(/'/g, '"')), next: i };
	} catch {
		return { value: raw, next: i };
	}
}

/** 스칼라 값(boolean, null, number, string)을 판별하여 읽는다. */
function readScalar(input: string, i: number, len: number): { value: unknown; next: number } {
	let valStr = '';
	while (i < len && !/[\s,]/.test(input[i]) && input[i] !== ')') {
		valStr += input[i];
		i++;
	}
	valStr = valStr.trim();
	const lower = valStr.toLowerCase();
	if (lower === 'true') return { value: true, next: i };
	if (lower === 'false') return { value: false, next: i };
	if (lower === 'none' || lower === 'null') return { value: null, next: i };
	if (!isNaN(Number(valStr)) && valStr !== '') return { value: Number(valStr), next: i };
	return { value: valStr, next: i };
}

/** 현재 인덱스부터 하나의 값(문자열, 구조체, 스칼라)을 읽는다. */
function readValue(input: string, i: number, len: number): { value: unknown; next: number } {
	const char = input[i];

	if (char === '"' || char === "'") {
		return readQuotedString(input, i, len, char);
	}
	if (char === '{') {
		return readBracketedValue(input, i, len, '{', '}');
	}
	if (char === '[') {
		return readBracketedValue(input, i, len, '[', ']');
	}
	return readScalar(input, i, len);
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * Python 스타일 키워드 인자 문자열을 파싱하여 Record로 반환한다.
 * 예: `path="foo.md", content="bar"` → `{ path: "foo.md", content: "bar" }`
 */
export function parsePythonArgs(argsStr: string): Record<string, unknown> {
	const args: Record<string, unknown> = {};
	const len = argsStr.length;
	let i = 0;

	while (i < len) {
		i = skipWhitespace(argsStr, i, len);
		if (i >= len) break;

		// 키 읽기
		const keyResult = readKey(argsStr, i, len);
		if (!keyResult.key) {
			i++;
			continue;
		}
		i = keyResult.next;

		// '=' 건너뛰기
		i = skipWhitespace(argsStr, i, len);
		if (i >= len || argsStr[i] !== '=') {
			continue;
		}
		i++; // skip '='
		i = skipWhitespace(argsStr, i, len);

		if (i >= len) break;

		// 값 읽기
		const valResult = readValue(argsStr, i, len);
		args[keyResult.key] = valResult.value;
		i = valResult.next;

		// 쉼표 건너뛰기
		i = skipWhitespace(argsStr, i, len);
		if (i < len && argsStr[i] === ',') {
			i++;
		}
	}

	return args;
}

/**
 * Python 스타일 함수 호출 문자열을 파싱하여 tool name과 arguments를 반환한다.
 * 예: `write_note(path="foo.md", content="bar")` → `{ name: "write_note", arguments: {...} }`
 */
export function parsePythonCall(code: string): { name: string; arguments: Record<string, unknown> } | null {
	const trimmed = code.trim();

	// print() 래퍼 제거 (LLM 출력 정리용)
	const inner = (() => {
		if (trimmed.startsWith('print(') && trimmed.endsWith(')')) {
			return trimmed.substring(6, trimmed.length - 1).trim();
		}
		return trimmed;
	})();

	const callMatch = inner.match(/^([a-zA-Z0-9_-]+)\s*\(([\s\S]*)\)$/);
	if (!callMatch) return null;

	const name = callMatch[1];
	const argsString = callMatch[2].trim();
	const args = parsePythonArgs(argsString);

	return { name, arguments: args };
}