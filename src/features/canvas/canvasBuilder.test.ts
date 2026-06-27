import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEdgeSides, buildCanvasData, collectGraph, addFolderGroups } from './canvasBuilder';
import type { CanvasBuildOptions } from './canvasTypes';
import type { App, TFile } from 'obsidian';

describe('canvasBuilder', () => {
	let mockApp: App;

	beforeEach(() => {
		mockApp = {
			metadataCache: {
				getFileCache: vi.fn().mockReturnValue(null),
				getFirstLinkpathDest: vi.fn(),
				resolvedLinks: {}
			},
			vault: {
				getFileByPath: vi.fn()
			}
		} as unknown as App;
	});

	describe('getEdgeSides', () => {
		it('should return right-to-left when target is to the right', () => {
			const res = getEdgeSides({ x: 0, y: 0 }, { x: 100, y: 10 });
			expect(res).toEqual({ fromSide: 'right', toSide: 'left' });
		});

		it('should return left-to-right when target is to the left', () => {
			const res = getEdgeSides({ x: 100, y: 0 }, { x: 0, y: 10 });
			expect(res).toEqual({ fromSide: 'left', toSide: 'right' });
		});

		it('should return bottom-to-top when target is below', () => {
			const res = getEdgeSides({ x: 0, y: 0 }, { x: 10, y: 100 });
			expect(res).toEqual({ fromSide: 'bottom', toSide: 'top' });
		});

		it('should return top-to-bottom when target is above', () => {
			const res = getEdgeSides({ x: 0, y: 100 }, { x: 10, y: 0 });
			expect(res).toEqual({ fromSide: 'top', toSide: 'bottom' });
		});
	});

	describe('collectGraph', () => {
		it('should collect nodes correctly up to max depth', () => {
			const root = { path: 'root.md', extension: 'md' } as TFile;
			const child = { path: 'child.md', extension: 'md' } as TFile;

			// Mock outlinks
			(mockApp.metadataCache.getFileCache as any).mockImplementation((file: TFile) => {
				if (file.path === 'root.md') {
					return { links: [{ link: 'child' }] };
				}
				return null;
			});
			(mockApp.metadataCache.getFirstLinkpathDest as any).mockImplementation((link: string) => {
				if (link === 'child') return child;
				return null;
			});

			const opts: CanvasBuildOptions = {
				layout: 'radial',
				depth: 2,
				folderDepth: 0,
				maxNodes: 10,
				bidirectional: false,
				includeAttachments: false
			};

			const result = collectGraph(mockApp, [root], opts);
			expect(result.nodeMap.has('root.md')).toBe(true);
			expect(result.nodeMap.has('child.md')).toBe(true);
			expect(result.edges).toEqual([['root.md', 'child.md']]);
		});
	});

	describe('buildCanvasData', () => {
		it('should place isolated nodes in a grid', () => {
			const root1 = { path: 'root1.md', extension: 'md' } as TFile;
			const root2 = { path: 'root2.md', extension: 'md' } as TFile;

			const collected = {
				nodeMap: new Map([['root1.md', root1], ['root2.md', root2]]),
				edges: [] as Array<[string, string]>
			};

			const opts: CanvasBuildOptions = {
				layout: 'radial',
				depth: 1,
				folderDepth: 0,
				maxNodes: 10,
				bidirectional: false,
				includeAttachments: false
			};

			const data = buildCanvasData(collected, [root1, root2], opts);
			expect(data.nodes.length).toBe(2);
			
			// Isolated nodes grid check
			const n1 = data.nodes.find(n => n.id === 'root1.md' || (n as any).text?.includes('root1.md'));
			const n2 = data.nodes.find(n => n.id === 'root2.md' || (n as any).text?.includes('root2.md'));

			expect(n1).toBeDefined();
			expect(n2).toBeDefined();
			expect(n1!.y).toEqual(n2!.y); // In a 2-node grid, they should be in the same row
		});

		it('should convert bidirectional edges to a single arrowed edge', () => {
			const root1 = { path: 'root1.md', extension: 'md' } as TFile;
			const root2 = { path: 'root2.md', extension: 'md' } as TFile;

			const collected = {
				nodeMap: new Map([['root1.md', root1], ['root2.md', root2]]),
				edges: [['root1.md', 'root2.md'], ['root2.md', 'root1.md']] as Array<[string, string]>
			};

			const opts: CanvasBuildOptions = {
				layout: 'radial',
				depth: 1,
				folderDepth: 0,
				maxNodes: 10,
				bidirectional: true,
				includeAttachments: false
			};

			const data = buildCanvasData(collected, [root1], opts);
			expect(data.edges.length).toBe(1); // Merged into 1
			expect(data.edges[0].toEnd).toBe('arrow');
			expect(data.edges[0].fromEnd).toBe('arrow'); // Bidirectional!
		});
	});
});
