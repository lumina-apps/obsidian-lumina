import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEdgeSides, buildCanvasData, collectGraph, addFolderGroups } from './canvasBuilder';
import type { CanvasBuildOptions, CanvasData } from './canvasTypes';
import type { App, TFile } from 'obsidian';

describe('canvasBuilder', () => {
	let mockApp: App;

	beforeEach(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(mockApp.metadataCache.getFileCache as any).mockImplementation((file: TFile) => {
				if (file.path === 'root.md') {
					return { links: [{ link: 'child' }] };
				}
				return null;
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

		it('should truncate when maxNodes is reached', () => {
			const root = { path: 'root.md', extension: 'md' } as TFile;
			const child1 = { path: 'child1.md', extension: 'md' } as TFile;
			const child2 = { path: 'child2.md', extension: 'md' } as TFile;

			vi.mocked(mockApp.metadataCache.getFileCache).mockImplementation((file: TFile) => {
				if (file.path === 'root.md') return { links: [{ link: 'child1' }, { link: 'child2' }] } as any;
				return null;
			});
			vi.mocked(mockApp.metadataCache.getFirstLinkpathDest).mockImplementation((link: string) => {
				if (link === 'child1') return child1;
				if (link === 'child2') return child2;
				return null;
			});

			const opts: CanvasBuildOptions = { layout: 'radial', depth: 2, folderDepth: 0, maxNodes: 2, bidirectional: false, includeAttachments: false };
			
			const result = collectGraph(mockApp, [root], opts);
			expect(result.nodeMap.size).toBe(2);
			expect(result.nodeMap.has('child2.md')).toBe(false);
		});

		it('should include embeds as outlinks', () => {
			const root = { path: 'root.md', extension: 'md' } as TFile;
			const embedFile = { path: 'embed.md', extension: 'md' } as TFile;

			vi.mocked(mockApp.metadataCache.getFileCache).mockImplementation((file: TFile) => {
				if (file.path === 'root.md') return { embeds: [{ link: 'embed' }] } as any;
				return null;
			});
			vi.mocked(mockApp.metadataCache.getFirstLinkpathDest).mockImplementation((link: string) => {
				if (link === 'embed') return embedFile;
				return null;
			});

			const opts: CanvasBuildOptions = { layout: 'radial', depth: 1, folderDepth: 0, maxNodes: 10, bidirectional: false, includeAttachments: false };
			const result = collectGraph(mockApp, [root], opts);
			expect(result.nodeMap.has('embed.md')).toBe(true);
		});

		it('should collect backlinks in bidirectional mode', () => {
			const root = { path: 'root.md', extension: 'md' } as TFile;
			const backlinkFile = { path: 'backlink.md', extension: 'md' } as TFile;

			mockApp.metadataCache.resolvedLinks = {
				'backlink.md': { 'root.md': 1 }
			};
			vi.mocked(mockApp.vault.getFileByPath).mockImplementation((path: string) => {
				if (path === 'backlink.md') return backlinkFile;
				return null;
			});

			const opts: CanvasBuildOptions = { layout: 'radial', depth: 1, folderDepth: 0, maxNodes: 10, bidirectional: true, includeAttachments: false };
			const result = collectGraph(mockApp, [root], opts);
			expect(result.nodeMap.has('backlink.md')).toBe(true);
			expect(result.edges).toEqual([['backlink.md', 'root.md']]);
		});

		it('should ignore non-md attachments if includeAttachments is false', () => {
			const root = { path: 'root.md', extension: 'md' } as TFile;
			const image = { path: 'image.png', extension: 'png' } as TFile;

			vi.mocked(mockApp.metadataCache.getFileCache).mockImplementation((file: TFile) => {
				if (file.path === 'root.md') return { links: [{ link: 'image.png' }] } as any;
				return null;
			});
			vi.mocked(mockApp.metadataCache.getFirstLinkpathDest).mockImplementation(() => image);

			let opts: CanvasBuildOptions = { layout: 'radial', depth: 1, folderDepth: 0, maxNodes: 10, bidirectional: false, includeAttachments: false };
			let result = collectGraph(mockApp, [root], opts);
			expect(result.nodeMap.has('image.png')).toBe(false);

			opts = { ...opts, includeAttachments: true };
			result = collectGraph(mockApp, [root], opts);
			expect(result.nodeMap.has('image.png')).toBe(true);
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
			
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const n1 = data.nodes.find(n => n.id === 'root1.md' || (n as any).text?.includes('root1.md'));
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const n2 = data.nodes.find(n => n.id === 'root2.md' || (n as any).text?.includes('root2.md'));

			expect(n1).toBeDefined();
			expect(n2).toBeDefined();
			expect(n1!.y).toEqual(n2!.y);
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
			expect(data.edges.length).toBe(1);
			expect(data.edges[0].toEnd).toBe('arrow');
			expect(data.edges[0].fromEnd).toBe('arrow');
		});

		it('should compute tree layout correctly', () => {
			const root1 = { path: 'root1.md', extension: 'md' } as TFile;
			const child = { path: 'child.md', extension: 'md' } as TFile;
			const collected = {
				nodeMap: new Map([['root1.md', root1], ['child.md', child]]),
				edges: [['root1.md', 'child.md']] as Array<[string, string]>
			};

			const opts: CanvasBuildOptions = { layout: 'tree', depth: 1, folderDepth: 0, maxNodes: 10, bidirectional: false, includeAttachments: false };
			const data = buildCanvasData(collected, [root1], opts);
			
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const rootNode = data.nodes.find((n: any) => n.text?.includes('root1.md'));
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const childNode = data.nodes.find((n: any) => n.text?.includes('child.md'));
			
			expect(rootNode).toBeDefined();
			expect(childNode).toBeDefined();
			expect(childNode!.x).toBeGreaterThan(rootNode!.x);
		});
	});

	describe('addFolderGroups', () => {
		it('should add group nodes covering file nodes in folders', () => {
			const root1 = { path: 'folder1/file1.md', parent: { path: 'folder1' } } as unknown as TFile;
			const root2 = { path: 'file2.md', parent: { path: '/' } } as unknown as TFile;

			const nodeMap = new Map([
				['folder1/file1.md', root1],
				['file2.md', root2]
			]);

			const canvasData: CanvasData = {
				nodes: [
					{ id: 'folder1/file1.md', type: 'text', text: '[[folder1/file1.md]]', x: 0, y: 0, width: 100, height: 100 },
					{ id: 'file2.md', type: 'text', text: '[[file2.md]]', x: 200, y: 200, width: 100, height: 100 }
				],
				edges: []
			};

			const result = addFolderGroups(canvasData, nodeMap);
			
			const groups = result.nodes.filter(n => n.type === 'group');
			expect(groups.length).toBe(2);
			
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const folder1Group = groups.find((g: any) => g.label === 'folder1');
			expect(folder1Group).toBeDefined();
			expect(folder1Group!.x).toBeLessThan(0);
			expect(folder1Group!.y).toBeLessThan(0);
			expect(folder1Group!.width).toBeGreaterThan(100);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const rootGroup = groups.find((g: any) => g.label === '(Root)');
			expect(rootGroup).toBeDefined();
		});
	});
});
