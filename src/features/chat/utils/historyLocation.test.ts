import { describe, it, expect } from 'vitest';
import { resolveHistoryLocation } from './historyLocation';
import { createDefaultProject, type ProjectConfig } from '../../../shared/types/project.types';

function makeProject(overrides: Partial<ProjectConfig> & { id: string; name: string }): ProjectConfig {
	return {
		...createDefaultProject(),
		...overrides,
	};
}

describe('historyLocation', () => {
	const defaultProj = createDefaultProject();
	const workProj = makeProject({ id: 'work', name: 'Work', historySubfolder: 'Work' });
	const nestedProj = makeProject({ id: 'work-sub', name: 'Work Sub', historySubfolder: 'Work/Sub' });

	it('Default 프로젝트 스코프에서는 다른 프로젝트 폴더들을 excludeFolders에 포함한다', () => {
		const res = resolveHistoryLocation(
			{ historyPath: 'chatHistory', historyFolderFormat: '{{YYYY}}/{{MM}}' },
			[defaultProj, workProj, nestedProj],
			defaultProj,
		);

		expect(res.basePath).toBe('chatHistory');
		expect(res.options.folderFormat).toBe('{{YYYY}}/{{MM}}');
		expect(res.options.excludeFolders).toEqual([
			'chatHistory/Work',
			'chatHistory/Work/Sub',
		]);
	});

	it('특정 프로젝트 스코프에서는 자신의 하위 중첩 프로젝트만 제외하고 형제 프로젝트는 포함하지 않는다', () => {
		const res = resolveHistoryLocation(
			{ historyPath: 'chatHistory', historyFolderFormat: '{{YYYY}}/{{MM}}' },
			[defaultProj, workProj, nestedProj],
			workProj,
		);

		expect(res.basePath).toBe('chatHistory/Work');
		expect(res.options.excludeFolders).toEqual(['chatHistory/Work/Sub']);
	});

	it('동일한 historySubfolder를 공유하는 프로젝트끼리는 대소문자 무시 비교로 서로 제외하지 않는다', () => {
		const sharedProj = makeProject({ id: 'work-2', name: 'Work 2', historySubfolder: 'work' });
		const res = resolveHistoryLocation(
			{ historyPath: 'chatHistory', historyFolderFormat: '' },
			[defaultProj, workProj, sharedProj],
			workProj,
		);

		expect(res.options.excludeFolders).toEqual([]);
	});

	it('projects가 undefined여도 안전하게 기본 경로를 반환한다', () => {
		const res = resolveHistoryLocation(
			{ historyPath: '   ' },
			undefined,
			undefined,
		);

		expect(res.basePath).toBe('chatHistory');
		expect(res.options).toEqual({
			folderFormat: '',
			excludeFolders: [],
		});
	});

	it('historyPath와 historySubfolder에 .. 또는 금지 문자가 포함되면 안전하게 정제한다', () => {
		const unsafeProj = makeProject({ id: 'unsafe', name: 'Unsafe', historySubfolder: '../Sub:1*' });
		const res = resolveHistoryLocation(
			{ historyPath: '../My:Chats/', historyFolderFormat: '{{YYYY}}' },
			[defaultProj, unsafeProj],
			unsafeProj,
		);

		expect(res.basePath).toBe('My_Chats/Sub_1_');
		expect(res.options.folderFormat).toBe('{{YYYY}}');
	});
});
