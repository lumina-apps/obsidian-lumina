// @modelcontextprotocol/sdk 내부 하위 호환 모듈(zod-compat, zod-json-schema-compat)이
// 정적 import하는 zod/v3 및 zod-to-json-schema용 경량 스텁입니다.
// 프로젝트 전체에서 Zod v4만 사용하므로 런타임에 v3 분기는 호출되지 않습니다.
export function object() {
	return {};
}

export function zodToJsonSchema() {
	return {};
}

export default { object, zodToJsonSchema };
