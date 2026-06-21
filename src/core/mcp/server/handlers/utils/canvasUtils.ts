export interface CanvasNodeBase {
	id: string;
	type: 'text' | 'file' | 'group';
	x: number;
	y: number;
	width: number;
	height: number;
	color?: string;
}

export interface CanvasTextNode extends CanvasNodeBase {
	type: 'text';
	text: string;
}

export interface CanvasFileNode extends CanvasNodeBase {
	type: 'file';
	file: string;
}

export interface CanvasGroupNode extends CanvasNodeBase {
	type: 'group';
	label?: string;
}

export type CanvasNode = CanvasTextNode | CanvasFileNode | CanvasGroupNode;

export interface CanvasEdge {
	id: string;
	fromNode: string;
	toNode: string;
	fromSide?: 'top' | 'right' | 'bottom' | 'left';
	toSide?: 'top' | 'right' | 'bottom' | 'left';
	label?: string;
	color?: string;
}

export interface CanvasData {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
}

export type LayoutStrategy = 'grid' | 'horizontal' | 'vertical';

export interface CanvasNodeInput {
	id?: string;
	type?: 'text' | 'file' | 'group';
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	color?: string;
	text?: string;
	file?: string;
	label?: string;
}

export interface CanvasEdgeInput {
	id?: string;
	fromNode?: string;
	toNode?: string;
	fromSide?: 'top' | 'right' | 'bottom' | 'left';
	toSide?: 'top' | 'right' | 'bottom' | 'left';
	label?: string;
	color?: string;
}

function generateId(): string {
	return Math.random().toString(36).substring(2, 16);
}

export function buildCanvas(
	nodesInput: CanvasNodeInput[],
	edgesInput: CanvasEdgeInput[],
	layout: LayoutStrategy
): { canvasData?: CanvasData; error?: string } {
	if (!nodesInput || nodesInput.length === 0) {
		return { error: 'nodes array cannot be empty' };
	}

	const nodes: CanvasNode[] = [];
	const unpositionedNodes: CanvasNode[] = [];
	const nodeIds = new Set<string>();

	// Process nodes
	for (const input of nodesInput) {
		const id = input.id || generateId();
		nodeIds.add(id);

		const type = input.type;
		if (type !== 'text' && type !== 'file' && type !== 'group') {
			return { error: `Invalid node type: ${type}` };
		}

		let width = input.width;
		let height = input.height;

		if (width === undefined) width = type === 'group' ? 400 : 250;
		if (height === undefined) height = type === 'group' ? 300 : 140;

		const base: CanvasNodeBase = {
			id,
			type,
			x: input.x !== undefined ? input.x : 0,
			y: input.y !== undefined ? input.y : 0,
			width,
			height,
		};
		if (input.color) base.color = input.color;

		let node: CanvasNode;
		if (type === 'text') {
			if (!input.text) return { error: `text node ${id} requires a 'text' field` };
			node = { ...base, type: 'text', text: input.text };
		} else if (type === 'file') {
			if (!input.file) return { error: `file node ${id} requires a 'file' field` };
			node = { ...base, type: 'file', file: input.file };
		} else {
			node = { ...base, type: 'group', label: input.label };
		}

		nodes.push(node);

		if (input.x === undefined || input.y === undefined) {
			unpositionedNodes.push(node);
		}
	}

	// Apply Layout
	if (unpositionedNodes.length > 0) {
		assignLayout(unpositionedNodes, layout);
	}

	// Process edges
	const edges: CanvasEdge[] = [];
	for (const input of edgesInput) {
		if (!input.fromNode || !input.toNode) {
			return { error: 'Edges must specify fromNode and toNode' };
		}
		if (!nodeIds.has(input.fromNode)) {
			return { error: `Edge references unknown fromNode: ${input.fromNode}` };
		}
		if (!nodeIds.has(input.toNode)) {
			return { error: `Edge references unknown toNode: ${input.toNode}` };
		}

		const edge: CanvasEdge = {
			id: input.id || generateId(),
			fromNode: input.fromNode,
			toNode: input.toNode,
		};

		if (input.fromSide) edge.fromSide = input.fromSide;
		if (input.toSide) edge.toSide = input.toSide;
		if (input.label) edge.label = input.label;
		if (input.color) edge.color = input.color;

		edges.push(edge);
	}

	return { canvasData: { nodes, edges } };
}

function assignLayout(nodes: CanvasNode[], strategy: LayoutStrategy) {
	const gap = 40;
	if (strategy === 'grid') {
		const cols = Math.ceil(Math.sqrt(nodes.length));
		let currentX = 0;
		let currentY = 0;
		let rowHeight = 0;

		nodes.forEach((node, idx) => {
			if (idx > 0 && idx % cols === 0) {
				currentX = 0;
				currentY += rowHeight + gap;
				rowHeight = 0;
			}
			node.x = currentX;
			node.y = currentY;
			currentX += node.width + gap;
			rowHeight = Math.max(rowHeight, node.height);
		});
	} else if (strategy === 'horizontal') {
		let currentX = 0;
		nodes.forEach((node) => {
			node.x = currentX;
			node.y = 0;
			currentX += node.width + gap;
		});
	} else if (strategy === 'vertical') {
		let currentY = 0;
		nodes.forEach((node) => {
			node.x = 0;
			node.y = currentY;
			currentY += node.height + gap;
		});
	}
}
