import { describe, it, expect, vi } from "vitest";
import { createPromptTemplateInserter } from "./useInputHandler";

describe("useInputHandler - createPromptTemplateInserter", () => {
	it("커서 위치(텍스트 중간)에 프롬프트를 삽입하고 커서를 삽입 텍스트 끝으로 이동한다", async () => {
		let inputText = "앞부분 뒷부분";
		const mockEl = {
			selectionStart: 4,
			selectionEnd: 4,
			style: { height: "" },
			scrollHeight: 40,
			setCssStyles: vi.fn(),
			focus: vi.fn(),
		} as unknown as HTMLTextAreaElement;

		const insert = createPromptTemplateInserter({
			getTextareaEl: () => mockEl,
			getInputText: () => inputText,
			setInputText: (v) => {
				inputText = v;
			},
		});

		const prompt = "중간프롬프트 ";
		insert(prompt);

		expect(inputText).toBe("앞부분 중간프롬프트 뒷부분");

		// svelte tick() 이후 커서 및 포커스 반영 대기
		await Promise.resolve();
		await Promise.resolve();

		expect(mockEl.focus).toHaveBeenCalledTimes(1);
		expect(mockEl.selectionStart).toBe(4 + prompt.length);
		expect(mockEl.selectionEnd).toBe(4 + prompt.length);
	});

	it("textarea가 null이면 기존 입력 텍스트 끝에 이어 붙인다", () => {
		let inputText = "기존 ";
		const insert = createPromptTemplateInserter({
			getTextareaEl: () => null,
			getInputText: () => inputText,
			setInputText: (v) => {
				inputText = v;
			},
		});

		insert("추가");
		expect(inputText).toBe("기존 추가");
	});
});
