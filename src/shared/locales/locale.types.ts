/**
 * en.json과 동기화되는 번역 키 구조 타입 정의.
 * 새 키 추가 시 이 파일도 수동 업데이트 필요.
 */

export interface TranslationSettingsConnectionsLanguageOption {
  en: string;
  ko: string;
  ja: string;
  zh: string;
  'zh-tw': string;
  es: string;
  pt: string;
  de: string;
  fr: string;
  ru: string;
  it: string;
  system: string;
}

export interface TranslationSettingsConnectionsLanguage {
  name: string;
  desc: string;
  llmRequired: string;
  option: TranslationSettingsConnectionsLanguageOption;
  current: string;
  deleteCache: string;
  deleteCacheTooltip: string;
  deleteCacheTitle: string;
  deleteCacheConfirm: string;
}

export interface TranslationSettingsConnectionsApiKey {
  name: string;
  mobileLocalWarning: string;
  useNativeToolsName: string;
  useNativeToolsDesc: string;
  addConnection: string;
  apiKey: string;
  endpointUrl: string;
  hiddenDesc: string;
  testConnection: string;
  testing: string;
  deleteConnection: string;
  connected: string;
  notConnected: string;
  selectModel: string;
  endpointPlaceholder: string;
  success: string;
  fail: string;
  noModels: string;
}

export interface TranslationSettingsConnectionsRagEngine {
  name: string;
  desc: string;
  privacyNotice: string;
  customGuide: string;
  mobileWarning: string;
  ragDisabledForEmbedding: string;
}

export interface TranslationSettingsConnectionsCustomEmbedding {
  name: string;
  desc: string;
  auto: string;
  guide: string;
  localWarn: string;
  mobileWarn: string;
}

export interface TranslationSettingsConnectionsQuickActionProvider {
  name: string;
  desc: string;
}

export interface TranslationSettingsConnectionsQuickActionModel {
  name: string;
  desc: string;
  noneSelected: string;
  reasoningWarning: string;
}

export interface TranslationSettingsConnectionsTaskModel {
  name: string;
  desc: string;
  noneSelected: string;
}

export interface TranslationSettingsConnectionsRerankerModel {
  name: string;
  desc: string;
  noneSelected: string;
}

export interface TranslationSettingsConnectionsConnectionStatus {
  noConnection: string;
  availableModelsCount: string;
  localModelsDisabled: string;
  connectedCountLabel: string;
  success: string;
  syncFail: string;
  mcpDisconnected: string;
  mcpConnected: string;
  connected: string;
}

export interface TranslationSettingsConnections {
  title: string;
  provider: string;
  language: TranslationSettingsConnectionsLanguage;
  apiKey: TranslationSettingsConnectionsApiKey;
  ragEngine: TranslationSettingsConnectionsRagEngine;
  customEmbedding: TranslationSettingsConnectionsCustomEmbedding;
  quickActionProvider: TranslationSettingsConnectionsQuickActionProvider;
  quickActionModel: TranslationSettingsConnectionsQuickActionModel;
  taskModel: TranslationSettingsConnectionsTaskModel;
  rerankerModel: TranslationSettingsConnectionsRerankerModel;
  connectionStatus: TranslationSettingsConnectionsConnectionStatus;
}

// MCP
export interface TranslationSettingsMcpAgentMode {
  name?: string;
  desc?: string;
  maxSteps?: string;
  maxStepsDesc?: string;
  respectRagExclusions?: string;
  respectRagExclusionsDesc?: string;
  readMode?: string;
  editMode?: string;
}

export interface TranslationSettingsMcpLocalServerEnable {
  name: string;
}

export interface TranslationSettingsMcpLocalServerPort {
  name: string;
  desc: string;
}

export interface TranslationSettingsMcpLocalServerToken {
  name: string;
  desc: string;
  regenerate: string;
}

export interface TranslationSettingsMcpLocalServerMaxRead {
  name: string;
  desc: string;
}

export interface TranslationSettingsMcpLocalServerSearchSnippet {
  name: string;
  desc: string;
}

export interface TranslationSettingsMcpLocalServerSearchMaxResults {
  name: string;
  desc: string;
}

export interface TranslationSettingsMcpLocalServerMaxAppend {
  name: string;
  desc: string;
}

export interface TranslationSettingsMcpLocalServerEnableShellCommands {
  name: string;
  desc: string;
}

export interface TranslationSettingsMcpLocalServerSyncCliMcp {
  name: string;
  desc: string;
  confirmTitle: string;
  confirmDesc: string;
}

export interface TranslationSettingsMcpLocalServerCleanupCliMcp {
  name: string;
  desc: string;
  button: string;
}

export interface TranslationSettingsMcpLocalServer {
  sectionTitle: string;
  desc: string;
  enable: TranslationSettingsMcpLocalServerEnable;
  port: TranslationSettingsMcpLocalServerPort;
  token: TranslationSettingsMcpLocalServerToken;
  guide: string;
  maxRead: TranslationSettingsMcpLocalServerMaxRead;
  searchSnippet: TranslationSettingsMcpLocalServerSearchSnippet;
  searchMaxResults: TranslationSettingsMcpLocalServerSearchMaxResults;
  maxAppend: TranslationSettingsMcpLocalServerMaxAppend;
  enableShellCommands: TranslationSettingsMcpLocalServerEnableShellCommands;
  syncCliMcp: TranslationSettingsMcpLocalServerSyncCliMcp;
  cleanupCliMcp: TranslationSettingsMcpLocalServerCleanupCliMcp;
}

export interface TranslationSettingsMcpExternalServerSseUrl {
  name: string;
  desc: string;
}

export interface TranslationSettingsMcpExternalServerToken {
  name: string;
  desc: string;
}

export interface TranslationSettingsMcpExternalServer {
  sectionTitle: string;
  desc: string;
  sseUrl: TranslationSettingsMcpExternalServerSseUrl;
  token: TranslationSettingsMcpExternalServerToken;
}

export interface TranslationSettingsMcp {
  title: string;
  agentMode?: TranslationSettingsMcpAgentMode;
  addServer: string;
  serverName: string;
  enableDesc: string;
  deleteServer: string;
  emptyServers: string;
  localServerName: string;
  localServer: TranslationSettingsMcpLocalServer;
  externalServer: TranslationSettingsMcpExternalServer;
}

// Chat
export interface TranslationSettingsChatQuickSettings {
  systemPrompt: string;
  temperature: string;
  precise: string;
  balanced: string;
  creative: string;
  maxLength: string;
  short: string;
  medium: string;
  long: string;
  allSettings: string;
}

export interface TranslationSettingsChatSystemPrompt {
  name: string;
  desc: string;
  addPrompt: string;
  defaultName: string;
  variablesHint: string;
}

export interface TranslationSettingsChatHistory {
  name: string;
  desc: string;
  pathPlaceholder: string;
  savePath: string;
  savePathDesc: string;
  pathSanitizedWarning: string;
  folderFormat: string;
  folderFormatDesc: string;
  folderFormatPlaceholder: string;
  folderFormatPreview: string;
  folderFormatActiveProjectPreview: string;
  folderFormatInvalid: string;
  folderFormatPresetNone: string;
  folderFormatPresetYear: string;
  folderFormatPresetYearMonth: string;
  folderFormatPresetYearMonthDay: string;
  folderFormatPresetYearMonthDash: string;
  folderFormatPresetCustom: string;
  saveFail: string;
  loadFail: string;
  deleteSuccess: string;
  deleteFail: string;
  deleteConfirm: string;
  title: string;
  empty: string;
  unknownModel: string;
  exportSuccess: string;
  exportFail: string;
  exportToolTip: string;
  searchPlaceholder: string;
  rename: string;
  renameSuccess: string;
  renameFail: string;
}

export interface TranslationSettingsChatContext {
  activeNote: string;
  selectedText: string;
  folderFiles: string;
  activeNotePrefix: string;
  canvasFile: string;
  tagFiles: string;
  categoryActiveNote: string;
  categorySelection: string;
  categoryFolder: string;
  categoryFile: string;
  categoryTag: string;
  categoryUrl: string;
  categoryCanvas: string;
  categoryBack: string;
  categoryTitle: string;
  urlInputPlaceholder: string;
  urlInputPrompt: string;
  includeNote: string;
  excludeNote: string;
  activeNoteNone: string;
  activeNoteExcluded: string;
  includedActiveNoteTooltip: string;
  noActiveNoteTooltip: string;
  excludedActiveNoteTooltip: string;
}

export interface TranslationSettingsChatSendMode {
  name: string;
  enter: string;
  ctrlEnter: string;
  mobileNote: string;
}

export interface TranslationSettingsChatQuickActionsDefaultsItem {
  name: string;
  prompt: string;
}

export interface TranslationSettingsChatQuickActionsDefaults {
  summarize: TranslationSettingsChatQuickActionsDefaultsItem;
  translate: TranslationSettingsChatQuickActionsDefaultsItem;
  explain: TranslationSettingsChatQuickActionsDefaultsItem;
}

export interface TranslationSettingsChatQuickActions {
  name: string;
  desc: string;
  add: string;
  actionName: string;
  actionPrompt: string;
  actionType: string;
  typeReplace: string;
  typeAppend: string;
  typeChat: string;
  newAction: string;
  deleteAction: string;
  slashHint: string;
  slashHintEmpty: string;
  defaults: TranslationSettingsChatQuickActionsDefaults;
}

export interface TranslationSettingsChatInlineTrigger {
  name: string;
  desc: string;
}

export interface TranslationSettingsChatEnableSelectionMiniIcon {
  name: string;
  desc: string;
}

export interface TranslationSettingsChatEnableAutocomplete {
  name: string;
  desc: string;
  needsTaskModel: string;
  mobileUnsupported: string;
  promptName: string;
  promptDesc: string;
  contextLengthName: string;
  contextLengthDesc: string;
  waitTimeName: string;
  waitTimeDesc: string;
}

export interface TranslationSettingsChatMemoryLimit {
  desc: string;
  limitType: string;
  autoSummary: string;
  turns: string;
  tokens: string;
  turnsLabel: string;
  turnsDesc: string;
  maxTokens: string;
}

export interface TranslationSettingsChatModelParams {
  tempLabel: string;
  tempDesc: string;
  maxOutput: string;
  maxOutputDesc: string;
  responseLang: string;
  responseLangDesc: string;
  responseLangAuto: string;
}

export interface TranslationSettingsChatStreaming {
  name: string;
  desc: string;
}

export interface TranslationSettingsChat {
  quickSettings: TranslationSettingsChatQuickSettings;
  title: string;
  systemPrompt: TranslationSettingsChatSystemPrompt;
  history: TranslationSettingsChatHistory;
  context: TranslationSettingsChatContext;
  sendMode: TranslationSettingsChatSendMode;
  quickActions: TranslationSettingsChatQuickActions;
  inlineTrigger: TranslationSettingsChatInlineTrigger;
  enableSelectionMiniIcon: TranslationSettingsChatEnableSelectionMiniIcon;
  enableAutocomplete: TranslationSettingsChatEnableAutocomplete;
  memoryLimit: TranslationSettingsChatMemoryLimit;
  modelParams: TranslationSettingsChatModelParams;
  streaming: TranslationSettingsChatStreaming;
  timeout: {
    ttftLabel: string;
    ttftDesc: string;
    interTokenLabel: string;
    interTokenDesc: string;
  };
  emptyResponseFallback: string;
}

// RAG
export interface TranslationSettingsRagAutoIncludeActive {
  name: string;
}

export interface TranslationSettingsRagChunking {
  parentSizeName: string;
  parentSizeDesc: string;
  parentOverlapName: string;
  parentOverlapDesc: string;
  childSizeName: string;
  childSizeDesc: string;
  childOverlapName: string;
  childOverlapDesc: string;
}

export interface TranslationSettingsRagTopK {
  name: string;
  desc: string;
}

export interface TranslationSettingsRagSyncMode {
  name: string;
  desc: string;
  watch: string;
  manual: string;
  startup: string;
}

export interface TranslationSettingsRagMinSimilarity {
	name: string;
	desc: string;
}

export interface TranslationSettingsRagRelatedNotesMinSimilarity {
	name: string;
	desc: string;
}

export interface TranslationSettingsRagDuplicateThreshold {
	name: string;
	desc: string;
}

export interface TranslationSettingsRagMaxFileSize {
	name: string;
	desc: string;
}

export interface TranslationSettingsRagContentFilter {
	heading: string;
	excludeCodeBlocksName: string;
	excludeCodeBlocksDesc: string;
	excludeImagesName: string;
	excludeImagesDesc: string;
	excludeCommentsName: string;
	excludeCommentsDesc: string;
	excludePatternsName: string;
	excludePatternsDesc: string;
	excludePatternsPlaceholder: string;
}

export interface TranslationSettingsRagReindex {
  button: string;
  notActivated: string;
  started: string;
  success: string;
  fail: string;
}

export interface TranslationSettingsRagStatus {
  name: string;
  statusLabel: string;
  indexing: string;
  files: string;
  ready: string;
  indexingShort: string;
  error: string;
  waiting: string;
}

export interface TranslationSettingsRagInit extends Record<string, string | undefined> {
  loadingModel?: string;
  loadingModelDesc?: string;
  cloudSuccess?: string;
  loadingProgress?: string;
  indexingVault?: string;
  indexingProgressText?: string;
  remainingTimePrefix?: string;
  remainingTimeSec?: string;
  remainingTimeMinSec?: string;
  ready?: string;
  indexFail?: string;
  readyManual?: string;
  initFail?: string;
}

export interface TranslationSettingsRagReset {
  button: string;
  resetConfirm: string;
  resetSuccess: string;
}

export interface TranslationSettingsRag {
  toggleTooltip: string;
  title: string;
  embeddingWarning: string;
  disabledWarning: string;
  autoIncludeActive: TranslationSettingsRagAutoIncludeActive;
  chunking: TranslationSettingsRagChunking;
  topK: TranslationSettingsRagTopK;
  syncMode: TranslationSettingsRagSyncMode;
	minSimilarity: TranslationSettingsRagMinSimilarity;
	relatedNotesMinSimilarity: TranslationSettingsRagRelatedNotesMinSimilarity;
	duplicateThreshold: TranslationSettingsRagDuplicateThreshold;
	maxFileSize: TranslationSettingsRagMaxFileSize;
	contentFilter: TranslationSettingsRagContentFilter;
	reindex: TranslationSettingsRagReindex;
  status: TranslationSettingsRagStatus;
  init: Partial<TranslationSettingsRagInit>;
  reset: TranslationSettingsRagReset;
}

// Misc
export interface TranslationSettingsMiscContextMenu {
  name: string;
  desc: string;
}

export interface TranslationSettingsMiscRibbonIcon {
  name: string;
  desc: string;
}

export interface TranslationSettingsMiscFrontmatter {
  name: string;
  desc: string;
}

export interface TranslationSettingsMiscDebugMode {
  name: string;
  desc: string;
}

export interface TranslationSettingsMiscVersionInfo {
  name: string;
  desc: string;
}

export interface TranslationSettingsMiscFactoryReset {
  name: string;
  desc: string;
  button: string;
  confirmTitle: string;
  confirmMsg: string;
  success: string;
}

export interface TranslationSettingsMiscDonate {
  name: string;
  desc: string;
  kofi: string;
  ctee: string;
  githubSponsors: string;
}

export interface TranslationSettingsMisc {
  title: string;
  contextMenu: TranslationSettingsMiscContextMenu;
  ribbonIcon: TranslationSettingsMiscRibbonIcon;
  graphRibbonIcon: TranslationSettingsMiscRibbonIcon;
  frontmatter: TranslationSettingsMiscFrontmatter;
  debugMode: TranslationSettingsMiscDebugMode;
  versionInfo: TranslationSettingsMiscVersionInfo;
  factoryReset: TranslationSettingsMiscFactoryReset;
  donate: TranslationSettingsMiscDonate;
}
export interface TranslationSettingsWebSearch {
  title: string;
  desc: string;
  enable: { name: string; desc: string; };
  privacyWarning: string;
  notConfigured: string;
  provider: { name: string; desc: string; };
  apiKey: { name: string; desc: string; };
  baseUrl: { name: string; desc: string; };
  googleSearchEngineId: { name: string; desc: string; };
  maxResults: { name: string; desc: string; };
  maxContentLength: { name: string; desc: string; };
}

export interface TranslationSettingsProviderErrors {
  missingUrl: string;
  missingKey: string;
  unknownType: string;
  apiError: string;
  ollamaNoModel: string;
  anthropicNoEmbed: string;
  visionNotSupported: string;
  timeoutTTFT: string;
  timeoutInterToken: string;
  cliDesktopOnly: string;
}

export interface TranslationSettingsTranslation {
  confirmTitle: string;
  confirmMsg: string;
  progressTitle: string;
  progressMsg: string;
  delayLocal: string;
  delayCloud: string;
  success: string;
  fail: string;
  noValidModel: string;
  cacheDeleted: string;
  cacheDeleteFail: string;
  noCache: string;
}

export interface TranslationSettingsCli {
  binaryPathName: string;
  binaryPathDesc: string;
  runningToolPrefix: string;
  waitingApprovalBadge: string;
  approvalPrompt: string;
  approveBtn: string;
  rejectBtn: string;
  diffModalTitle: string;
  viewDiff: string;
}

export interface TranslationSettingsSearch {
  placeholder: string;
  noResults: string;
  clear: string;
}

export interface TranslationSettings {
  showAdvanced: string;
  search: TranslationSettingsSearch;
  connections: TranslationSettingsConnections;
  mcp: TranslationSettingsMcp;
  webSearch: TranslationSettingsWebSearch;
  chat: TranslationSettingsChat;
  rag: TranslationSettingsRag;
  misc: TranslationSettingsMisc;
  providerErrors: TranslationSettingsProviderErrors;
  translation: TranslationSettingsTranslation;
  cli?: TranslationSettingsCli;
}

// errors
export interface TranslationErrorsLlm {
  rateLimit: string;
  unauthorized: string;
  forbidden: string;
  notFound: string;
  serviceUnavailable: string;
  networkError: string;
  notReadable: string;
}

export interface TranslationErrors {
  llmNotConnected: string;
  llmConnectRequired: string;
  chatPlaceholder: string;
  chatEmptyWelcome: string;
  cancelStreaming: string;
  send: string;
  ragDisabledGlobally: string;
  agentDisabledGlobally: string;
  llm: TranslationErrorsLlm;
}

// chat
export interface TranslationChatSlashCommand {
  name: string;
  desc: string;
}

export interface TranslationChatSlashCommands {
  clear: TranslationChatSlashCommand;
  rag: TranslationChatSlashCommand;
  websearch: TranslationChatSlashCommand;
  export: TranslationChatSlashCommand;
  regenerate: TranslationChatSlashCommand;
  compress: TranslationChatSlashCommand;
  mcp: TranslationChatSlashCommand;
  model: TranslationChatSlashCommand;
  prompt: TranslationChatSlashCommand;
  mode: TranslationChatSlashCommand;
  arena: TranslationChatSlashCommand;
  settings: TranslationChatSlashCommand;
  customSection: string;
}

export interface TranslationChatCliMode {
  readModeTooltip: string;
  editModeTooltip: string;
  readModeNotice: string;
  editModeNotice: string;
}

export interface TranslationChat {
  newChat: string;
  history: string;
  settings: string;
  addContext: string;
  uploadFile: string;
  clearInput: string;
  slashCommands: TranslationChatSlashCommands;
  sessionUsage: string;
  sessionTokens: string;
  estimatedTokensTooltip: string;
  tokenOverLimitTooltip: string;
  cliMode: TranslationChatCliMode;
}

// common
export interface TranslationCommon {
  save: string;
  cancel: string;
  delete: string;
  remove: string;
  add: string;
  copy: string;
  error: string;
  back: string;
  settings: string;
  loading: string;
  refresh: string;
  noResults: string;
}

// discovery
export interface TranslationDiscovery {
  tabName: string;
  chatTabName: string;
  searchPlaceholder: string;
  duplicateWarning: string;
  recommendedTags: string;
  relatedNotes: string;
  insertLink: string;
  openInSplit: string;
  filterPlaceholder: string;
  emptyStateText: string;
  emptyStateSub: string;
  noResults: string;
  stagedContext: string;
  approxTokens: string;
  startChat: string;
  noActiveEditor: string;
  tagInserted: string;
  tagInsertFailed: string;
  searchFailed: string;
  indexError: string;
  noActiveFile: string;
  clearSearch: string;
  clearFilter: string;
}

// uiMessages
// summarization
export interface TranslationSummarizationPrompt {
  intro: string;
  previousSummary: string;
  instructionWithSummary: string;
  instructionWithoutSummary: string;
  additionalConversation: string;
  roleUser: string;
  roleAI: string;
}

export interface TranslationSummarization {
  prompt: TranslationSummarizationPrompt;
}

export interface TranslationUiMessages {
  actionApproval: {
    title: string;
    createNote: string;
    deleteNote: string;
    renameNote: string;
    updateFrontmatter: string;
    saveAttachment: string;
    shellCommand: string;
    accept: string;
    reject: string;
    acceptAll: string;
    rejectAll: string;
    tableNotice?: string;
    switchToSourceMode?: string;
    viewInEditor?: string;
    tableBadge?: string;
    mcpTool: string;
    mcpToolDesc: string;
  };
  errorLoadingSettings: string;
  emptyResponseTokenLimit: string;
  tokenLimitHitWarning: string;
  toolExecutionRejected: string;
  inlineReplace: string;
  inlineAppend: string;
  inlineSend: string;
  inlineEmpty: string;
  qaEmptySel: string;
  qaNotConfigured: string;
  qaInvalidProvider: string;
  qaSelectedText: string;
  qaExecuting: string;
  qaCompleted: string;
  qaError: string;
  qaEmptyResponse: string;
  qaUnknownError: string;
  promptBar: {
    commandTitle: string;
    menuTitle: string;
    inlineSuggestName: string;
    inlineSuggestCustom: string;
    placeholder: string;
    modeReplace: string;
    modeAppend: string;
    run: string;
    cancel: string;
    thinking: string;
    generating: string;
    reviewHint: string;
    noModel: string;
    openSettings: string;
    pendingDiffExists: string;
    targetModified: string;
    noChanges: string;
  };
  modalCancel: string;
  modalProceed: string;
  searchModelShort: string;
  favorites: string;
  allModels: string;
  addToFavorites: string;
  removeFromFavorites: string;
  searchPromptShort: string;
  noSearchResults: string;
  unsupportedFileType: string;
  attachFileFailed: string;
  attachWorkerNotReady: string;
  attachFileEmpty: string;
  attachmentsSkipped: string;
  cliImageNotSupported: string;
  attachFileTooLarge: string;
  attachDuplicate: string;
  attachProcessing: string;
  fsAdapterErr: string;
  searchSource: string;
  debugDelAllMsg: string;
  debugAutoScroll: string;
  debugExport: string;
  debugDelAll: string;
  debugNoLogs: string;
  debugWaitLlm: string;
  debugTurnOn: string;
  debugChunks: string;
  debugExpandAll: string;
  debugCollapseAll: string;
  ragTooLong: string;
  ragWorkerInitErr: string;
  ragWorkerTerm: string;
  ragWorkerNotReady: string;
  cmdCtxMenu: string;
  cmdAutoLinkNote: string;
  cmdChatTitle: string;
  cmdLogTitle: string;
  cmdReindex: string;
  cmdClearIdx: string;
  cmdRestoreBackup: string;
  backupRestorePlaceholder: string;
  backupRestoreNone: string;
  backupRestoreDone: string;
  backupRestoreFailed: string;
  autoLinkNoChanges: string;
  autoLinkSuccess: string;
  autoLinkRejected: string;
  autoLinkError: string;
  cmdStripMetadata: string;
  stripMetadataTitle: string;
  stripMetadataBody: string;
  stripMetadataHint: string;
  stripMetadataNone: string;
  stripMetadataProgress: string;
  stripMetadataDone: string;
  ribbonTitle: string;
  noticeMobileRag: string;
  noticeLargeVault: string;
  noticeIndexing: string;
  errMobileAuto: string;
  mcpTokenCopied: string;
  mcpManagerNotInitialized: string;
  mcpConnectFailed: string;
  mcpLocalServerStartFailed: string;
  mcpSyncError: string;
  mcpLocalServerStarted: string;
  mcpLocalServerStopped: string;
  mcpCliCleanupSuccess: string;
  mcpClientDisconnected: string;
  mcpClientConnected: string;
  toolExecutionBlockedReadMode: string;
  agentModeLlmRequired: string;
  agentModeEnabled: string;
  agentModeDisabled: string;
  agentModeSwitchedToRead: string;
  agentModeSwitchedToEdit: string;
  webSearchEnabled: string;
  webSearchDisabled: string;
  webSearchNotNeededForCli: string;
  webSearchNotConfigured: string;
  noMessagesToExport: string;
  noMessagesToRegenerate: string;
  contextCompressed: string;
  contextCompressedStats: string;
  tooShortToCompress: string;
  compressFailed: string;
  compressedContextBlock: string;
  thoughtProcess: string;
  agentMaxStepsReached: string;
  agentRepeatedToolCalls: string;
  agentToolNotFound: string;
  agentToolTruncatedNote: string;
  agentToolResultFor: string;
  agentToolError: string;
  agentToolExecuteError: string;
  agentBetaActivateTitle: string;
  agentBetaActivateDesc: string;
  agentBetaActivateConfirm: string;
  agentBetaActivateSkip: string;
  agentBetaEnabled: string;
  copiedToClipboard: string;
  contentInserted: string;
  noActiveMarkdown: string;
  editConfirm: string;
  regenerateConfirm: string;
  fileNotFound: string;
  saveAndSend: string;
  insertToNote: string;
  appendToNote: string;
  contentAppended: string;
  noActiveNote: string;
  saveAsNote: string;
  saveAsNoteTitle: string;
  saveAsNoteNameLabel: string;
  saveAsNoteNamePlaceholder: string;
  saveAsNoteFolderLabel: string;
  saveAsNoteFolderPlaceholder: string;
  saveAsNoteFolderBrowse: string;
  saveAsNoteFolderRoot: string;
  saveAsNotePathPreview: string;
  noteSaved: string;
  noteSaveFailed: string;
  insertCodeBlock: string;
  regenerate: string;
  edit: string;
  openReferenceNote: string;
  ragProgress: {
    searching: string;
    reranking: string;
    generating: string;
  };
}

// Graph
export interface TranslationGraph {
  title: string;
  settings: string;
  globalMode: string;
  localMode: string;
  searchPlaceholder: string;
  clearSearch: string;
  similarity: string;
  maxLinks: string;
  localDepth: string;
  folder: string;
  connections: string;
  initializing: string;
  indexing: string;
  noNodes: string;
  calculating: string;
  calcError: string;
  exportToCanvas: string;
  exporting: string;
  exportSuccess: string;
  exportError: string;
}

// canvas
export interface TranslationCanvas {
  menuItem: string;
  menuItemFolder: string;
  noticeCreated: string;
  noticeFolderCreated: string;
  noticeTruncated: string;
  noticeNoFiles: string;
  noticeError: string;
  rootGroup: string;
  settings: {
    depth: { name: string; desc: string };
    layout: { name: string; desc: string; radial: string; tree: string };
    bidirectional: { name: string; desc: string };
    includeAttachments: { name: string; desc: string };
    maxNodes: { name: string; desc: string };
    folderDepth: { name: string; desc: string };
    outputPath: { name: string; desc: string };
    showFolderGroups: { name: string; desc: string };
  };
}

// mcpServerTools
export interface TranslationMcpServerToolsCommon {
  truncated: string;
  unknownTool: string;
  executionError: string;
  pathExcluded: string;
}

export interface TranslationMcpServerToolsRagSearch {
  desc: string;
  argQuery: string;
  argTopK: string;
  argMinSimilarity: string;
  notReady: string;
  emptyQuery: string;
  noResults: string;
  error: string;
  summary: string;
}

export interface TranslationMcpServerToolsListNotes {
  desc: string;
  argPath: string;
  noNotes: string;
  listPrefix: string;
}

export interface TranslationMcpServerTools {
  read_active_note: { desc: string; noActive: string };
  read_note: { desc: string; argPath: string; notFound: string };
  create_note: { desc: string; argPath: string; argContent: string; tooLong: string; alreadyExists: string; success: string };
  search_notes: { desc: string; argQuery: string; foundPrefix: string; noResults: string };
  append_to_note: { desc: string; argPath: string; argContent: string; tooLong: string; maxLengthExceeded: string; success: string };
  read_daily_note: { desc: string; notFound: string };
  append_to_daily_note: { desc: string; argContent: string; tooLong: string; maxLengthExceeded: string; successAppend: string; successCreate: string };
  list_notes: TranslationMcpServerToolsListNotes;
  rag_search: TranslationMcpServerToolsRagSearch;
  common: TranslationMcpServerToolsCommon;
  replace_note: { desc: string };
  patch_note: { desc: string };
  delete_note: { desc: string };
  move_note: { desc: string };
  get_backlinks: { desc: string };
  update_frontmatter: { desc: string };
  get_note_metadata: { desc: string };
  list_attachments: { desc: string };
  save_attachment: { desc: string };
  run_shell_command: { desc: string };
  list_tags: { desc: string };
  create_canvas: { desc: string };
  generate_moc: { desc: string };
  auto_link_note: { desc: string };
  query_metadata: { desc: string };
  show_notice: {
    desc: string;
    argMessage: string;
    argDuration: string;
  };
  open_note: { desc: string };
  grep_search: { desc: string };
  glob_files: { desc: string };
  list_folders: { desc: string };
  get_outgoing_links: { desc: string };
  list_tasks: { desc: string };
}

export interface TranslationProjectsSettings {
  defaultProjectName: string;
  title: string;
  defaultDesc: string;
  historyPath: string;
  noSubfolder: string;
  activate: string;
  deleteConfirmTitle: string;
  deleteConfirmDesc: string;
  addProjectBtn: string;
  addProjectDesc: string;
  newProjectTitle: string;
  modalTitle: string;
  modalTitleActive: string;
  activeProjectModelDesc: string;
  projectName: string;
  projectNameDesc: string;
  chatHistoryPath: string;
  chatHistoryPathDesc: string;
  vaultRoot: string;
  ragTargetFolder: string;
  ragTargetFolderDesc: string;
  ragTargetFolderEmpty: string;
  ragExcludedFolders: string;
  ragExcludedFoldersDesc: string;
  ragExcludedFoldersEmpty: string;
  defaultModel: string;
  defaultModelDesc: string;
  defaultModelAuto: string;
  systemPrompt: string;
  systemPromptDesc: string;
  systemPromptAuto: string;
  deletedModel: string;
  deletedPrompt: string;
  save: string;
  add: string;
  chatHistoryRootPlaceholder: string;
  chatHistoryAutoPlaceholder: string;
  chatHistoryPreview: string;
  historyMoved: string;
  historyTargetExists: string;
  historyMoveError: string;
}


export interface TranslationProjectsSelector {
  label: string;
  default: string;
  manage: string;
}

export interface TranslationProjects {
  settings: TranslationProjectsSettings;
  selector: TranslationProjectsSelector;
}

export interface TranslationModal {
  errorProcessing: string;
}

export interface TranslationSplitChat {
  title: string;
  proBadge: string;
  commandTitle: string;
  openTooltip: string;
  newComparison: string;
  historyToggle: string;
  modeSideBySide: string;
  modeBlind: string;
  modeSideBySideTooltip: string;
  modeBlindTooltip: string;
  contextLabel: string;
  contextIndependent: string;
  contextWinner: string;
  contextIndependentTooltip: string;
  contextWinnerTooltip: string;
  addModel: string;
  removeModel: string;
  maxModelsReached: string;
  exportComparison: string;
  exportSuccess: string;
  exportFail: string;
  noTurnsToExport: string;
  inputPlaceholder: string;
  modelsCountSuffix: string;
  emptyTitle: string;
  emptyDesc: string;
  noValidModels: string;
  cliNotSupported: string;
  blindModelLabel: string;
  blindHidden: string;
  blindVotePrompt: string;
  voteSlotWin: string;
  voteTie: string;
  voteBothBad: string;
  revealModels: string;
  winnerBadge: string;
  fastestBadge: string;
  pickWinner: string;
  pickedWinner: string;
  retrySlot: string;
  stopSlot: string;
  expandView: string;
  continueInChat: string;
  promotedToChat: string;
  temperature: string;
  temperatureDefault: string;
  temperatureReset: string;
  waiting: string;
  aborted: string;
  metricsSummary: string;
  metricsTimeOnly: string;
  metricsTtftTooltip: string;
  historyTitle: string;
  historySearchPlaceholder: string;
  historyEmpty: string;
  historyTurnsCount: string;
  historyLoadFail: string;
  historySaveFail: string;
  historyDeleteConfirm: string;
  historyDeleteSuccess: string;
  historyDeleteFail: string;
  historyRenameSuccess: string;
  historyRenameFail: string;
  exportReportTitle: string;
  exportReportMode: string;
  exportReportContext: string;
  exportReportModels: string;
  exportReportSummary: string;
  exportReportWins: string;
  exportReportAvgTime: string;
  exportReportTotalTokens: string;
  exportReportRound: string;
  exportReportPrompt: string;
  exportReportResult: string;
  proMaxSlotsNotice: string;
  proBlindNotice: string;
  proWinnerContextNotice: string;
  proExportNotice: string;
}

export interface TranslationBatchStudioRecipes {
  frontmatter: string;
  frontmatterDesc: string;
  autolink: string;
  autolinkDesc: string;
  summaryCallout: string;
  summaryCalloutDesc: string;
  customPrompt: string;
  customPromptDesc: string;
}

export interface TranslationBatchStudioTarget {
  sectionTitle: string;
  scopeVault: string;
  scopeFolder: string;
  folderPlaceholder: string;
  tagFilterPlaceholder: string;
  skipExistingFm: string;
  skipExistingCallout: string;
  minCharsLabel: string;
  matchedSummary: string;
  collapsedSummary: string;
  expandConfig: string;
  collapseConfig: string;
}

export interface TranslationBatchStudioOptions {
  sectionTitle: string;
  modelLabel: string;
  modelAutoTask: string;
  noModelConfigured: string;
  localOnlyAutolinkNotice: string;
  generateTagsLabel: string;
  generateDescriptionLabel: string;
  fmMergeModeLabel: string;
  fmModeEmptyOnly: string;
  fmModeMerge: string;
  fmModeOverwrite: string;
  calloutTitleLabel: string;
  calloutTitlePlaceholder: string;
  customPromptPlaceholder: string;
  outputModeLabel: string;
  outputFmKey: string;
  outputPrepend: string;
  outputAppend: string;
  outputReplace: string;
  fmKeyPlaceholder: string;
  insertVarHint: string;
}

export interface TranslationBatchStudioSample {
  sectionTitle: string;
  selectNote: string;
  runSampleBtn: string;
  runningSample: string;
  noTargetNotes: string;
  sampleResultTitle: string;
  sampleNoChanges: string;
  sampleError: string;
}

export interface TranslationBatchStudioExecution {
  estimateSummary: string;
  estimateLocalOnly: string;
  snapshotNotice: string;
  startBtn: string;
  startBtnFreeLimited: string;
  pauseBtn: string;
  resumeBtn: string;
  cancelBtn: string;
  retryFailedBtn: string;
  statusIdle: string;
  statusRunning: string;
  statusPaused: string;
  statusCompleted: string;
  progressSummary: string;
  rateLimitWaiting: string;
  alreadyRunningNotice: string;
}

export interface TranslationBatchStudioQueue {
  title: string;
  tabAll: string;
  tabStaged: string;
  tabApplied: string;
  tabSkipped: string;
  tabFailed: string;
  selectAll: string;
  deselectAll: string;
  emptyQueue: string;
  statusQueued: string;
  statusRunning: string;
  statusStaged: string;
  statusApplied: string;
  statusRejected: string;
  statusSkipped: string;
  statusFailed: string;
  statusLocked: string;
}

export interface TranslationBatchStudioInspector {
  title: string;
  emptySelection: string;
  openNoteBtn: string;
  beforeLabel: string;
  afterLabel: string;
  noChanges: string;
  tagsLabel: string;
  descriptionLabel: string;
  customKeyLabel: string;
  addTagPlaceholder: string;
  addTagBtn: string;
  removeTagAria: string;
  rejectBtn: string;
  acceptSingleBtn: string;
  acceptAllSelectedBtn: string;
  appliedBadge: string;
  rejectedBadge: string;
  skippedBadge: string;
  errorTitle: string;
  applySuccessSingle: string;
  applySuccessBatch: string;
}

export interface TranslationBatchStudioHistory {
  tabTitle: string;
  emptyHistory: string;
  batchSummary: string;
  rollbackBtn: string;
  rollbackConfirm: string;
  rollbackDone: string;
  rolledBackBadge: string;
  snapshotsMissing: string;
}

export interface TranslationBatchStudio {
  title: string;
  commandTitle: string;
  folderMenuTitle: string;
  proBadge: string;
  workspaceTab: string;
  recipes: TranslationBatchStudioRecipes;
  target: TranslationBatchStudioTarget;
  options: TranslationBatchStudioOptions;
  sample: TranslationBatchStudioSample;
  execution: TranslationBatchStudioExecution;
  queue: TranslationBatchStudioQueue;
  inspector: TranslationBatchStudioInspector;
  history: TranslationBatchStudioHistory;
  proCustomPromptNotice: string;
  proBulkApplyNotice: string;
  proInspectorTitle: string;
  proInspectorDesc: string;
  proInspectorCta: string;
}

export interface TranslationVoiceNote {
  cmdToggleRecord: string;
  cmdUploadAudio: string;
  cmdProcessPending: string;
  fileMenuTitle: string;
  settings: {
    heading: string;
    recordMode: {
      name: string;
      desc: string;
      postProcess: string;
      liveInsert: string;
    };
    defaultTemplate: {
      name: string;
      desc: string;
      clean: string;
      meeting: string;
      verbatim: string;
    };
    audioStorage: {
      name: string;
      desc: string;
      vault: string;
      discard: string;
    };
    audioFolder: {
      name: string;
      desc: string;
      placeholder: string;
    };
    mobileCaptureMode: {
      name: string;
      desc: string;
      auto: string;
      deferToDesktop: string;
    };
    sttMode: {
      name: string;
      desc: string;
      auto: string;
      provider: string;
      localWhisper: string;
    };
    sttProvider: {
      name: string;
      desc: string;
      noneAvailable: string;
    };
    llmModel: {
      name: string;
      desc: string;
      autoOption: string;
    };
    localWhisperModel: {
      name: string;
      desc: string;
      tiny: string;
      base: string;
      small: string;
    };
    language: {
      name: string;
      desc: string;
      auto: string;
    };
    autoWikiLink: {
      name: string;
      desc: string;
    };
    includeRawTranscript: {
      name: string;
      desc: string;
    };
    customVocabulary: {
      name: string;
      desc: string;
      placeholder: string;
    };
  };
  recorder: {
    title: string;
    recording: string;
    paused: string;
    pause: string;
    resume: string;
    stopAndProcess: string;
    cancel: string;
    captionsToggle: string;
    noCaptionsYet: string;
    mobileScreenHint: string;
    recoverPrompt: string;
    recoverBtn: string;
    discardRecoverBtn: string;
    closeError: string;
  };
  progress: {
    stepTranscribing: string;
    stepLinking: string;
    stepFormatting: string;
    loadingLocalModel: string;
    chunkProgress: string;
  };
  review: {
    applyBtn: string;
    reprocessLabel: string;
    rawOnlyBtn: string;
    undoBtn: string;
    appliedNotice: string;
    reformattedNotice: string;
    undoneNotice: string;
  };
  templates: {
    clean: string;
    meeting: string;
    verbatim: string;
  };
  output: {
    summaryTitle: string;
    rawTranscriptTitle: string;
  };
  notices: {
    micPermissionDenied: string;
    noAudioRecorded: string;
    noSttAvailable: string;
    noLlmAvailable: string;
    localWhisperMobileUnsupported: string;
    fileTooLargeDecodeError: string;
    transcribeFailed: string;
    recoveredSuccess: string;
    createdNote: string;
    audioSaved: string;
  };
  deferred: {
    calloutPending: string;
    stopAndSave: string;
    mobileDeferredHint: string;
    savedForDesktopNotice: string;
    localWhisperMobileInfo: string;
    bannerReady: string;
    bannerWaitingAudio: string;
    convertAllBtn: string;
    laterBtn: string;
    batchProgress: string;
    batchCompletedNotice: string;
    noPendingNotice: string;
    waitingAudioNotice: string;
    desktopOnlyNotice: string;
  };
  proMaxDurationReachedNotice: string;
  proFileTooLongNotice: string;
  proTemplateNotice: string;
  proSettingNotice: string;
}

export interface TranslationProUpgrade {
  toastAction: string;
  modalTitle: string;
  modalSubtitle: string;
  splitTitle: string;
  splitDesc: string;
  batchTitle: string;
  batchDesc: string;
  voiceTitle: string;
  voiceDesc: string;
  licenseHeading: string;
  licensePlaceholder: string;
  activateBtn: string;
  licenseEmptyNotice: string;
  licensePreLaunchNotice: string;
  closeBtn: string;
}

// 최상위 Translation 타입
export interface Translation {
  settings: TranslationSettings;
  errors: TranslationErrors;
  chat: TranslationChat;
  common: TranslationCommon;
  discovery: TranslationDiscovery;
  uiMessages: TranslationUiMessages;
  mcpServerTools: TranslationMcpServerTools;
  graph: TranslationGraph;
  canvas: TranslationCanvas;
  summarization: TranslationSummarization;
  projects: TranslationProjects;
  modal: TranslationModal;
  splitChat: TranslationSplitChat;
  batchStudio: TranslationBatchStudio;
  voiceNote: TranslationVoiceNote;
  proUpgrade: TranslationProUpgrade;
}

// DeepPartial 타입
export type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>;
} : T;

// dot-notation TranslationKeys
type DotPrefix<T extends string> = T extends "" ? "" : `.${T}`;

export type DotNestedKeys<T> = (
  T extends object
    ? { [K in Exclude<keyof T, symbol>]: `${K}${DotPrefix<DotNestedKeys<T[K]>>}` }[Exclude<keyof T, symbol>]
    : ""
) extends infer D ? Extract<D, string> : never;

export type TranslationKeys = DotNestedKeys<Translation>;