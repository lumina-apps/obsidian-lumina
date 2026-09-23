import { describe, it, expect } from 'vitest';
import { isExcluded, isIncluded } from './exclusions';

describe('exclusions', () => {
	it('should exclude default excluded paths like templates, chatHistory, backups', () => {
		expect(isExcluded('templates/daily.md', [])).toBe(true);
		expect(isExcluded('Templates/weekly.md', [])).toBe(true);
		expect(isExcluded('_templates/note.md', [])).toBe(true);
		expect(isExcluded('chatHistory/session.json', [])).toBe(true);
		expect(isExcluded('backups/2026-01-01.zip', [])).toBe(true);
	});

	it('should not exclude normal notes by default', () => {
		expect(isExcluded('Notes/daily.md', [])).toBe(false);
		expect(isExcluded('Work/ProjectA/readme.md', [])).toBe(false);
	});

	it('should exclude user-specified paths', () => {
		expect(isExcluded('private/secret.md', ['private'])).toBe(true);
		expect(isExcluded('archive/2024/doc.md', ['archive/2024'])).toBe(true);
		expect(isExcluded('other/doc.md', ['archive/2024'])).toBe(false);
	});

	it('should NOT exclude everything when user paths contain empty string or slash', () => {
		expect(isExcluded('Notes/important.md', [''])).toBe(false);
		expect(isExcluded('Notes/important.md', ['   '])).toBe(false);
		expect(isExcluded('Notes/important.md', ['/'])).toBe(false);
		expect(isExcluded('Notes/important.md', ['\\'])).toBe(false);
		expect(isExcluded('Notes/important.md', ['', 'private'])).toBe(false);
		expect(isExcluded('private/secret.md', ['', 'private'])).toBe(true);
	});

	it('isIncluded should return true when includePaths is empty or contains slash', () => {
		expect(isIncluded('Notes/any.md', [])).toBe(true);
		expect(isIncluded('Notes/any.md', ['/'])).toBe(true);
		expect(isIncluded('Notes/any.md', [''])).toBe(true);
	});

	it('isIncluded should only return true for matching paths when includePaths is set', () => {
		expect(isIncluded('ProjectA/note.md', ['ProjectA'])).toBe(true);
		expect(isIncluded('ProjectB/note.md', ['ProjectA'])).toBe(false);
	});
});
