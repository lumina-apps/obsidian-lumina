# obsidian-lumina Agent Rules

## 1. CORE PRINCIPLES
- Read files/grep patterns before coding. Match existing styles. Ask if ambiguous.
- No unsolicited refactoring. Minimal changes. Keep existing comments/JSDoc.
- Write all new comments and JSDoc in **Korean**.
- Update/add `*.test.ts` alongside features and verify with `npm run build && npm test`.
- **NO Git Commits**: Never run `git commit` or `git push` unless explicitly requested by the user.

## 2. ARCHITECTURE & DEPENDENCIES
- **Structure**:
  - `src/core/`: Infrastructure (`commands`, `events`, `llm-providers`, `mcp`, `settings`, `store`, `views`, and bundler/test module aliases in `mocks`).
  - `src/features/`: Domains (`backup`, `canvas`, `chat`, `debug`, `editor`, `frontmatter`, `graph`, `projects`, `rag`, `web-search`).
  - `src/shared/`: Shared utilities (`constants`, `locales`, `types`, `utils`, `debugLogger.ts`, `icons.ts`, `svgIcons.ts`).
- **Import Direction**: `features/` -> `core/` -> `shared/` (higher layers import from lower layers).
  - Do NOT add new reverse dependencies (`shared -> core`, `core -> features`) or new cross-feature imports.
  - *Allowed existing exceptions*: `features/chat` importing `features/rag` and `features/web-search`; `core/settings/tabs` and `core/mcp/server/handlers` invoking feature services (`rag`, `projects`, `backup`).
- **Init & Lifecycle**: `src/main.ts` (Thin orchestration). Keep `onload()` lightweight -> lazy-load heavy modules via dynamic `import()` inside `onLayoutReady()` -> clean up in `onunload()`.

## 3. STACK & CONVENTIONS
- **TypeScript**: `strict`. NO `any` (use `unknown` + type narrowing). Bypass (`as any`) causes review rejection.
- **Svelte 5**:
  - *Components (`*.svelte`)*: Runes ONLY (`$state`, `$derived`, `$effect`, `$props`). NO Svelte 4 syntax (`$:`, `export let`, `createEventDispatcher`, `on:click`). PascalCase filenames.
  - *State*: Use `$state` (or `*.svelte.ts` composables) for local UI state. Use `src/core/store/` (`svelte/store` `writable`/`derived`) ONLY for global/plugin-lifecycle state; sync settings via `syncSettingsStore()`.
  - *Style*: Use Obsidian CSS vars (`var(--text-normal)`). Scoped `<style>` for components.
- **Async**: `async/await`. Use `void` only if explicitly ignoring a promise. Prefer `window.setTimeout` / `window.clearTimeout` in browser/worker contexts.
- **Errors**: `try/catch` -> `debugLogger.logError(domain, normalizeError(err))` (from `src/shared/utils/errorUtils.ts`) -> `new Notice(t('...'))`.
- **i18n**: Use `t('key')` from `src/shared/locales/helpers.ts`. When adding keys, update `en.json` (source of truth), `src/shared/locales/locale.types.ts`, and ALL `src/shared/locales/*.json` files (`de`, `en`, `es`, `fr`, `it`, `ja`, `ko`, `pt`, `ru`, `zh`, `zh-tw`).
- **UI**: Check `Platform.isMobile`. Clean up events, intervals, and DOM on destroy (`onunload`, `destroy()`, or `unmount`).
- **Cross-Platform**: Ensure Windows compatibility. Use Obsidian `normalizePath` for paths and `sanitizeFilename` / `sanitizeFilePath` from `src/shared/utils/fileUtils.ts` (removes `\/:*?"<>|`).

## 4. FORBIDDEN (Obsidian Guidelines)
- `eval()`, `new Function()`, `innerHTML`, `outerHTML` -> Use `createEl` / `createDiv` / `setIcon`. In Svelte, `{@html}` is allowed ONLY for trusted static SVG constants (`svgIcons.ts`), NEVER for user/LLM content.
- `console.log`, `console.info`, `console.debug` -> Use `debugLogger.logInfo` / `logDebug` / `logWarn` / `logError`. (`console.warn` and `console.error` are allowed as fallback.)
- Dangling event listeners or timers (memory leaks).
- Testing Obsidian API without `vitest.setup.ts` / `src/core/mocks/obsidian.js` mocks.
- Reading settings from disk directly -> Use `plugin.settings.x` (or `$settingsStore` in UI) and `SecretStorage` via `settingsManager` for secrets.

## 5. WORKFLOWS
- **New Feature**: Implement a domain manager class (e.g., `XxxManager` with `destroy()` cleanup) -> lazy-load in `main.ts` `onLayoutReady()` -> call `.destroy()` in `main.ts` `onunload()`.
- **Settings**: Update `src/shared/types/settings.types.ts` & `src/core/settings/settings.types.ts` -> `defaultSettings.ts` -> `migrations.ts` (+ `migrations.test.ts`) -> `src/core/settings/tabs/` -> `locale.types.ts` & all `src/shared/locales/*.json`.
- **MCP/LLM**: Mimic existing files in `src/core/mcp/` or `src/core/llm-providers/`.

## 6. SECURITY (Require Human Review)
- API keys & `SecretStorage` (`src/core/settings/settingsManager.ts`), MCP execution & path guards (`src/core/mcp/`), HITL approval flow (`approvalStore` / `approvalListener`), Backup/Restore (`src/features/backup/`), File Delete/Move tools.

## 7. COMMANDS
- `npm run dev`: Watch build (`esbuild.config.mjs`).
- `npm run build`: Type-check (`tsc -noEmit -skipLibCheck`) + production bundle.
- `npm test`: Unit tests (`vitest run`, `*.test.ts` colocated next to target).
- `npm run test:watch` / `npm run test:coverage` / `npm run test:e2e`: Watch, coverage, and E2E tests.
