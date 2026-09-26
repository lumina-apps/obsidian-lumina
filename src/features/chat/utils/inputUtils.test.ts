import { describe, it, expect } from "vitest";
import {
	splitProviderModel,
	detectMention,
	detectSlashCommand,
	calculateEstimatedInputTokens,
	estimateInputTokensDetails,
	calculateFolderSize,
} from "./inputUtils";
import { App, TFile, TFolder } from "obsidian";

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

	describe("calculateEstimatedInputTokens", () => {
		it("should return 0 when input is empty and no attachments or active note", () => {
			const tokens = calculateEstimatedInputTokens({
				inputText: "",
				attachments: [],
			});
			expect(tokens).toBe(0);
		});

		it("should estimate tokens for input text", () => {
			const tokens = calculateEstimatedInputTokens({
				inputText: "Hello world",
				attachments: [],
			});
			expect(tokens).toBeGreaterThan(0);
		});

		it("should estimate tokens for attachments with content", () => {
			const tokens = calculateEstimatedInputTokens({
				inputText: "",
				attachments: [
					{
						type: "selection",
						name: "Selection",
						path: "selection",
						content: "This is selected text",
					},
				],
			});
			expect(tokens).toBeGreaterThan(0);
		});

		it("should estimate tokens for file attachments using getFileSize", () => {
			const tokens = calculateEstimatedInputTokens({
				inputText: "",
				attachments: [
					{
						type: "file",
						name: "file.md",
						path: "notes/file.md",
					},
				],
				getFileSize: (p) => (p === "notes/file.md" ? 300 : undefined),
			});
			// 300 / 3 = 100
			expect(tokens).toBe(100);
		});

		it("should include active note tokens when includeActiveNote is true", () => {
			const tokens = calculateEstimatedInputTokens({
				inputText: "",
				attachments: [],
				includeActiveNote: true,
				activeFileInfo: { path: "notes/active.md", size: 600 },
			});
			// 600 / 3 = 200
			expect(tokens).toBe(200);
		});

		it("should not include active note tokens when includeActiveNote is false", () => {
			const tokens = calculateEstimatedInputTokens({
				inputText: "",
				attachments: [],
				includeActiveNote: false,
				activeFileInfo: { path: "notes/active.md", size: 600 },
			});
			expect(tokens).toBe(0);
		});

		it("should not double-count active note if already in attachments as active_note", () => {
			const tokens = calculateEstimatedInputTokens({
				inputText: "",
				attachments: [
					{
						type: "active_note",
						name: "Active Note",
						path: "notes/active.md",
					},
				],
				includeActiveNote: true,
				activeFileInfo: { path: "notes/active.md", size: 600 },
				getFileSize: (p) => (p === "notes/active.md" ? 600 : undefined),
			});
			// Only counted once (200 tokens, not 400)
			expect(tokens).toBe(200);
		});

		it("should not double-count active note if already in attachments as file with same path", () => {
			const tokens = calculateEstimatedInputTokens({
				inputText: "",
				attachments: [
					{
						type: "file",
						name: "Active Note",
						path: "notes/active.md",
					},
				],
				includeActiveNote: true,
				activeFileInfo: { path: "notes/active.md", size: 600 },
				getFileSize: (p) => (p === "notes/active.md" ? 600 : undefined),
			});
			// Only counted once (200 tokens, not 400)
			expect(tokens).toBe(200);
		});

		it("should handle null activeFileInfo gracefully when includeActiveNote is true", () => {
			const tokens = calculateEstimatedInputTokens({
				inputText: "test",
				attachments: [],
				includeActiveNote: true,
				activeFileInfo: null,
			});
			expect(tokens).toBeGreaterThan(0);
		});

		it("should estimate tokens for folder attachments using getFolderSize", () => {
			const result = estimateInputTokensDetails({
				inputText: "",
				attachments: [
					{
						type: "folder",
						name: "Docs",
						path: "notes/docs",
					},
				],
				getFolderSize: (p) => (p === "notes/docs" ? { size: 9000, isOverLimit: false } : undefined),
			});
			// 9000 / 3 = 3000
			expect(result.tokens).toBe(3000);
			expect(result.isOverLimit).toBe(false);
			expect(result.displayText).toBe("~3,000 tokens");
		});

		it("should display > 100k tokens and set isOverLimit when folder exceeds limit", () => {
			const result = estimateInputTokensDetails({
				inputText: "",
				attachments: [
					{
						type: "folder",
						name: "LargeFolder",
						path: "notes/large",
					},
				],
				getFolderSize: (p) => (p === "notes/large" ? { size: 360000, isOverLimit: true } : undefined),
			});
			expect(result.isOverLimit).toBe(true);
			expect(result.displayText).toBe("> 100k tokens");
		});

		it("should handle getFolderSize returning a number", () => {
			const result = estimateInputTokensDetails({
				inputText: "",
				attachments: [
					{
						type: "folder",
						name: "Docs",
						path: "notes/docs",
					},
				],
				getFolderSize: (p) => (p === "notes/docs" ? 6000 : undefined),
			});
			expect(result.tokens).toBe(2000);
			expect(result.displayText).toBe("~2,000 tokens");
		});
	});

	describe("calculateFolderSize", () => {
		it("should calculate total size of markdown files in folder tree", () => {
			const root = new TFolder();
			root.path = "Folder";

			const sub = new TFolder();
			sub.path = "Folder/Sub";

			const file1 = new TFile();
			file1.path = "Folder/file1.md";
			file1.extension = "md";
			file1.stat = { ctime: 0, mtime: 0, size: 500 };

			const file2 = new TFile();
			file2.path = "Folder/Sub/file2.md";
			file2.extension = "md";
			file2.stat = { ctime: 0, mtime: 0, size: 800 };

			const nonMd = new TFile();
			nonMd.path = "Folder/image.png";
			nonMd.extension = "png";
			nonMd.stat = { ctime: 0, mtime: 0, size: 50000 };

			root.children = [file1, sub, nonMd];
			sub.children = [file2];

			const mockApp = {
				vault: {
					getAbstractFileByPath: (p: string) => (p === "Folder" ? root : null),
				},
			} as unknown as App;

			const result = calculateFolderSize(mockApp, "Folder", 300_000);
			expect(result.size).toBe(1300);
			expect(result.isOverLimit).toBe(false);
		});

		it("should short-circuit and set isOverLimit when maxBytes is reached", () => {
			const root = new TFolder();
			root.path = "Folder";

			const file1 = new TFile();
			file1.path = "Folder/file1.md";
			file1.extension = "md";
			file1.stat = { ctime: 0, mtime: 0, size: 2000 };

			const file2 = new TFile();
			file2.path = "Folder/file2.md";
			file2.extension = "md";
			file2.stat = { ctime: 0, mtime: 0, size: 2000 };

			root.children = [file1, file2];

			const mockApp = {
				vault: {
					getAbstractFileByPath: (p: string) => (p === "Folder" ? root : null),
				},
			} as unknown as App;

			// Set maxBytes = 1500 (file1 alone exceeds it)
			const result = calculateFolderSize(mockApp, "Folder", 1500);
			expect(result.size).toBe(2000);
			expect(result.isOverLimit).toBe(true);
		});

		it("should return 0 when path is not a TFolder", () => {
			const mockApp = {
				vault: {
					getAbstractFileByPath: () => null,
				},
			} as unknown as App;

			const result = calculateFolderSize(mockApp, "NonExistent");
			expect(result.size).toBe(0);
			expect(result.isOverLimit).toBe(false);
		});
	});
});

