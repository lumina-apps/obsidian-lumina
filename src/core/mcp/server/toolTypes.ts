import type LuminaPlugin from '../../../main';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * luminaMcpServer 모듈 내부 타입 정의.
 * any 사용을 배제하고 모든 입력값에 명시적 타입을 부여합니다.
 */

/** 등록된 툴 이름 (string literal union) */
export type ToolName =
	| 'read_active_note'
	| 'read_note'
	| 'create_note'
	| 'search_notes'
	| 'append_to_note'
	| 'read_daily_note'
	| 'append_to_daily_note'
	| 'list_notes'
	| 'rag_search'
	| 'replace_note'
	| 'patch_note'
	| 'delete_note'
	| 'move_note'
	| 'get_backlinks'
	| 'update_frontmatter'
	| 'get_note_metadata'
	| 'list_attachments'
	| 'save_attachment'
	| 'execute_code'
	| 'run_note_code_block'
	| 'list_tags';

/** CallTool 요청에서 전달되는 원시 인자 */
export type ToolArguments = Record<string, unknown>;

/** MCP 툴 실행 결과 (MCP SDK CallToolResult 타입 재노출) */
export type ToolResult = CallToolResult;

/** 툴 핸들러가 공통으로 필요로 하는 의존성 컨텍스트 */
export interface ToolHandlerContext {
	plugin: LuminaPlugin;
	/** 읽기 제한 글자 수 */
	limitRead: number;
	/** 추가 제한 글자 수 */
	limitAppend: number;
	/** 검색 스니펫 길이 */
	snippetLen: number;
	/** 검색 최대 결과 수 */
	maxResults: number;
}

/** 설정에서 추출한 제한 값 모음 */
export interface McpLimits {
	limitRead: number;
	limitAppend: number;
	snippetLen: number;
	maxResults: number;
}
