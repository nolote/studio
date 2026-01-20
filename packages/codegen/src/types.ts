export interface FileChange {
  path: string
  content: string
}

export interface ParsedAiResponse {
  /**
   * The human-readable assistant message (everything before the first File: block),
   * trimmed. This is what you typically show in the chat UI.
   */
  summary: string
  files: FileChange[]
  dependencies: string[]
  raw: string
}

export interface ApplyResult {
  writtenFiles: string[]
  installedDependencies: string[]
  /**
   * Dependencies that were requested by the AI, but could not be installed.
   * (Common causes: hallucinated packages, 404s, registry/network issues.)
   */
  skippedDependencies: string[]
}
