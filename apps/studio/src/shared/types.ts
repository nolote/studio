export type AiMode = 'cloud' | 'local'

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: string
}

export interface EnvVarPair {
  key: string
  value: string
}

export interface AppSettings {
  projectsRoot: string
  openaiApiKey: string
  aiMode: AiMode
  cloudModel: string
  localModelPath: string
  envVars: EnvVarPair[]
}

export interface TemplateSummary {
  id: string
  name: string
  description?: string
  thumbnail?: string
  overlayDir?: string
  tags: string[]
}

export interface ProjectSummary {
  name: string
  path: string
  createdAt: string
  templateId?: string
}

export interface CreateProjectRequest {
  name: string
  templateId: string
  aiMode: AiMode
  cloudModel?: string
  localModel?: string
  enableImageGeneration?: boolean
  initGit?: boolean
}

export interface FileTreeNode {
  path: string
  name: string
  type: 'dir' | 'file'
  children?: FileTreeNode[]
}

export interface SelectDirectoryOptions {
  defaultPath?: string
}

export interface AiRunRequest {
  projectPath: string
  prompt: string
  requestId?: string
  /**
   * When true, the engine must return at least one File block and/or a Dependencies line.
   * Used by the auto-fix flow to ensure something is actually applied.
   */
  requireFileChanges?: boolean
}

export interface AiRunResult {
  chat: ChatMessage[]
  appliedFiles: string[]
  installedDependencies: string[]
  skippedDependencies?: string[]
  /**
   * True when the AI request was aborted (user pressed Stop) or timed out.
   * When true, `chat` will include a final assistant message explaining what happened.
   */
  cancelled?: boolean
}

export type PreviewState = 'stopped' | 'starting' | 'running' | 'error'

export interface PreviewStartOptions {
  projectPath?: string
  port?: number
  autoInstallDeps?: boolean
  host?: string
}

export interface PreviewStatus {
  projectPath: string
  state: PreviewState
  url?: string
  host?: string
  port?: number
  pid?: number
  startedAt?: string
  error?: string
  lastLog?: string
}

export interface PreviewLogsOptions {
  tail?: number
}

export interface DesignSelection {
  /** A CSS selector that identifies the element inside the preview DOM. */
  selector: string
  /** Lowercase HTML tag name (e.g. "h1", "button", "div"). */
  tag: string
  /** Best-effort user-visible text for the element (trimmed). */
  text?: string
  /** Best-effort className / class attribute string for the element. */
  className?: string
}

export interface DesignApplyRequest {
  /** Absolute path to the project on disk. */
  projectPath: string
  /** Current route in the preview (e.g. "/", "/about"). Used to pick a primary target file. */
  route: string
  /** CSS selector for the selected element (from DesignSelection.selector). */
  selector: string

  /** Text replacement (best-effort). */
  originalText?: string
  newText?: string

  /** className replacement (best-effort). */
  originalClassName?: string
  newClassName?: string
}

export interface DesignApplyResult {
  ok: boolean
  /** Relative path (from project root) of the file updated, if any. */
  updatedFile?: string
  /** Human-readable message, especially on failures. */
  message?: string
}

export interface studioApi {
  projects: {
    list: () => Promise<ProjectSummary[]>
    create: (req: CreateProjectRequest) => Promise<ProjectSummary>
    /**
     * Back-compat helper: some UI code expects the project file tree under projects.tree().
     * Prefer fs.tree() for arbitrary folders.
     */
    tree: (projectPath: string, opts?: { maxDepth?: number }) => Promise<FileTreeNode>
  }
  templates: {
    list: () => Promise<TemplateSummary[]>
    /**
     * Returns a data URL (data:image/...;base64,...) for the template thumbnail.
     * Works with CSP (img-src 'self' data:).
     */
    thumbnailData: (templateId: string) => Promise<string | null>
  }
  fs: {
    tree: (rootPath: string, opts?: { maxDepth?: number }) => Promise<FileTreeNode>
  }
  settings: {
    get: () => Promise<AppSettings>
    save: (settings: AppSettings) => Promise<AppSettings>
  }
  chat: {
    load: (projectPath: string) => Promise<ChatMessage[]>
    clear: (projectPath: string) => Promise<void>
    /**
     * Back-compat: older builds used chat.read/chat.write.
     */
    read: (projectPath: string) => Promise<ChatMessage[]>
    write: (projectPath: string, chat: ChatMessage[]) => Promise<boolean>
  }
  ai: {
    run: (req: AiRunRequest) => Promise<AiRunResult>
    cancel: (requestId: string) => Promise<void>
  }
  preview: {
    start: (projectPath: string, opts?: PreviewStartOptions) => Promise<PreviewStatus>
    stop: (projectPath: string) => Promise<boolean>
    status: (projectPath: string) => Promise<PreviewStatus>
    logs: (projectPath: string, opts?: PreviewLogsOptions) => Promise<string[]>
  }
  design: {
    /** Apply a visual (WYSIWYG) edit to the project's source code (best-effort). */
    apply: (req: DesignApplyRequest) => Promise<DesignApplyResult>
  }
  dialog: {
    selectDirectory: (opts?: SelectDirectoryOptions) => Promise<string | null>
  }
}

/**
 * Back-compat helpers.
 * Some older UI code used flat function names (window.api.projectsCreate).
 * Keep these around so refactors don't break the renderer.
 */
export interface studioApiCompat {
  projectsList: () => Promise<ProjectSummary[]>
  projectsCreate: (req: CreateProjectRequest) => Promise<ProjectSummary>
  projectsTree: (projectPath: string, opts?: { maxDepth?: number }) => Promise<FileTreeNode>
  chatRead: (projectPath: string) => Promise<ChatMessage[]>
  chatWrite: (projectPath: string, chat: ChatMessage[]) => Promise<boolean>
  previewStart: (projectPath: string, opts?: PreviewStartOptions) => Promise<PreviewStatus>
  previewStop: (projectPath: string) => Promise<boolean>
  previewStatus: (projectPath: string) => Promise<PreviewStatus>
  previewLogs: (projectPath: string, opts?: PreviewLogsOptions) => Promise<string[]>
  designApply: (req: DesignApplyRequest) => Promise<DesignApplyResult>
}

export type studioApiWithCompat = studioApi & studioApiCompat
