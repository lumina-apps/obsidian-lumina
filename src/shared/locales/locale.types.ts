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
  systemTranslate: string;
  llmRequired: string;
  warningCost: string;
  option: TranslationSettingsConnectionsLanguageOption;
  current: string;
  deleteCache: string;
  deleteCacheTooltip: string;
  deleteCacheTitle: string;
  deleteCacheConfirm: string;
}

export interface TranslationSettingsConnectionsApiKey {
  name: string;
  desc: string;
  mobileLocalWarning: string;
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
  newConnection: string;
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

export interface TranslationSettingsConnectionsDefaultChatModel {
  name: string;
  desc: string;
  sidebarDefault: string;
  noConnections: string;
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
  disconnected: string;
}

export interface TranslationSettingsConnections {
  title: string;
  provider: string;
  language: TranslationSettingsConnectionsLanguage;
  apiKey: TranslationSettingsConnectionsApiKey;
  ragEngine: TranslationSettingsConnectionsRagEngine;
  customEmbedding: TranslationSettingsConnectionsCustomEmbedding;
  defaultChatModel: TranslationSettingsConnectionsDefaultChatModel;
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

export interface TranslationSettingsMcpPermission {
  title: string;
  desc: string;
  args: string;
  approve: string;
  reject: string;
}

export interface TranslationSettingsMcp {
  title: string;
  desc: string;
  agentMode?: TranslationSettingsMcpAgentMode;
  addServer: string;
  serverName: string;
  transport: string;
  transportDesc: string;
  transportSse: string;
  transportStreamableHttp: string;
  enableDesc: string;
  deleteServer: string;
  emptyServers: string;
  localServerName: string;
  restart: string;
  localServer: TranslationSettingsMcpLocalServer;
  externalServer: TranslationSettingsMcpExternalServer;
  permission: TranslationSettingsMcpPermission;
  experimental: string;
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
  active: string;
  activate: string;
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
}

export interface TranslationSettingsChatContext {
  activeNote: string;
  selectedText: string;
  folderFiles: string;
  activeNotePrefix: string;
  canvasFile: string;
  tagFiles: string;
  activeNotePrompt: string;
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
}

export interface TranslationSettingsChatSendMode {
  name: string;
  desc: string;
  enter: string;
  ctrlEnter: string;
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
  defaults: TranslationSettingsChatQuickActionsDefaults;
}

export interface TranslationSettingsChatInlineTrigger {
  name: string;
  desc: string;
}

export interface TranslationSettingsChatEnableAutocomplete {
  name: string;
  desc: string;
  needsTaskModel: string;
}

export interface TranslationSettingsChatMemoryLimit {
  name: string;
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
  name: string;
  desc: string;
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
  currentNote: string;
  systemPrompt: TranslationSettingsChatSystemPrompt;
  history: TranslationSettingsChatHistory;
  context: TranslationSettingsChatContext;
  sendMode: TranslationSettingsChatSendMode;
  quickActions: TranslationSettingsChatQuickActions;
  inlineTrigger: TranslationSettingsChatInlineTrigger;
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
export interface TranslationSettingsRagDataScope {
  name: string;
  desc: string;
  vaultWide: string;
  activeNote: string;
  manual: string;
}

export interface TranslationSettingsRagAutoIncludeActive {
  name: string;
  desc: string;
}

export interface TranslationSettingsRagIncludePaths {
  name: string;
  desc: string;
}

export interface TranslationSettingsRagIgnorePaths {
  name: string;
  desc: string;
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

export interface TranslationSettingsRagMaxFileSize {
	name: string;
	desc: string;
}

export interface TranslationSettingsRagReindex {
  name: string;
  desc: string;
  button: string;
  notActivated: string;
  started: string;
  success: string;
  fail: string;
}

export interface TranslationSettingsRagStatus {
  name: string;
  desc: string;
  statusLabel: string;
  indexing: string;
  files: string;
  size: string;
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
  name: string;
  desc: string;
  button: string;
  devNotice: string;
  resetConfirm: string;
  resetSuccess: string;
}

export interface TranslationSettingsRag {
  toggleTooltip: string;
  title: string;
  embeddingWarning: string;
  disabledWarning: string;
  dataScope: TranslationSettingsRagDataScope;
  autoIncludeActive: TranslationSettingsRagAutoIncludeActive;
  includePaths: TranslationSettingsRagIncludePaths;
  ignorePaths: TranslationSettingsRagIgnorePaths;
  chunking: TranslationSettingsRagChunking;
  topK: TranslationSettingsRagTopK;
  syncMode: TranslationSettingsRagSyncMode;
	minSimilarity: TranslationSettingsRagMinSimilarity;
	maxFileSize: TranslationSettingsRagMaxFileSize;
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
  devNotice: string;
  confirmTitle: string;
  confirmMsg: string;
  success: string;
}

export interface TranslationSettingsMiscDonate {
  name: string;
  desc: string;
  supportTitle: string;
  kofi: string;
  ctee: string;
  githubSponsors: string;
}

export interface TranslationSettingsMisc {
  title: string;
  contextMenu: TranslationSettingsMiscContextMenu;
  ribbonIcon: TranslationSettingsMiscRibbonIcon;
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
  connectFail: string;
  anthropicNoEmbed: string;
  visionNotSupported: string;
  timeoutTTFT: string;
  timeoutInterToken: string;
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

export interface TranslationSettings {
  showAdvanced: string;
  connections: TranslationSettingsConnections;
  mcp: TranslationSettingsMcp;
  webSearch: TranslationSettingsWebSearch;
  chat: TranslationSettingsChat;
  rag: TranslationSettingsRag;
  misc: TranslationSettingsMisc;
  providerErrors: TranslationSettingsProviderErrors;
  translation: TranslationSettingsTranslation;
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
  ragIndexingFailed: string;
  llmConnectRequired: string;
  resetChat: string;
  chatPlaceholder: string;
  chatEmptyWelcome: string;
  cancelStreaming: string;
  send: string;
  underDevelopment: string;
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
  settings: TranslationChatSlashCommand;
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
}

// common
export interface TranslationCommon {
  save: string;
  cancel: string;
  delete: string;
  remove: string;
  add: string;
  copy: string;
  success: string;
  error: string;
  history: string;
  back: string;
  settings: string;
  loading: string;
  refresh: string;
}

// discovery
export interface TranslationDiscovery {
  tabName: string;
  chatTabName: string;
  searchPlaceholder: string;
  duplicateWarning: string;
  duplicateCompare: string;
  recommendedTags: string;
  relatedNotes: string;
  insertLink: string;
  openInSplit: string;
  chatWithNote: string;
  filterPlaceholder: string;
  emptyStateText: string;
  emptyStateSub: string;
  noResults: string;
  stagedContext: string;
  approxTokens: string;
  startChat: string;
  indexing: string;
  loadingModel: string;
  noActiveEditor: string;
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
    targetFile: string;
    createNote: string;
    deleteNote: string;
    renameNote: string;
    updateFrontmatter: string;
    saveAttachment: string;
    executeCode: string;
    shellCommand: string;
    accept: string;
    reject: string;
    acceptAll: string;
    rejectAll: string;
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
  qaNoProvider: string;
  qaInvalidProvider: string;
  qaNoModel: string;
  qaSelectedText: string;
  qaExecuting: string;
  qaCompleted: string;
  qaError: string;
  qaWaitingAI: string;
  qaEmptyResponse: string;
  qaUnknownError: string;
  qaReasoningDetected: string;
  modalCancel: string;
  modalProceed: string;
  modelPlaceholder: string;
  searchModelShort: string;
  searchPromptShort: string;
  noSearchResults: string;
  unsupportedFileType: string;
  attachFileFailed: string;
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
  ragWorkerTimeout: string;
  ragWorkerTerm: string;
  ragWorkerNotReady: string;
  ragWorkerNotInit: string;
  ragWorkerLoadFail: string;
  localizedPrompt: string;
  cmdCtxMenu: string;
  cmdAutoLinkNote: string;
  cmdChatTitle: string;
  cmdLogTitle: string;
  cmdReindex: string;
  cmdClearIdx: string;
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
  errNoProvider: string;
  errMobileAuto: string;
  mcpTokenCopied: string;
  mcpManagerNotInitialized: string;
  mcpConnectFailed: string;
  mcpLocalServerStartFailed: string;
  mcpDisconnectedDuringExecution: string;
  mcpToolExecutionFailed: string;
  mcpSyncError: string;
  mcpLocalServerRestarted: string;
  mcpLocalServerStarted: string;
  mcpLocalServerStopped: string;
  mcpLocalServerDisconnectAgentDisabled: string;
  mcpClientDisconnected: string;
  mcpClientConnected: string;
  mcpClientToolExecutionFailedStatusError: string;
  mcpClientToolExecuteFailedTryReconnect: string;
  toolExecutionBlockedReadMode: string;
  agentModeLlmRequired: string;
  agentModeLocalServerStarting: string;
  agentModeLocalServerConnecting: string;
  agentModeEnabled: string;
  agentModeDisabled: string;
  agentModeSwitchedToRead: string;
  agentModeSwitchedToEdit: string;
  webSearchEnabled: string;
  webSearchDisabled: string;
  noMessagesToExport: string;
  noMessagesToRegenerate: string;
  contextCompressed: string;
  contextCompressedStats: string;
  tooShortToCompress: string;
  compressFailed: string;
  compressedContextBlock: string;
  agentModeLocalServerStoppedDisabled: string;
  agentModeLocalServerStoppedDisabledShort: string;
  mcpLocalServerTokenInputFromLocal: string;
  mcpLocalServerTokenInputFromLocalTooltip: string;
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
  regenerate: string;
  edit: string;
  openReferenceNote: string;
  ragProgress: {
    searching: string;
    reranking: string;
    compressing: string;
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
  create_note: { desc: string; argPath: string; argContent: string; tooLong: string; alreadyExists: string; parentFolderNotFound: string; success: string };
  search_notes: { desc: string; argQuery: string; foundPrefix: string; noResults: string };
  append_to_note: { desc: string; argPath: string; argContent: string; tooLong: string; notFound: string; maxLengthExceeded: string; success: string };
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
  execute_code: { desc: string };
  run_shell_command: { desc: string };
  run_note_code_block: { desc: string };
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
}

export interface TranslationProjectsSettings {
  defaultProjectName: string;
  title: string;
  defaultDesc: string;
  historyPath: string;
  noSubfolder: string;
  activate: string;
  config: string;
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
  saveSuccess: string;
  nameRequired: string;
  nameExists: string;
  namePlaceholder: string;
  subfolderPlaceholder: string;
  add: string;
  duplicateName: string;
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
}

// DeepPartial 타입
export type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>;
} : T;

// dot-notation TranslationKeys
type Join<K, P> = K extends string | number ?
    P extends string | number ?
    `${K}${"" extends P ? "" : "."}${P}`
    : never : never;

type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20, ...0[]]

type Paths<T, D extends number = 10> = [D] extends [never] ? never : T extends object ?
    { [K in keyof T]-?: K extends string | number ?
        `${K}` | Join<K, Paths<T[K], Prev[D]>>
        : never
    }[keyof T] : ""

export type TranslationKeys = Extract<Paths<Translation>, string>;