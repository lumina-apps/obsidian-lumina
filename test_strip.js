const text = `<think>\n사용자가 "주인공정보 요약해줘"라고 요청했습니다.\n</think>\n# 건축/건축사`;
const thinkTags = ['think', 'thinking', 'response', 'thought', 'reasoning'];
let result = text;
for (const tag of thinkTags) {
	const pattern = new RegExp(`<${tag}>([\\s\\S]*?)(?:<\\/${tag}>|$)`, 'gi');
	result = result.replace(pattern, '');
}
console.log(result.trim());
