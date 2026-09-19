/**
 * graph.types.ts
 *
 * Graph representation types for RAG semantic graphs and visualizers.
 */

export interface GraphNode {
	id: string; // vault relative path
	name: string; // basename
	group: string; // top-level folder
	degree: number; // number of connections
}

export interface GraphEdge {
	source: string; // source node id (path)
	target: string; // target node id (path)
	weight: number; // cosine similarity score
}

export interface GraphData {
	nodes: GraphNode[];
	links: GraphEdge[];
}

