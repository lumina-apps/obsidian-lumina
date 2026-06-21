import { t } from '../../../shared/locales/helpers';
import type { ToolName } from './toolTypes';

/** 툴 메타데이터 (ListTools 응답용) */
export interface ToolDefinition {
	name: ToolName;
	description: string;
	inputSchema: {
		type: 'object';
		properties: Record<string, unknown>;
		required?: string[];
	};
}

/**
 * 등록된 모든 툴의 메타데이터 정의를 반환합니다.
 * MCP ListTools 요청 핸들러에서 사용됩니다.
 */
export function getToolDefinitions(): ToolDefinition[] {
	return [
		{
			name: 'read_active_note',
			description: t('mcpServerTools.read_active_note.desc'),
			inputSchema: { type: 'object', properties: {} },
		},
		{
			name: 'read_note',
			description: t('mcpServerTools.read_note.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: t('mcpServerTools.read_note.argPath') },
				},
				required: ['path'],
			},
		},
		{
			name: 'create_note',
			description: t('mcpServerTools.create_note.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: t('mcpServerTools.create_note.argPath') },
					content: { type: 'string', description: t('mcpServerTools.create_note.argContent') },
				},
				required: ['path', 'content'],
			},
		},
		{
			name: 'search_notes',
			description: t('mcpServerTools.search_notes.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: t('mcpServerTools.search_notes.argQuery') },
					tags: { type: 'array', items: { type: 'string' }, description: 'List of tags to filter by (e.g. ["#idea", "#task"]).' }
				},
				required: ['query'],
			},
		},
		{
			name: 'append_to_note',
			description: t('mcpServerTools.append_to_note.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: t('mcpServerTools.append_to_note.argPath') },
					content: { type: 'string', description: t('mcpServerTools.append_to_note.argContent') },
				},
				required: ['path', 'content'],
			},
		},
		{
			name: 'read_daily_note',
			description: t('mcpServerTools.read_daily_note.desc'),
			inputSchema: { type: 'object', properties: {} },
		},
		{
			name: 'append_to_daily_note',
			description: t('mcpServerTools.append_to_daily_note.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					content: { type: 'string', description: t('mcpServerTools.append_to_daily_note.argContent') },
				},
				required: ['content'],
			},
		},
		{
			name: 'list_notes',
			description: t('mcpServerTools.list_notes.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: t('mcpServerTools.list_notes.argPath') },
				},
				required: [],
			},
		},
		{
			name: 'rag_search',
			description: t('mcpServerTools.rag_search.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: t('mcpServerTools.rag_search.argQuery') },
					top_k: { type: 'number', description: t('mcpServerTools.rag_search.argTopK') },
					min_similarity: { type: 'number', description: t('mcpServerTools.rag_search.argMinSimilarity') },
				},
				required: ['query'],
			},
		},
		{
			name: 'replace_note',
			description: 'Replace the entire content of an existing note.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to the note' },
					content: { type: 'string', description: 'New content to replace the old content completely' }
				},
				required: ['path', 'content']
			}
		},
		{
			name: 'patch_note',
			description: 'Apply one or more text replacements to a note. Prefer using the patches array to batch multiple changes into a single tool call — this is more efficient and presents all changes to the user at once as a unified diff.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to the note.' },
					patches: {
						type: 'array',
						description: 'Preferred: list of replacements to apply atomically. All patches are applied in order and shown to the user as a single unified diff.',
						items: {
							type: 'object',
							properties: {
								target: { type: 'string', description: 'Exact string to find. Must match exactly including whitespace.' },
								replacement: { type: 'string', description: 'String to replace the target with.' }
							},
							required: ['target', 'replacement']
						}
					},
					target: { type: 'string', description: 'Single patch: exact string to find and replace. Must match exactly including whitespace.' },
					replacement: { type: 'string', description: 'Single patch: string to replace the target with.' }
				},
				required: ['path']
			}
		},
		{
			name: 'delete_note',
			description: 'Delete a note.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to the note to delete' }
				},
				required: ['path']
			}
		},
		{
			name: 'move_note',
			description: 'Move or rename a note.',
			inputSchema: {
				type: 'object',
				properties: {
					sourcePath: { type: 'string', description: 'Current path to the note' },
					targetPath: { type: 'string', description: 'New path for the note' }
				},
				required: ['sourcePath', 'targetPath']
			}
		},
		{
			name: 'get_backlinks',
			description: 'Get a list of notes that link to the specified note.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to the note' }
				},
				required: ['path']
			}
		},
		{
			name: 'update_frontmatter',
			description: 'Update a frontmatter property in a note.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to the note' },
					key: { type: 'string', description: 'Frontmatter key to update' },
					value: { type: 'string', description: 'New value for the frontmatter key' }
				},
				required: ['path', 'key', 'value']
			}
		},
		{
			name: 'get_note_metadata',
			description: 'Get metadata (frontmatter, tags, creation date, etc) for a note.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to the note' }
				},
				required: ['path']
			}
		},
		{
			name: 'list_attachments',
			description: 'List all attachment files (images, pdfs) inside the vault, or linked in a note.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Optional path to a note to find attachments linked within it. If empty, lists all vault attachments.' }
				},
				required: []
			}
		},
		{
			name: 'save_attachment',
			description: 'Save a binary attachment file from base64 string.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path where to save the attachment' },
					base64Data: { type: 'string', description: 'Base64 encoded file data' }
				},
				required: ['path', 'base64Data']
			}
		},
		{
			name: 'execute_code',
			description: 'Execute javascript/typescript code in a secure sandbox.',
			inputSchema: {
				type: 'object',
				properties: {
					code: { type: 'string', description: 'JavaScript/TypeScript code to execute' }
				},
				required: ['code']
			}
		},
		{
			name: 'run_note_code_block',
			description: 'Run a specific code block from a note in the sandbox.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to the note containing the code block' },
					blockIndex: { type: 'number', description: '0-based index of the code block in the note to execute' }
				},
				required: ['path', 'blockIndex']
			}
		},
		{
			name: 'list_tags',
			description: 'List all tags used in the vault.',
			inputSchema: {
				type: 'object',
				properties: {},
				required: []
			}
		},
		{
			name: 'create_canvas',
			description: 'Create an Obsidian Canvas file (.canvas) with nodes and edges.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to create/modify the canvas file. .canvas extension is appended if missing.' },
					nodes: {
						type: 'array',
						description: 'List of canvas nodes. Each node must have type: "text", "file", or "group". id, x, y, width, height are optional.',
						items: { type: 'object' }
					},
					edges: {
						type: 'array',
						description: 'List of canvas edges connecting nodes. (optional)',
						items: { type: 'object' }
					},
					layout: {
						type: 'string',
						description: 'Layout strategy for unpositioned nodes. ("grid" | "horizontal" | "vertical")',
						enum: ['grid', 'horizontal', 'vertical']
					},
					overwrite: {
						type: 'boolean',
						description: 'Whether to overwrite if the file already exists. (default: false)'
					}
				},
				required: ['path', 'nodes']
			}
		},
		{
			name: 'generate_moc',
			description: 'Generate a Map of Content (MOC) note that collects and links related notes. Use folder, tags, or files to define which notes to include.',
			inputSchema: {
				type: 'object',
				properties: {
					title: {
						type: 'string',
						description: 'Title of the MOC note (used as the H1 heading).',
					},
					outputPath: {
						type: 'string',
						description: 'Vault-relative path for the MOC file (e.g. "Project MOC" or "Maps/Project MOC"). .md is appended automatically if missing.',
					},
					folder: {
						type: 'string',
						description: 'Collect notes from this folder path (optional). Can be combined with tags.',
					},
					tags: {
						type: 'array',
						items: { type: 'string' },
						description: 'Collect notes that have ALL of these tags (optional, e.g. ["#project", "#active"]).',
					},
					files: {
						type: 'array',
						items: { type: 'string' },
						description: 'Explicit list of note paths to include. When provided, folder and tags are ignored.',
					},
					groupBy: {
						type: 'string',
						enum: ['folder', 'tag', 'none'],
						description: 'Grouping strategy for MOC sections. "folder" groups by top-level folder, "tag" groups by first tag, "none" is a flat list. (default: "none")',
					},
					overwrite: {
						type: 'boolean',
						description: 'Overwrite the file if it already exists. (default: false)',
					},
				},
				required: ['title', 'outputPath'],
			},
		},
	];
}