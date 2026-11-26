import { describe, expect, it } from 'vitest';
import {
	buildPendingVoiceBlock,
	generatePendingVoiceId,
	parsePendingVoiceMarkers,
	replacePendingVoiceBlock,
} from '../deferred/pendingVoiceMarker';

describe('pendingVoiceMarker', () => {
	it('대기 블록 생성 및 파싱 왕복이 정확히 동작한다', () => {
		const id = generatePendingVoiceId();
		const block = buildPendingVoiceBlock({
			id,
			audioVaultPath: 'Attachments/Voice/회의 녹음 (1).m4a',
			templateId: 'meeting',
			pendingNoticeText: '음성 노트 변환 대기 중',
		});

		const content = `# 회의 노트\n\n${block}\n\n메모 끝`;
		const parsed = parsePendingVoiceMarkers('Notes/Meeting.md', content);

		expect(parsed).toHaveLength(1);
		expect(parsed[0]).toMatchObject({
			id,
			notePath: 'Notes/Meeting.md',
			audioPath: 'Attachments/Voice/회의 녹음 (1).m4a',
			templateId: 'meeting',
		});
		expect(block).toContain('![[Attachments/Voice/회의 녹음 (1).m4a]]');
	});

	it('한 노트 안의 여러 마커 중 지정한 ID 블록만 제자리 치환하고 주변 본문을 보존한다', () => {
		const block1 = buildPendingVoiceBlock({
			id: 'v_first',
			audioVaultPath: 'Attachments/Voice/first.m4a',
			templateId: 'clean',
			pendingNoticeText: '대기 1',
		});
		const block2 = buildPendingVoiceBlock({
			id: 'v_second',
			audioVaultPath: 'Attachments/Voice/second.m4a',
			templateId: 'verbatim',
			pendingNoticeText: '대기 2',
		});

		const doc = `# 데일리 노트\n\n오전 메모\n\n${block1}\n\n중간 사용자 메모\n\n${block2}\n\n마무리 메모`;
		const { updated, replaced } = replacePendingVoiceBlock(
			doc,
			'v_first',
			'![[Attachments/Voice/first.m4a]]\n\n> [!summary] 요약\n> - 첫 번째 요약',
		);

		expect(replaced).toBe(true);
		expect(updated).toContain('오전 메모');
		expect(updated).toContain('중간 사용자 메모');
		expect(updated).toContain('마무리 메모');
		expect(updated).toContain('> - 첫 번째 요약');
		expect(updated).not.toContain('id="v_first"');
		expect(updated).toContain('id="v_second"');

		const remaining = parsePendingVoiceMarkers('Daily.md', updated);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].id).toBe('v_second');
	});

	it('존재하지 않는 ID 치환 시 원본 본문을 변경하지 않는다', () => {
		const doc = '# 일반 노트\n\n본문입니다.';
		const res = replacePendingVoiceBlock(doc, 'missing_id', '대체 텍스트');
		expect(res.replaced).toBe(false);
		expect(res.updated).toBe(doc);
	});
});
