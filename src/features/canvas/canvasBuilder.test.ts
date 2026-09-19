import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEdgeSides, buildCanvasData, collectGraph, addFolderGroups } from './canvasBuilder';
import type { CanvasBuildOptions, CanvasData, CanvasTextNode, CanvasGroupNode } from './canvasTypes';
import type { App, TFile, CachedMetadata } from 'obsidian';
import { t } from '../../shared/locales/helpers';

interface MockAppFixture {
	app: App;
	getFileCache: ReturnType<typeof vi.fn>;
	getFirstLinkpathDest: ReturnType<typeof vi.fn>;
	getFileByPath: ReturnType<typeof vi.fn>;
}

function createMockApp(): MockAppFixture {
	const getFileCache = vi.fn().mockReturnValue(null);
	const getFirstLinkpathDest = vi.fn();
	const getFileByPath = vi.fn();
	const app = {
		metadataCache: {
			getFileCache,
			getFirstLinkpathDest,
			resolvedLinks: {},
		},
		vault: {
			getFileByPath,
		},
	} as unknown as App;
	return { app, getFileCache, getFirstLinkpathDest, getFileByPath };
}

describe('canvasBuilder', () => {
	let fixture: MockAppFixture;
	let mockApp: App;

	beforeEach(() => {
		fixture = createMockApp();
		mockApp = fixture.app;
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

			fixture.getFileCache.mockImplementation((file: TFile) => {
				if (file.path === 'root.md') {
					return { links: [{ link: 'child' }] } as unknown as CachedMetadata;
				}
				return null;
			});
			fixture.getFirstLinkpathDest.mockImplementation((link: string) => {
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

			fixture.getFileCache.mockImplementation((file: TFile) => {
				if (file.path === 'root.md') return { links: [{ link: 'child1' }, { link: 'child2' }] } as unknown as CachedMetadata;
				return null;
			});
			fixture.getFirstLinkpathDest.mockImplementation((link: string) => {
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

			fixture.getFileCache.mockImplementation((file: TFile) => {
				if (file.path === 'root.md') return { embeds: [{ link: 'embed' }] } as unknown as CachedMetadata;
				return null;
			});
			fixture.getFirstLinkpathDest.mockImplementation((link: string) => {
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
			fixture.getFileByPath.mockImplementation((path: string) => {
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

			fixture.getFileCache.mockImplementation((file: TFile) => {
				if (file.path === 'root.md') return { links: [{ link: 'image.png' }] } as unknown as CachedMetadata;
				return null;
			});
			fixture.getFirstLinkpathDest.mockImplementation(() => image);

			let opts: CanvasBuildOptions = { layout: 'radial', depth: 1, folderDepth: 0, maxNodes: 10, bidirectional: false, includeAttachments: false };
			let result = collectGraph(mockApp, [root], opts);
			expect(result.nodeMap.has('image.png')).toBe(false);

			opts = { ...opts, includeAttachments: true };
			result = collectGraph(mockApp, [root], opts);
			expect(result.nodeMap.has('image.png')).toBe(true);
		});

		it('should strip heading and block subpaths when resolving links', () => {
			const root = { path: 'root.md', extension: 'md' } as TFile;
			const child1 = { path: 'child1.md', extension: 'md' } as TFile;
			const child2 = { path: 'child2.md', extension: 'md' } as TFile;

			fixture.getFileCache.mockImplementation((file: TFile) => {
				if (file.path === 'root.md') {
					return {
						links: [
							{ link: 'child1#Section Header' },
							{ link: 'child2^blockid123' },
						],
					} as unknown as CachedMetadata;
				}
				return null;
			});

			fixture.getFirstLinkpathDest.mockImplementation((link: string) => {
				if (link === 'child1') return child1;
				if (link === 'child2') return child2;
				return null;
			});

			const opts: CanvasBuildOptions = { layout: 'radial', depth: 1, folderDepth: 0, maxNodes: 10, bidirectional: false, includeAttachments: false };
			const result = collectGraph(mockApp, [root], opts);
			expect(result.nodeMap.has('child1.md')).toBe(true);
			expect(result.nodeMap.has('child2.md')).toBe(true);
			expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('child1', 'root.md');
			expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('child2', 'root.md');
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
			
			const n1 = data.nodes.find((n): n is CanvasTextNode => n.type === 'text' && (n.id === 'root1.md' || n.text.includes('root1.md')));
			const n2 = data.nodes.find((n): n is CanvasTextNode => n.type === 'text' && (n.id === 'root2.md' || n.text.includes('root2.md')));

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
			
			const rootNode = data.nodes.find((n): n is CanvasTextNode => n.type === 'text' && n.text.includes('root1.md'));
			const childNode = data.nodes.find((n): n is CanvasTextNode => n.type === 'text' && n.text.includes('child.md'));
			
			expect(rootNode).toBeDefined();
			expect(childNode).toBeDefined();
			expect(childNode!.x).toBeGreaterThan(rootNode!.x);
		});

		it('should expand radial radius when node count in a layer is large', () => {
			const root = { path: 'root.md', extension: 'md' } as TFile;
			const children: TFile[] = [];
			const nodeMap = new Map<string, TFile>([['root.md', root]]);
			const edges: Array<[string, string]> = [];

			// 10개 자식 노드 생성
			for (let i = 0; i < 10; i++) {
				const p = `child${i}.md`;
				const child = { path: p, extension: 'md' } as TFile;
				children.push(child);
				nodeMap.set(p, child);
				edges.push(['root.md', p]);
			}

			const collected = { nodeMap, edges };
			const opts: CanvasBuildOptions = { layout: 'radial', depth: 1, folderDepth: 0, maxNodes: 20, bidirectional: false, includeAttachments: false };
			const data = buildCanvasData(collected, [root], opts);

			// 10개 노드의 경우 minRadius = ceil(10 * 280 / 2pi) = 446px > 260px (기본 간격)
			// 자식 노드들의 원점으로부터의 거리(radius)가 260보다 커야 함
			const childNodes = data.nodes.filter((n): n is CanvasTextNode => n.type === 'text' && n.text.includes('child'));
			expect(childNodes.length).toBe(10);
			const firstChild = childNodes[0];
			const dist = Math.sqrt(firstChild.x * firstChild.x + firstChild.y * firstChild.y);
			expect(dist).toBeGreaterThan(400);
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
			
			const groups = result.nodes.filter((n): n is CanvasGroupNode => n.type === 'group');
			expect(groups.length).toBe(2);
			
			const folder1Group = groups.find((g) => g.label === 'folder1');
			expect(folder1Group).toBeDefined();
			expect(folder1Group!.x).toBeLessThan(0);
			expect(folder1Group!.y).toBeLessThan(0);
			expect(folder1Group!.width).toBeGreaterThan(100);

			const rootGroup = groups.find((g) => g.label === t('canvas.rootGroup'));
			expect(rootGroup).toBeDefined();
		});
	});
});
