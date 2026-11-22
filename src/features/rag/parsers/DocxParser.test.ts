import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { DocxParser } from './DocxParser';

vi.mock('../../../shared/debugLogger', () => ({
	debugLogger: {
		logError: vi.fn(),
		logWarn: vi.fn(),
		logInfo: vi.fn(),
	},
}));

describe('DocxParser', () => {
	it('word/document.xml에서 단락, 탭, 줄바꿈, XML 엔티티를 추출한다', async () => {
		const zip = new JSZip();
		zip.file(
			'word/document.xml',
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
			<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
				<w:body>
					<w:p><w:r><w:t>Hello &amp; Welcome</w:t><w:tab/><w:t>Lumina</w:t></w:r></w:p>
					<w:p>
						<w:r><w:t>Second line</w:t><w:br/><w:t>After break</w:t></w:r>
						<w:del><w:r><w:delText>Deleted text</w:delText></w:r></w:del>
					</w:p>
				</w:body>
			</w:document>`,
		);

		const buffer = await zip.generateAsync({ type: 'arraybuffer' });
		const text = await DocxParser.parse(buffer);

		expect(text).toContain('Hello & Welcome\tLumina');
		expect(text).toContain('Second line\nAfter break');
		expect(text).not.toContain('Deleted text');
	});

	it('_rels/.rels에 지정된 커스텀 메인 문서 경로와 각주를 함께 추출한다', async () => {
		const zip = new JSZip();
		zip.file(
			'_rels/.rels',
			`<?xml version="1.0" encoding="UTF-8"?>
			<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
				<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/word/document2.xml"/>
			</Relationships>`,
		);
		zip.file(
			'word/document2.xml',
			`<w:document><w:body><w:p><w:r><w:t>Main body</w:t></w:r></w:p></w:body></w:document>`,
		);
		zip.file(
			'word/footnotes.xml',
			`<w:footnotes><w:footnote><w:p><w:r><w:t>Footnote text</w:t></w:r></w:p></w:footnote></w:footnotes>`,
		);

		const buffer = await zip.generateAsync({ type: 'arraybuffer' });
		const text = await DocxParser.parse(buffer);

		expect(text).toContain('Main body');
		expect(text).toContain('Footnote text');
	});

	it('유효하지 않은 바이너리 입력 시 빈 문자열을 반환한다', async () => {
		const invalidBuffer = new TextEncoder().encode('not a zip').buffer;
		const text = await DocxParser.parse(invalidBuffer);
		expect(text).toBe('');
	});
});
