/**
 * canvasTypes.ts
 *
 * Obsidian Canvas 파일(.canvas) JSON 스펙 타입 정의.
 * https://jsoncanvas.org
 */

// ─── 노드 타입 ────────────────────────────────────────────────────────────────

export interface CanvasFileNode {
	type: 'file';
	id: string;
	file: string; // vault 내 상대 경로
	x: number;
	y: number;
	width: number;
	height: number;
	label?: string;
	color?: string;
}

export interface CanvasTextNode {
	type: 'text';
	id: string;
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color?: string;
}

export interface CanvasGroupNode {
	type: 'group';
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	label?: string;
	color?: string;
	background?: string;
	backgroundStyle?: 'cover' | 'ratio' | 'repeat';
}

export type CanvasNode = CanvasFileNode | CanvasTextNode | CanvasGroupNode;

// ─── 엣지 타입 ────────────────────────────────────────────────────────────────

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left';
export type CanvasEndStyle = 'none' | 'arrow';

export interface CanvasEdge {
	id: string;
	fromNode: string;
	fromSide: CanvasSide;
	fromEnd?: CanvasEndStyle;
	toNode: string;
	toSide: CanvasSide;
	toEnd?: CanvasEndStyle;
	label?: string;
	color?: string;
}

// ─── 최상위 Canvas 파일 구조 ──────────────────────────────────────────────────

export interface CanvasData {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
}

// ─── 레이아웃 옵션 ────────────────────────────────────────────────────────────

export type CanvasLayoutType = 'radial' | 'tree';

export interface CanvasBuildOptions {
	/** 위키링크 탐색 깊이 */
	depth: number;
	/** 레이아웃 방식 */
	layout: CanvasLayoutType;
	/** 양방향 링크 포함 여부 */
	bidirectional: boolean;
	/** md 외 첨부파일 포함 여부 */
	includeAttachments: boolean;
	/** 최대 노드 수 */
	maxNodes: number;
	/** 폴더 모드에서 하위 폴더 탐색 깊이 (0 = 직접 자식만) */
	folderDepth: number;
}
