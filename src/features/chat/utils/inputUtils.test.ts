import { describe, it, expect } from "vitest";
import { splitProviderModel, detectMention, detectSlashCommand } from "./inputUtils";

describe("inputUtils", () => {
	describe("splitProviderModel", () => {
		it("should split provider and model with :: delimiter", () => {
			expect(splitProviderModel("openai::gpt-4o")).toEqual(["openai", "gpt-4o"]);
		});

		it("should return empty model string if :: is absent", () => {
			expect(splitProviderModel("openai")).toEqual(["openai", ""]);
		});
	});

	describe("detectMention", () => {
		it("should return false when lastAt is -1", () => {
			const res = detectMention("hello world", 5, -1);
			expect(res.detected).toBe(false);
		});

		it("should ignore email-like strings", () => {
			const text = "user@example.com";
			const res = detectMention(text, 10, 4);
			expect(res.detected).toBe(false);
		});

		it("should detect single-word mention at start", () => {
			const text = "@Note";
			const res = detectMention(text, 5, 0);
			expect(res.detected).toBe(true);
			expect(res.query).toBe("Note");
			expect(res.startIndex).toBe(0);
		});

		it("should detect multi-word mention with spaces", () => {
			const text = "Check @Daily Note 2026";
			const res = detectMention(text, text.length, 6);
			expect(res.detected).toBe(true);
			expect(res.query).toBe("Daily Note 2026");
			expect(res.startIndex).toBe(6);
		});

		it("should reject query starting with a space", () => {
			const text = "@ something";
			const res = detectMention(text, text.length, 0);
			expect(res.detected).toBe(false);
		});

		it("should reject query containing newlines", () => {
			const text = "@Note\nsecond line";
			const res = detectMention(text, text.length, 0);
			expect(res.detected).toBe(false);
		});

		it("should reject query longer than 50 characters", () => {
			const text = "@" + "a".repeat(55);
			const res = detectMention(text, text.length, 0);
			expect(res.detected).toBe(false);
		});
	});

	describe("detectSlashCommand", () => {
		it("should return false when lastSlash is -1", () => {
			const res = detectSlashCommand("hello", 3, -1);
			expect(res.detected).toBe(false);
		});

		it("should ignore slashes embedded in words or URLs", () => {
			const text = "and/or";
			const res = detectSlashCommand(text, 5, 3);
			expect(res.detected).toBe(false);
		});

		it("should detect simple slash command", () => {
			const text = "/clear";
			const res = detectSlashCommand(text, 6, 0);
			expect(res.detected).toBe(true);
			expect(res.query).toBe("clear");
			expect(res.startIndex).toBe(0);
		});

		it("should detect slash command with trailing spaces and trim query", () => {
			const text = "/clear   ";
			const res = detectSlashCommand(text, text.length, 0);
			expect(res.detected).toBe(true);
			expect(res.query).toBe("clear");
			expect(res.startIndex).toBe(0);
		});

		it("should reject slash command with multiple arguments containing space", () => {
			const text = "/clear something";
			const res = detectSlashCommand(text, text.length, 0);
			expect(res.detected).toBe(false);
		});

		it("should reject slash command starting with space after slash", () => {
			const text = "/ clear";
			const res = detectSlashCommand(text, text.length, 0);
			expect(res.detected).toBe(false);
		});

		it("should reject slash command containing newlines", () => {
			const text = "/clear\nline";
			const res = detectSlashCommand(text, text.length, 0);
			expect(res.detected).toBe(false);
		});
	});
});

