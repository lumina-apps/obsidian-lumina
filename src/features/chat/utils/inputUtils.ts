export function splitProviderModel(val: string): [string, string] {
	const idx = val.indexOf("::");
	if (idx === -1) return [val, ""];
	return [val.slice(0, idx), val.slice(idx + 2)];
}

export function detectMention(val: string, cursor: number, lastAt: number): { detected: boolean; query: string; startIndex: number } {
	if (lastAt === -1) return { detected: false, query: "", startIndex: -1 };
	if (lastAt !== 0 && !/\s/.test(val[lastAt - 1])) return { detected: false, query: "", startIndex: -1 };

	const query = val.slice(lastAt + 1, cursor);
	if (/\s/.test(query)) return { detected: false, query: "", startIndex: -1 };

	return { detected: true, query, startIndex: lastAt };
}

export function detectSlashCommand(val: string, cursor: number, lastSlash: number): { detected: boolean; query: string; startIndex: number } {
	if (lastSlash === -1) return { detected: false, query: "", startIndex: -1 };
	if (lastSlash !== 0 && !/\s/.test(val[lastSlash - 1]) && val[lastSlash - 1] !== "\n") return { detected: false, query: "", startIndex: -1 };

	const query = val.slice(lastSlash + 1, cursor);
	if (/\s/.test(query)) return { detected: false, query: "", startIndex: -1 };

	return { detected: true, query, startIndex: lastSlash };
}
