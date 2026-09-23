import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { XlsxParser } from './XlsxParser';

describe('XlsxParser', () => {
	it('should parse XLSX zip buffer with shared strings, inline strings, numbers, and sparse cells', async () => {
		const zip = new JSZip();

		// 1. xl/workbook.xml
		zip.file(
			'xl/workbook.xml',
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
			<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
				<sheets>
					<sheet name="Sales Data" sheetId="1" r:id="rId1"/>
				</sheets>
			</workbook>`
		);

		// 2. xl/sharedStrings.xml
		zip.file(
			'xl/sharedStrings.xml',
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
			<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
				<si><t>Item Name</t></si>
				<si><t>Total Revenue &amp; Profit</t></si>
			</sst>`
		);

		// 3. xl/worksheets/sheet1.xml
		zip.file(
			'xl/worksheets/sheet1.xml',
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
			<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
				<sheetData>
					<row r="1">
						<c r="A1" t="s"><v>0</v></c>
						<c r="B1"><v>1500</v></c>
						<c r="C1" t="s"><v>1</v></c>
					</row>
					<row r="2">
						<c r="A2" t="inlineStr"><is><t>Apples, Oranges</t></is></c>
						<c r="B2" t="b"><v>1</v></c>
						<c r="D2"><v>99.9</v></c>
					</row>
				</sheetData>
			</worksheet>`
		);

		const buffer = await zip.generateAsync({ type: 'arraybuffer' });
		const result = await XlsxParser.parse(buffer);

		expect(result).toContain('--- Sheet: Sales Data ---');
		expect(result).toContain('Item Name,1500,Total Revenue & Profit');
		// Row 2 has cell A2, B2, empty C2, and D2
		expect(result).toContain('"Apples, Oranges",TRUE,,99.9');
	});

	it('should fallback to plain text UTF-8 decoding if buffer is not a zip (e.g. CSV)', async () => {
		const csvText = 'Date,Product,Price\n2026-09-24,Obsidian Lumina,Free';
		const encoder = new TextEncoder();
		const buffer = encoder.encode(csvText).buffer;

		const result = await XlsxParser.parse(buffer);
		expect(result).toBe(csvText);
	});

	it('should handle empty or corrupt buffer gracefully', async () => {
		const emptyBuffer = new ArrayBuffer(0);
		const result = await XlsxParser.parse(emptyBuffer);
		expect(result).toBe('');
	});
});
