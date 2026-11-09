import { describe, it, expect, beforeEach } from 'vitest';
import { PathGuard } from './pathGuard';
import { initProjectStore } from '../../store/projectStore';
import { DEFAULT_PROJECT_ID } from '../../../shared/types/project.types';
import type LuminaPlugin from '../../../main';

describe('PathGuard', () => {
	let pathGuard: PathGuard;

	const mockPlugin = (agentRespectRagExclusions: boolean): LuminaPlugin => {
		return {
			settings: {
				mcp: {
					agentRespectRagExclusions,
				},
			},
		} as unknown as LuminaPlugin;
	};

	beforeEach(() => {
		pathGuard = new PathGuard();
		initProjectStore(
			[
				{
					id: DEFAULT_PROJECT_ID,
					name: 'Default',
					ragIncludedPaths: ['Docs', 'Notes/Allowed.md'],
					ragExcludedPaths: ['Docs/Secret', '*.tmp'],
					historySubfolder: '',
					defaultProviderId: '',
					defaultModelId: '',
					systemPromptId: '',
					createdAt: Date.now(),
				},
			],
			DEFAULT_PROJECT_ID,
		);
	});

	describe('isAgentPathAllowed', () => {
		it('agentRespectRagExclusions 설정이 false이면 모든 경로를 허용한다', () => {
			const plugin = mockPlugin(false);
			expect(pathGuard.isAgentPathAllowed('Docs/Secret/passwords.txt', plugin)).toBe(true);
			expect(pathGuard.isAgentPathAllowed('External/outside.md', plugin)).toBe(true);
			expect(pathGuard.isAgentPathAllowed('anything.tmp', plugin)).toBe(true);
		});

		it('agentRespectRagExclusions가 true일 때 ragIncludedPaths에 매칭되지 않는 경로는 차단한다', () => {
			const plugin = mockPlugin(true);
			expect(pathGuard.isAgentPathAllowed('Random/unknown.md', plugin)).toBe(false);
		});

		it('agentRespectRagExclusions가 true일 때 ragExcludedPaths에 매칭되는 경로는 차단한다', () => {
			const plugin = mockPlugin(true);
			// Docs 아래지만 Docs/Secret에 해당하므로 제외
			expect(pathGuard.isAgentPathAllowed('Docs/Secret/key.txt', plugin)).toBe(false);
		});

		it('agentRespectRagExclusions가 true일 때 포함 목록에 있고 제외되지 않은 유효 경로는 허용한다', () => {
			const plugin = mockPlugin(true);
			expect(pathGuard.isAgentPathAllowed('Docs/guide.md', plugin)).toBe(true);
			expect(pathGuard.isAgentPathAllowed('Notes/Allowed.md', plugin)).toBe(true);
		});
	});

	describe('lock 동시성 제어', () => {
		it('동일 경로에 대해 동시 lock 시도시 에러를 던져 경쟁 상태(race condition)를 방지한다', async () => {
			let resolveFirst: () => void = () => {};
			const firstOp = pathGuard.lock('test.md', () => {
				return new Promise<void>((resolve) => {
					resolveFirst = resolve;
				});
			});

			// 첫 번째 작업이 완료되기 전에 동일 경로에 lock 시도
			await expect(
				pathGuard.lock('test.md', async () => 'second'),
			).rejects.toThrow('File test.md is currently being modified by another operation.');

			resolveFirst();
			await firstOp;
		});

		it('작업이 완료된 후에는 동일 경로에 대해 다시 lock을 획득할 수 있다', async () => {
			const res1 = await pathGuard.lock('test.md', async () => 100);
			expect(res1).toBe(100);

			const res2 = await pathGuard.lock('test.md', async () => 200);
			expect(res2).toBe(200);
		});

		it('작업 실행 도중 예외가 발생해도 finally 블록에서 락이 정상 해제되어 후속 작업이 가능하다', async () => {
			await expect(
				pathGuard.lock('error.md', async () => {
					throw new Error('Disk write failed');
				}),
			).rejects.toThrow('Disk write failed');

			// 락이 정상 해제되어 재시도 가능해야 함
			const retryRes = await pathGuard.lock('error.md', async () => 'recovered');
			expect(retryRes).toBe('recovered');
		});

		it('서로 다른 경로에 대해서는 병렬로 동시에 lock을 획득할 수 있다', async () => {
			const results = await Promise.all([
				pathGuard.lock('noteA.md', async () => 'A'),
				pathGuard.lock('noteB.md', async () => 'B'),
			]);
			expect(results).toEqual(['A', 'B']);
		});
	});
});
