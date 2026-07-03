# obsidian-lumina Agent Rules

**1. CORE PRINCIPLES**
- Read files/grep patterns before coding. Match existing styles. Ask if ambiguous.
- No unsolicited refactoring. Minimal changes. Keep existing comments/JSDoc.
- Update/add `*.test.ts` alongside features.
- Commits: `type(scope): msg` (e.g., `feat(rag): msg`, `fix(mcp): msg`).

**2. ARCHITECTURE & DEP**
- **Structure**:
  - `src/core/`: Infras (commands, events, llm-providers, mcp, mocks, settings, store, views).
  - `src/features/`: Domains (backup, canvas, chat, debug, editor, frontmatter, graph, rag, web-search).
  - `src/shared/`: Utils (constants, locales, types, utils, plus global scripts like debugLogger).
- **Flow**: `shared/` -> `core/` -> `features/`. **STRICT**: No reverse deps. No cross-imports in `features/`.
- **Init**: `main.ts` (Thin orchestration). `onload()` (light) -> `onLayoutReady()` (heavy lazy imports).

**3. STACK & CONVENTIONS**
- **TypeScript**: `strict`. NO `any` (use `unknown`+narrow). Bypass (`app as any`) causes review rejection.
- **Svelte 5**: Runes ONLY (`$state`, etc). NO Svelte 4 (`$:`). PascalCase files.
  - *State*: Use `$state` for local UI. Use `core/store/` ONLY for global/plugin-lifecycle state.
  - *Style*: Use Obsidian CSS vars (`var(--text-normal)`). Scoped `<style>` for components.
- **Async**: `async/await`. `void` only if explicitly ignoring.
- **Errors**: `try/catch` -> `debugLogger.logError(module, err)` -> `new Notice(t('...'))`.
- **i18n**: Use `t('key')`. Add to ALL `src/shared/locales/` files.
- **UI**: Check `Platform.isMobile`. Cleanup events/DOM on destroy (`onunload` or `$destroy`).
- **Cross-Platform**: Ensure Windows compatibility. Use `normalizePath` for file paths and sanitize filenames (remove `\/:*?"<>|`).

**4. FORBIDDEN (Obsidian Guidelines)**
- `eval()`, `new Function()`, `innerHTML`, `outerHTML` -> Use `createEl`/`createDiv`.
- `console.log` -> Use `debugLogger.logInfo/logDebug`.
- Dangling event listeners (memory leaks).
- Testing Obsidian API without `vitest.setup.ts` mocks.
- Reading settings from disk directly -> Use `plugin.settings.x`.

**5. WORKFLOWS**
- **New Feature**: Wrap in `FeatureManager` class (init/destroy) -> register in `main.ts`.
- **Settings**: Update types -> DEFAULT_SETTINGS -> migrations -> settingTab -> locales.
- **MCP/LLM**: Mimic existing files in `src/core/mcp/` or `llm-providers/`.

**6. SECURITY (Require Human Review)**
- API keys (`core/settings`), MCP execution (`core/mcp`), HITL (`approvalListener`), Backup/Restore, File Delete/Move tools.

**7. COMMANDS**
`npm run dev` (watch), `npm run build`, `npm test` (test files next to target).
