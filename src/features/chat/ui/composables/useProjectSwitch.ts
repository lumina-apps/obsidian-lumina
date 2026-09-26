import { resetChat, messages } from "../../../../core/store/chatStore";
import { setActiveProject, getActiveProject } from "../../../../core/store/projectStore";
import type LuminaPlugin from "../../../../main";
import type { ChatController } from "../../chatController";

export interface ProjectSwitchParams {
	plugin: LuminaPlugin;
	newProjectId: string;
	currentProjectId: string;
	abortController: AbortController | null;
	ctrl: ChatController | null;
	selectedProviderId: string;
	selectedModelId: string;
	isRagEnabled: boolean;
	onUpdateSelectedModel: (providerId: string, modelId: string) => void;
}

/**
 * 활성 프로젝트 전환 시 스트리밍 중단, 현재 세션 저장, Store 초기화 및 RAG hot-swap을 처리하는 헬퍼
 */
export async function executeProjectSwitch({
	plugin,
	newProjectId,
	currentProjectId,
	abortController,
	ctrl,
	selectedProviderId,
	selectedModelId,
	isRagEnabled,
	onUpdateSelectedModel,
}: ProjectSwitchParams): Promise<void> {
	if (newProjectId === currentProjectId) return;

	// 1. 스트리밍 중이면 즉시 중단 및 UI 스트리밍 상태 해제
	if (abortController) {
		abortController.abort();
		messages.update((msgs) =>
			msgs.map((m) => ({
				...m,
				isStreaming: false,
				ragPipelineStep: null,
			})),
		);
	}

	// 2. 현재 세션 저장 (기존 메시지가 있을 경우)
	if (ctrl) {
		try {
			await ctrl.saveHistory(selectedProviderId, selectedModelId);
		} catch {
			// 저장 실패해도 프로젝트 전환은 계속 진행
		}
	}

	// 3. 채팅 메시지 스토어 초기화
	resetChat();

	// 4. activeProjectId store 업데이트 + plugin.settings 저장
	setActiveProject(newProjectId);
	plugin.settings.projects.activeProjectId = newProjectId;
	await plugin.saveSettings();

	// 5. 새 프로젝트의 기본 모델이 지정되어 있으면 자동 전환
	const activeProject = getActiveProject();
	if (activeProject.defaultProviderId && activeProject.defaultModelId) {
		onUpdateSelectedModel(activeProject.defaultProviderId, activeProject.defaultModelId);
	}

	// 6. RAG 인덱서 hot-swap (비동기 트리거)
	if (isRagEnabled) {
		import("../../../rag/ragInitializer").then(({ switchProjectIndex }) => {
			void switchProjectIndex(plugin, newProjectId);
		});
	}
}
