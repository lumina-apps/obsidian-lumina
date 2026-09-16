export function splitProviderModel(val: string): [string, string] {
	const idx = val.indexOf("::");
	if (idx === -1) return [val, ""];
	return [val.slice(0, idx), val.slice(idx + 2)];
}

export function detectMention(val: string, cursor: number, lastAt: number): { detected: boolean; query: string; startIndex: number } {
	if (lastAt === -1) return { detected: false, query: "", startIndex: -1 };
	if (lastAt !== 0 && !/\s/.test(val[lastAt - 1])) return { detected: false, query: "", startIndex: -1 };

	const query = val.slice(lastAt + 1, cursor);
	// 줄바꿈이 포함되었거나, @ 바로 뒤가 공백이거나, 너무 긴 쿼리는 멘션으로 보지 않음
	if (query.includes("\n") || query.startsWith(" ") || query.length > 50) {
		return { detected: false, query: "", startIndex: -1 };
	}

	return { detected: true, query, startIndex: lastAt };
}

export function detectSlashCommand(val: string, cursor: number, lastSlash: number): { detected: boolean; query: string; startIndex: number } {
	if (lastSlash === -1) return { detected: false, query: "", startIndex: -1 };
	if (lastSlash !== 0 && !/\s/.test(val[lastSlash - 1])) return { detected: false, query: "", startIndex: -1 };

	const query = val.slice(lastSlash + 1, cursor);
	if (query.includes("\n") || query.startsWith(" ")) {
		return { detected: false, query: "", startIndex: -1 };
	}

	const trimmed = query.trim();
	// 슬래시 명령어 내부의 공백(인자 형태) 또는 30자 초과는 명령어 목록 검색 대상에서 제외
	if (/\s/.test(trimmed) || trimmed.length > 30) {
		return { detected: false, query: "", startIndex: -1 };
	}

	return { detected: true, query: trimmed, startIndex: lastSlash };
}
