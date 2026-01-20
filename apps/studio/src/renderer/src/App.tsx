import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppSettings,
  ChatMessage,
  CreateProjectRequest,
  FileTreeNode,
  ProjectSummary,
  TemplateSummary,
  PreviewStatus,
  DesignSelection,
  DesignApplyRequest,
  DesignApplyResult
} from '@shared/types'

import { ResizablePanels } from './components/studio/ResizablePanels'

const APP_TITLE = 'Studio'

type PreviewRuntimeError = {
  message: string
  stack?: string
  route?: string
  source?: string
  at: string
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16)
}

function clampText(s: string, max: number) {
  const trimmed = s.trim()
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max - 1) + '…'
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function normalizeRoute(raw: string): string {
  const r = (raw || '/').trim() || '/'
  return r.startsWith('/') ? r : `/${r}`
}

function findLikelyErrorLine(lines: string[]): string | null {
  const start = Math.max(0, lines.length - 160)
  for (let i = lines.length - 1; i >= start; i--) {
    const line = (lines[i] ?? '').trim()
    if (!line) continue
    const low = line.toLowerCase()

    if (line.startsWith('✖')) return line

    if (
      low.startsWith('error:') ||
      low.includes('failed to compile') ||
      low.includes('module not found')
    )
      return line
    if (
      low.includes('cannot find module') ||
      low.includes('syntaxerror') ||
      low.includes('referenceerror')
    )
      return line
    if (
      low.includes('typeerror') ||
      low.includes('unhandledrejection') ||
      low.includes('unhandled rejection')
    )
      return line
  }
  return null
}

function Pill(props: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
      {props.children}
    </span>
  )
}

function Modal(props: {
  open: boolean
  title: string
  children: React.ReactNode
  onClose: () => void
  widthClassName?: string
}) {
  if (!props.open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        className={`w-full border border-border bg-popover text-popover-foreground shadow-2xl ${props.widthClassName ?? 'max-w-xl'}`}
      >
        <div className="flex items-center justify-between border-b border-border bg-[var(--titlebar-bg)] px-4 py-3">
          <div className="text-sm font-semibold text-foreground">{props.title}</div>
          <button
            className="border border-border bg-secondary px-2 py-1 text-xs text-foreground hover:bg-[#454545]"
            onClick={props.onClose}
          >
            Close
          </button>
        </div>
        <div className="p-4">{props.children}</div>
      </div>
    </div>
  )
}

function TabButton(props: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  const base = 'px-3 py-2 text-xs font-medium uppercase tracking-wide border-b-2 transition-colors '
  const active = props.active
    ? 'text-foreground border-primary bg-[var(--pane-bg)]'
    : 'text-muted-foreground border-transparent bg-[var(--toolbar-bg)] hover:text-foreground hover:bg-[var(--hover-bg)]'
  const disabled = props.disabled ? ' opacity-40 cursor-not-allowed' : ' cursor-pointer'

  return (
    <button
      className={`${base}${active}${disabled} ${props.className ?? ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      type="button"
    >
      {props.children}
    </button>
  )
}

function ToolButton(props: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  title?: string
  className?: string
}) {
  const base =
    'inline-flex items-center gap-2 border border-border bg-secondary px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-[#454545] disabled:opacity-50 disabled:cursor-not-allowed'
  const active = props.active ? ' ring-1 ring-primary' : ''
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`${base} ${active} ${props.className ?? ''}`}
    >
      {props.children}
    </button>
  )
}

function IconButton(props: {
  label: string
  title?: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={props.title ?? props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className="inline-flex h-8 w-8 items-center justify-center border border-border bg-secondary text-foreground hover:bg-[#454545] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span className="text-sm leading-none">{props.label}</span>
    </button>
  )
}

function TreeView(props: { root: FileTreeNode | null; onOpenFile?: (path: string) => void }) {
  if (!props.root) {
    return <div className="text-xs text-muted-foreground">No project loaded.</div>
  }

  function NodeView({ node, depth }: { node: FileTreeNode; depth: number }) {
    const pad = depth * 10
    if (node.type === 'dir') {
      return (
        <div>
          <div className="truncate text-xs text-foreground" style={{ paddingLeft: pad }}>
            <span className="mr-1">📁</span>
            <span className="opacity-90">{node.name}</span>
          </div>
          <div className="space-y-0.5">
            {(node.children ?? []).map((c) => (
              <NodeView key={c.path} node={c} depth={depth + 1} />
            ))}
          </div>
        </div>
      )
    }

    return (
      <button
        className="block w-full truncate text-left text-xs text-foreground hover:bg-[var(--hover-bg)]"
        style={{ paddingLeft: pad }}
        onClick={() => props.onOpenFile?.(node.path)}
        title={node.path}
      >
        <span className="mr-1">📄</span>
        <span className="opacity-90">{node.name}</span>
      </button>
    )
  }

  return (
    <div className="space-y-0.5">
      <NodeView node={props.root} depth={0} />
    </div>
  )
}

function SettingsModal(props: {
  open: boolean
  onClose: () => void
  initial: AppSettings
  onSaved: (next: AppSettings) => void
}) {
  const [draft, setDraft] = useState<AppSettings>(props.initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (props.open) {
      setDraft(props.initial)
      setSaving(false)
      setError(null)
    }
  }, [props.open, props.initial])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const saved = await window.api.settings.save(draft)
      props.onSaved(saved)
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={props.open} title="Settings" onClose={props.onClose} widthClassName="max-w-2xl">
      <div className="space-y-4">
        {error && (
          <div className="border border-[color:var(--error)] bg-[color:rgba(241,76,76,0.12)] p-3 text-sm text-[color:var(--error)]">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <div className="text-sm font-semibold">Projects folder</div>
          <input
            className="w-full border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:outline-1 focus:outline-primary"
            value={draft.projectsRoot}
            onChange={(e) => setDraft((d) => ({ ...d, projectsRoot: e.target.value }))}
            placeholder="e.g., /Users/you/studioProjects"
          />
          <div className="text-xs text-muted-foreground">
            Where studio stores generated projects on your machine.
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">OpenAI API key</div>
          <input
            className="w-full border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:outline-1 focus:outline-primary"
            value={draft.openaiApiKey ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, openaiApiKey: e.target.value }))}
            placeholder="sk-..."
          />
          <div className="text-xs text-muted-foreground">
            Only needed if you want to use cloud models. Leave blank for local-only use.
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">Local model</div>
          <input
            className="w-full border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:outline-1 focus:outline-primary"
            value={draft.localModelPath ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, localModelPath: e.target.value }))}
            placeholder="ollama:llama3.1"
          />
          <div className="text-xs text-muted-foreground">
            Format: <code>provider:model</code> (example: <code>ollama:llama3.1</code>). To change
            the Ollama server URL, set <code>studio_OLLAMA_BASE_URL</code>.
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            className="rounded border px-4 py-2 text-sm hover:bg-[#454545]"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-[#106ebe] disabled:opacity-50"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function NewProjectModal(props: {
  open: boolean
  onClose: () => void
  templates: TemplateSummary[]
  onCreate: (req: CreateProjectRequest) => Promise<void>
  settingsOpen: () => void
}) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState<'scratch' | string>('scratch')
  const [aiMode, setAiMode] = useState<'local' | 'cloud'>('cloud')
  const [cloudModel, setCloudModel] = useState('gpt-4')
  const [localModel, setLocalModel] = useState('ollama:llama3.1')
  const [enableImageGeneration, setEnableImageGeneration] = useState(false)
  const [initGit, setInitGit] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allTemplates = useMemo(() => {
    return [
      {
        id: 'scratch',
        name: 'Start from scratch',
        description: 'Base Next.js scaffold',
        tags: [] as string[]
      }
    ].concat(
      props.templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        tags: t.tags
      }))
    )
  }, [props.templates])

  useEffect(() => {
    if (props.open) {
      setStep(0)
      setName('')
      setTemplateId('scratch')
      setAiMode('cloud')
      setCloudModel('gpt-4')
      setLocalModel('ollama:llama3.1')
      setEnableImageGeneration(false)
      setInitGit(false)
      setCreating(false)
      setError(null)
    }
  }, [props.open])

  async function next() {
    setError(null)
    if (step === 0 && !name.trim()) {
      setError('Please enter a project name.')
      return
    }
    setStep((s) => Math.min(3, s + 1))
  }

  function back() {
    setError(null)
    setStep((s) => Math.max(0, s - 1))
  }

  async function create() {
    setCreating(true)
    setError(null)
    try {
      const req: CreateProjectRequest = {
        name: name.trim(),
        templateId,
        aiMode,
        cloudModel: aiMode === 'cloud' ? cloudModel : undefined,
        localModel: aiMode === 'local' ? localModel : undefined,
        enableImageGeneration,
        initGit
      }
      await props.onCreate(req)
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal open={props.open} title="New Project" onClose={props.onClose} widthClassName="max-w-3xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <div className="text-muted-foreground">
            Step <span className="font-semibold">{step + 1}</span> / 4
          </div>
          <div className="flex gap-2">
            <Pill>Simple mode</Pill>
            <Pill>Milestone 1</Pill>
          </div>
        </div>

        {error && (
          <div className="border border-[color:var(--error)] bg-[color:rgba(241,76,76,0.12)] p-3 text-sm text-[color:var(--error)]">
            {error}
          </div>
        )}

        {step === 0 && (
          <div className="space-y-2">
            <div className="text-sm font-semibold">Project name</div>
            <input
              className="w-full border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:outline-1 focus:outline-primary"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., My SaaS Landing Page"
            />
            <div className="text-xs text-muted-foreground">
              Used for display and the folder name.
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div className="text-sm font-semibold">Choose a template</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {allTemplates.map((t) => (
                <button
                  key={t.id}
                  className={`rounded border p-3 text-left hover:bg-[#454545] ${
                    templateId === t.id ? 'border-primary' : 'border-border'
                  }`}
                  onClick={() => setTemplateId(t.id)}
                >
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{t.description}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {t.tags.map((tag) => (
                      <Pill key={tag}>{tag}</Pill>
                    ))}
                  </div>
                </button>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              Thumbnails can be added later; Milestone 1 can use simple cards like this.
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="text-sm font-semibold">AI mode</div>

            <div className="flex gap-2">
              <button
                className={`rounded border px-3 py-2 text-sm ${aiMode === 'cloud' ? 'border-primary' : 'border-border'}`}
                onClick={() => setAiMode('cloud')}
                title="Use cloud models like GPT-4 (requires API key)"
              >
                Cloud
              </button>
              <button
                className={`rounded border px-3 py-2 text-sm ${aiMode === 'local' ? 'border-primary' : 'border-border'}`}
                onClick={() => setAiMode('local')}
                title="Use a local model (configured later)"
              >
                Local
              </button>
              <button
                className="ml-auto rounded border px-3 py-2 text-sm hover:bg-[#454545]"
                onClick={props.settingsOpen}
                title="Open Settings (API keys, model paths, etc.)"
              >
                Settings…
              </button>
            </div>

            {aiMode === 'cloud' ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">Cloud model</div>
                <select
                  className="w-full border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:outline-1 focus:outline-primary"
                  value={cloudModel}
                  onChange={(e) => setCloudModel(e.target.value)}
                >
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-4o">GPT-4o</option>
                </select>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">Local model</div>
                <input
                  className="w-full border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:outline-1 focus:outline-primary"
                  value={localModel}
                  onChange={(e) => setLocalModel(e.target.value)}
                  placeholder="ollama:llama3.1"
                />
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="text-sm font-semibold">Options</div>

            <label className="flex items-start gap-3 rounded border p-3">
              <input
                type="checkbox"
                checked={enableImageGeneration}
                onChange={(e) => setEnableImageGeneration(e.target.checked)}
              />
              <div>
                <div className="text-sm font-semibold">
                  Use AI image generation for design mockups
                </div>
                <div className="text-xs text-muted-foreground">
                  UI only for now; integration can be added later.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded border p-3">
              <input
                type="checkbox"
                checked={initGit}
                onChange={(e) => setInitGit(e.target.checked)}
              />
              <div>
                <div className="text-sm font-semibold">Initialize a Git repository</div>
                <div className="text-xs text-muted-foreground">
                  This runs <code className="rounded bg-secondary px-1 py-0.5">git init</code> in
                  the project folder.
                </div>
              </div>
            </label>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <button
            className="rounded border px-4 py-2 text-sm hover:bg-[#454545]"
            onClick={back}
            disabled={step === 0}
          >
            Back
          </button>

          {step < 3 ? (
            <button
              className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-[#106ebe]"
              onClick={next}
            >
              Next
            </button>
          ) : (
            <button
              className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-[#106ebe] disabled:opacity-50"
              onClick={create}
              disabled={creating}
            >
              {creating ? 'Creating…' : 'Create Project'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null)
  const [tree, setTree] = useState<FileTreeNode | null>(null)

  const [previewRoute, setPreviewRoute] = useState<string>('/')
  const [previewFrameRoute, setPreviewFrameRoute] = useState<string>('/')
  const [previewFrameNonce, setPreviewFrameNonce] = useState(0)
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus | null>(null)
  const [previewLogs, setPreviewLogs] = useState<string[]>([])
  const [previewStarting, setPreviewStarting] = useState(false)
  const lastProjectPathRef = useRef<string | null>(null)

  const [previewRoutes, setPreviewRoutes] = useState<string[]>(['/'])
  const [previewRoutesLoading, setPreviewRoutesLoading] = useState(false)
  const [previewRoutesQuery, setPreviewRoutesQuery] = useState('')

  const previewIframeRef = useRef<HTMLIFrameElement | null>(null)
  const [designBridgeReady, setDesignBridgeReady] = useState(false)
  const [designInspectEnabled, setDesignInspectEnabled] = useState(false)
  const [designSelection, setDesignSelection] = useState<DesignSelection | null>(null)
  const [designTextDraft, setDesignTextDraft] = useState('')
  const [designClassDraft, setDesignClassDraft] = useState('')
  const [designApplying, setDesignApplying] = useState(false)
  const [designApplyError, setDesignApplyError] = useState<string | null>(null)

  const [previewRuntimeError, setPreviewRuntimeError] = useState<PreviewRuntimeError | null>(null)
  const [, setPreviewLastLoadedAt] = useState<number>(0)

  const [autoFixBusy, setAutoFixBusy] = useState(false)
  const [autoFixError, setAutoFixError] = useState<string | null>(null)
  const [autoFixRequestId, setAutoFixRequestId] = useState<string | null>(null)

  const previewRuntimeErrorRef = useRef<PreviewRuntimeError | null>(null)
  useEffect(() => {
    previewRuntimeErrorRef.current = previewRuntimeError
  }, [previewRuntimeError])

  const previewSrc = useMemo(() => {
    if (!previewStatus || previewStatus.state !== 'running') return null
    const base = previewStatus.url
    if (!base) return null
    const cleanBase = base.replace(/\/$/, '')
    const routeRaw = (previewFrameRoute || '/').trim() || '/'
    const route = routeRaw.startsWith('/') ? routeRaw : `/${routeRaw}`
    return `${cleanBase}${route === '/' ? '/' : route}`
  }, [previewStatus?.state, previewStatus?.url, previewFrameRoute])

  const filteredPreviewRoutes = useMemo(() => {
    const q = previewRoutesQuery.trim().toLowerCase()
    if (!q) return previewRoutes
    return previewRoutes.filter((r) => r.toLowerCase().includes(q))
  }, [previewRoutes, previewRoutesQuery])

  const previewLogErrorLine = useMemo(() => findLikelyErrorLine(previewLogs), [previewLogs])

  const previewIssue = useMemo(() => {
    if (!activeProject) return null
    if (previewStatus?.state === 'error') {
      return {
        kind: 'server' as const,
        title: 'Preview server failed to start',
        details: previewStatus.error ?? 'Unknown error'
      }
    }
    if (previewRuntimeError) {
      return {
        kind: 'runtime' as const,
        title: 'Runtime error in preview',
        details: previewRuntimeError.message
      }
    }
    if (previewLogErrorLine) {
      return {
        kind: 'logs' as const,
        title: 'Error detected in preview logs',
        details: previewLogErrorLine
      }
    }
    return null
  }, [
    activeProject?.path,
    previewStatus?.state,
    previewStatus?.error,
    previewRuntimeError,
    previewLogErrorLine
  ])

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')

  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [leftPaneTab, setLeftPaneTab] = useState<'projects' | 'files'>('projects')
  const [chatPaneTab, setChatPaneTab] = useState<'chat' | 'logs'>('chat')
  const [previewPaneTab, setPreviewPaneTab] = useState<'preview' | 'pages'>('preview')
  const [projectSearch, setProjectSearch] = useState('')

  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiRequestId, setAiRequestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chatEndRef = useRef<HTMLDivElement | null>(null)

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
    )
  }, [projects, projectSearch])

  useEffect(() => {
    if (activeProject) return
    setLeftPaneTab('projects')
    setChatPaneTab('chat')
    setPreviewPaneTab('preview')
  }, [activeProject?.path])

  type AsyncResult<T> = { ok: true; value: T } | { ok: false; error: unknown }

  async function wrap<T>(p: Promise<T>): Promise<AsyncResult<T>> {
    try {
      const value = await p
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error }
    }
  }

  async function refreshProjectsOnly(): Promise<ProjectSummary[]> {
    const pRes = await wrap(window.api.projects.list())
    if (pRes.ok) {
      setProjects(pRes.value)
      return pRes.value
    }
    setError(pRes.error instanceof Error ? pRes.error.message : String(pRes.error))
    return []
  }

  async function refreshAll(): Promise<ProjectSummary[]> {
    setBusy(true)
    setError(null)
    try {
      const [sRes, tRes, pRes] = await Promise.all([
        wrap(window.api.settings.get()),
        wrap(window.api.templates.list()),
        wrap(window.api.projects.list())
      ])

      const errors: string[] = []

      if (sRes.ok) setSettings(sRes.value)
      else errors.push(sRes.error instanceof Error ? sRes.error.message : String(sRes.error))

      if (tRes.ok) setTemplates(tRes.value)
      else errors.push(tRes.error instanceof Error ? tRes.error.message : String(tRes.error))

      if (pRes.ok) {
        setProjects(pRes.value)
      } else {
        errors.push(pRes.error instanceof Error ? pRes.error.message : String(pRes.error))
      }

      if (errors.length > 0) setError(errors.join('\n'))

      return pRes.ok ? pRes.value : []
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let disposed = false

    const boot = async () => {
      for (let i = 0; i < 20; i++) {
        if ((window as any).api) break
        await new Promise((r) => setTimeout(r, 50))
      }
      if (disposed) return

      const p = await refreshAll()
      if (disposed) return

      if (p.length === 0) {
        setTimeout(() => {
          if (!disposed) void refreshProjectsOnly()
        }, 500)
      }
    }

    void boot()

    const onFocus = () => {
      void refreshProjectsOnly()
    }

    const onVisibility = () => {
      if (!document.hidden) void refreshProjectsOnly()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      disposed = true
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (!activeProject) return
    ;(async () => {
      try {
        const nextTree = await window.api.fs.tree(activeProject.path, { maxDepth: 6 })
        setTree(nextTree)
      } catch {
        setTree(null)
      }
    })()
  }, [activeProject])

  useEffect(() => {
    if (!activeProject) return
    void refreshPreviewRoutes(activeProject.path)
  }, [activeProject?.path])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    const nextPath = activeProject?.path ?? null
    const prevPath = lastProjectPathRef.current

    if (prevPath && prevPath !== nextPath) {
      void window.api.preview.stop(prevPath).catch(() => {})
    }

    if (prevPath !== nextPath) {
      setPreviewStatus(null)
      setPreviewLogs([])
      setPreviewRoute('/')
      setPreviewFrameRoute('/')
      setPreviewRoutes(['/'])
      setPreviewRuntimeError(null)
      setAutoFixError(null)
      setAutoFixBusy(false)
      setAutoFixRequestId(null)

      setDesignBridgeReady(false)
      setDesignInspectEnabled(false)
      setDesignSelection(null)
      setPreviewFrameNonce((n) => n + 1)
    }

    lastProjectPathRef.current = nextPath
  }, [activeProject?.path])

  useEffect(() => {
    if (!activeProject) return
    if (previewStarting) return
    void startPreview(false)
  }, [activeProject?.path])

  useEffect(() => {
    if (!activeProject) return

    let cancelled = false
    const projectPath = activeProject.path

    const poll = async () => {
      try {
        const st = await window.api.preview.status(projectPath)
        if (cancelled) return
        setPreviewStatus(st)

        const logs = await window.api.preview.logs(projectPath, { tail: 250 })
        if (cancelled) return
        setPreviewLogs(logs)
      } catch {}
    }

    void poll()
    const interval = window.setInterval(poll, 1200)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [activeProject?.path])

  async function openProject(p: ProjectSummary) {
    setActiveProject(p)
    setLeftPaneTab('files')
    setChatPaneTab('chat')
    setPreviewPaneTab('preview')
    setDraft('')
    setError(null)
    try {
      const chat = await window.api.chat.load(p.path)
      setMessages(chat)
    } catch {
      setMessages([])
    }
  }

  async function cancelAi() {
    const id = autoFixRequestId ?? aiRequestId
    if (!id) return
    try {
      await window.api.ai.cancel(id)
    } finally {
      setAiRequestId(null)
      setAiBusy(false)
      setAutoFixRequestId(null)
      setAutoFixBusy(false)
    }
  }

  async function createProject(req: CreateProjectRequest) {
    const created = await window.api.projects.create(req)
    await refreshAll()
    await openProject(created)
  }

  async function sendMessage() {
    const content = draft.trim()
    if (!content) return
    if (!activeProject) {
      setError('No project is open.')
      return
    }

    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content,
      createdAt: new Date().toISOString()
    }
    const pendingId = uid()
    const pendingMsg: ChatMessage = {
      id: pendingId,
      role: 'assistant',
      content: 'Generating…',
      createdAt: new Date().toISOString()
    }
    setMessages((m) => [...m, userMsg, pendingMsg])
    setDraft('')
    setError(null)

    const requestId = uid()
    setAiRequestId(requestId)
    setAiBusy(true)

    try {
      const res = await window.api.ai.run({
        projectPath: activeProject.path,
        prompt: content,
        requestId,
        requireFileChanges: true
      })
      setMessages(res.chat)
      const t = await window.api.fs.tree(activeProject.path, { maxDepth: 6 })
      setTree(t)

      void refreshPreviewRoutes(activeProject.path)

      const raw = (previewRoute || '/').trim() || '/'
      const route = raw.startsWith('/') ? raw : `/${raw}`
      setPreviewFrameRoute(route)
      setPreviewFrameNonce((n) => n + 1)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setMessages((m) => m.map((x) => (x.id === pendingId ? { ...x, content: `⚠️ ${msg}` } : x)))
      setError(msg)
    } finally {
      setAiBusy(false)
      setAiRequestId(null)
    }
  }

  function onChatKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function closeProject() {
    const projectPath = activeProject?.path
    setActiveProject(null)
    setTree(null)
    setMessages([])
    setPreviewRoute('/')
    setPreviewFrameRoute('/')
    setLeftPaneTab('projects')
    setChatPaneTab('chat')
    setPreviewPaneTab('preview')

    if (projectPath) {
      void window.api.preview.stop(projectPath).catch(() => {})
    }
  }

  function toPosixPath(p: string) {
    return p.replace(/\\/g, '/')
  }

  function guessRouteFromFilePath(filePath: string): string | null {
    const p = toPosixPath(filePath)

    const appMarker = p.includes('/src/app/') ? '/src/app/' : p.includes('/app/') ? '/app/' : null
    if (appMarker) {
      const isPage = /\/page\.(tsx|ts|jsx|js)$/i.test(p)
      if (!isPage) return null

      const after = p.split(appMarker)[1] ?? ''
      const withoutFile = after.replace(/\/page\.(tsx|ts|jsx|js)$/i, '')
      const segments = withoutFile
        .split('/')
        .filter(Boolean)
        .filter((seg) => !(seg.startsWith('(') && seg.endsWith(')')))

      const route = '/' + segments.join('/')
      return route === '/' ? '/' : route
    }

    const pagesMarker = p.includes('/src/pages/')
      ? '/src/pages/'
      : p.includes('/pages/')
        ? '/pages/'
        : null
    if (pagesMarker) {
      if (!/\.(tsx|ts|jsx|js)$/i.test(p)) return null

      const after = p.split(pagesMarker)[1]
      if (!after) return null

      const withoutExt = after.replace(/\.(tsx|ts|jsx|js)$/i, '')
      const segments = withoutExt.split('/').filter(Boolean)

      const last = segments[segments.length - 1] ?? ''
      if (last.startsWith('_')) return null

      if (last === 'index') segments.pop()

      if ((segments[0] ?? '').toLowerCase() === 'api') return null

      const route = '/' + segments.join('/')
      return route === '/' ? '/' : route
    }

    return null
  }

  function collectRoutesFromTree(node: FileTreeNode | null, out: Set<string>) {
    if (!node) return
    if (node.type === 'file') {
      const route = guessRouteFromFilePath(node.path)
      if (route) out.add(route)
      return
    }
    for (const child of node.children ?? []) {
      collectRoutesFromTree(child, out)
    }
  }

  async function refreshPreviewRoutes(projectPath: string) {
    setPreviewRoutesLoading(true)
    try {
      const deep = await window.api.fs.tree(projectPath, { maxDepth: 25 })
      const set = new Set<string>()
      collectRoutesFromTree(deep, set)
      set.add('/')

      const arr = Array.from(set)
      arr.sort((a, b) => {
        if (a === '/' && b !== '/') return -1
        if (b === '/' && a !== '/') return 1
        return a.localeCompare(b)
      })

      setPreviewRoutes(arr)
    } catch {
      setPreviewRoutes(['/'])
    } finally {
      setPreviewRoutesLoading(false)
    }
  }

  async function startPreview(forceRestart: boolean) {
    if (!activeProject) return

    const projectPath = activeProject.path
    setPreviewStarting(true)
    setError(null)
    setAutoFixError(null)
    setPreviewRuntimeError(null)
    previewRuntimeErrorRef.current = null

    try {
      if (forceRestart) {
        await window.api.preview.stop(projectPath).catch(() => {})
      }

      const st = await window.api.preview.start(projectPath, { autoInstallDeps: true })
      setPreviewStatus(st)

      if (st.state === 'error' && st.error) {
        setError(st.error)
      }

      const logs = await window.api.preview.logs(projectPath, { tail: 250 })
      setPreviewLogs(logs)

      const raw = (previewRoute || '/').trim() || '/'
      const route = raw.startsWith('/') ? raw : `/${raw}`
      setPreviewFrameRoute(route)
      setPreviewFrameNonce((n) => n + 1)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setPreviewStatus({
        projectPath,
        state: 'error',
        error: msg
      })
    } finally {
      setPreviewStarting(false)
    }
  }

  async function stopPreview() {
    if (!activeProject) return

    const projectPath = activeProject.path
    setPreviewStarting(true)
    setError(null)
    setAutoFixError(null)
    setPreviewRuntimeError(null)
    previewRuntimeErrorRef.current = null

    try {
      await window.api.preview.stop(projectPath)
      const st = await window.api.preview.status(projectPath)
      setPreviewStatus(st)

      const logs = await window.api.preview.logs(projectPath, { tail: 250 })
      setPreviewLogs(logs)

      const raw = (previewRoute || '/').trim() || '/'
      const route = raw.startsWith('/') ? raw : `/${raw}`
      setPreviewFrameRoute(route)
      setPreviewFrameNonce((n) => n + 1)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setPreviewStatus({
        projectPath,
        state: 'error',
        error: msg
      })
    } finally {
      setPreviewStarting(false)
    }
  }

  async function fixPreviewWithAi() {
    if (!activeProject) return
    if (autoFixBusy || aiBusy) return

    const projectPath = activeProject.path
    const maxAttempts = 3
    const runtimeSnapshot = previewRuntimeErrorRef.current ?? previewRuntimeError

    setAutoFixBusy(true)
    setAutoFixError(null)
    setError(null)

    try {
      let lastFailure: string | null = null

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const st = await window.api.preview.status(projectPath).catch(() => previewStatus)
        const logs = await window.api.preview
          .logs(projectPath, { tail: 350 })
          .catch(() => previewLogs)

        const runtime = previewRuntimeErrorRef.current ?? runtimeSnapshot
        const route = normalizeRoute(previewRoute)

        const prompt = [
          `The project's live preview is broken (auto-fix attempt ${attempt} of ${maxAttempts}).`,
          `Goal: make the project run cleanly in a Next.js dev server and load the route "${route}" without errors.`,
          '',
          'Preview status:',
          st ? JSON.stringify(st, null, 2) : 'unknown',
          '',
          runtime
            ? 'Runtime error (from the browser/iframe):\n' +
              runtime.message +
              (runtime.stack ? '\n\n' + runtime.stack : '')
            : '',
          '',
          'Recent preview logs:',
          '```',
          ...(logs ?? []),
          '```',
          '',
          'Please fix the project so the preview works again.',
          '- Make the minimal changes needed.',
          '- If dependencies are missing, add them and include a Dependencies: [...] line.',
          '- Output any changed files using this exact format:',
          '  File: path/to/file\n  ```tsx\n  ...\n  ```'
        ]
          .filter(Boolean)
          .join('\n')

        const requestId = uid()
        setAutoFixRequestId(requestId)

        const res = await window.api.ai.run({
          projectPath,
          prompt,
          requestId,
          requireFileChanges: true
        })
        setMessages(res.chat)

        if (res.cancelled) {
          return
        }

        if (
          (res.appliedFiles?.length ?? 0) === 0 &&
          (res.installedDependencies?.length ?? 0) === 0
        ) {
          lastFailure =
            'AI did not return any file updates (no File blocks / Dependencies). Try switching to a different model in Settings.'
          break
        }

        try {
          const t = await window.api.fs.tree(projectPath, { maxDepth: 6 })
          setTree(t)
        } catch {}
        void refreshPreviewRoutes(projectPath)

        await startPreview(true)

        await sleep(2500)

        const st2 = await window.api.preview.status(projectPath).catch(() => null)
        const logs2 = await window.api.preview.logs(projectPath, { tail: 250 }).catch(() => null)
        if (st2) setPreviewStatus(st2)
        if (logs2) setPreviewLogs(logs2)

        if (st2?.state === 'error') {
          lastFailure = st2.error ?? 'Preview still failing to start.'
          continue
        }

        const logErr = findLikelyErrorLine(logs2 ?? [])
        if (logErr) {
          lastFailure = logErr
          continue
        }

        const runtimeAfter = previewRuntimeErrorRef.current
        if (runtimeAfter) {
          lastFailure = runtimeAfter.message || 'Runtime error after restart.'
          continue
        }

        lastFailure = null
        setAutoFixError(null)
        return
      }

      if (lastFailure) setAutoFixError(lastFailure)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setAutoFixError(msg)
      setError(msg)
    } finally {
      setAutoFixBusy(false)
      setAutoFixRequestId(null)
    }
  }

  const postToPreview = useCallback((payload: any) => {
    const win = previewIframeRef.current?.contentWindow
    if (!win) return
    win.postMessage(payload, '*')
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frameWin = previewIframeRef.current?.contentWindow
      if (frameWin && event.source !== frameWin) return

      const data = event.data as any
      if (!data || typeof data !== 'object') return
      if (data.kind !== 'studio:design') return

      if (data.type === 'ready' || data.type === 'pong') {
        setDesignBridgeReady(true)
        return
      }

      if (data.type === 'selected') {
        const sel = data.selection as DesignSelection | undefined
        if (sel) setDesignSelection(sel)
        return
      }

      if (data.type === 'runtime-error') {
        const message = typeof data.message === 'string' ? data.message : 'Runtime error'
        const stack = typeof data.stack === 'string' ? data.stack : undefined
        const route = typeof data.route === 'string' ? data.route : undefined
        const source = typeof data.source === 'string' ? data.source : undefined
        setPreviewRuntimeError({
          message: clampText(message, 4000),
          stack,
          route,
          source,
          at: new Date().toISOString()
        })
        return
      }

      if (data.type === 'console' && data.level === 'error') {
        const message = typeof data.message === 'string' ? data.message : 'Console error'

        setPreviewRuntimeError((prev) =>
          prev
            ? prev
            : {
                message: clampText(message, 4000),
                route: typeof data.route === 'string' ? data.route : undefined,
                source: 'console.error',
                at: new Date().toISOString()
              }
        )
        return
      }

      if (data.type === 'route') {
        const r = typeof data.route === 'string' ? data.route : '/'
        const raw = r.trim() || '/'
        const route = raw.startsWith('/') ? raw : `/${raw}`
        setPreviewRoute(route)
        return
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (!designSelection) return
    setDesignTextDraft(designSelection.text ?? '')
    setDesignClassDraft(designSelection.className ?? '')
    setDesignApplyError(null)
  }, [designSelection?.selector])

  useEffect(() => {
    if (!previewSrc) return
    postToPreview({ kind: 'studio:design', type: 'ping' })
    postToPreview({ kind: 'studio:design', type: 'enable', enabled: designInspectEnabled })
  }, [previewFrameNonce, previewSrc, designInspectEnabled, postToPreview])

  useEffect(() => {
    if (previewSrc) return
    if (designInspectEnabled) setDesignInspectEnabled(false)
    if (designSelection) setDesignSelection(null)
  }, [previewSrc, designInspectEnabled, designSelection])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key
      const isCmd = e.metaKey || e.ctrlKey

      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (target as any)?.isContentEditable

      if (isCmd && key.toLowerCase() === 'n') {
        e.preventDefault()
        setNewProjectOpen(true)
        return
      }

      if (isCmd && key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
        return
      }

      if (isCmd && key.toLowerCase() === 'i') {
        e.preventDefault()
        if (!activeProject) return
        if (!previewSrc) return
        const next = !designInspectEnabled
        setDesignInspectEnabled(next)
        if (!next) setDesignSelection(null)
        setPreviewPaneTab('preview')
        postToPreview({ kind: 'studio:design', type: 'ping' })
        postToPreview({ kind: 'studio:design', type: 'enable', enabled: next })
        return
      }

      if (key === 'F5') {
        e.preventDefault()
        if (!activeProject) return
        if (previewStarting) return
        if (previewStatus?.state === 'running') {
          void stopPreview()
        } else {
          void startPreview(false)
        }
        return
      }

      if (key === 'Escape') {
        if (!designInspectEnabled) return
        if (designSelection) {
          setDesignSelection(null)
          return
        }
        setDesignInspectEnabled(false)
        postToPreview({ kind: 'studio:design', type: 'enable', enabled: false })
        return
      }

      if (isTyping) return
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    activeProject,
    previewSrc,
    previewStarting,
    previewStatus?.state,
    designInspectEnabled,
    designSelection,
    postToPreview
  ])

  const applyDesignChanges = async () => {
    if (!activeProject) return
    if (!designSelection) return

    const req: DesignApplyRequest = {
      projectPath: activeProject.path,
      route: (previewRoute || '/').split(/[?#]/)[0] || '/',
      selector: designSelection.selector,
      originalText: designSelection.text,
      newText: designTextDraft,
      originalClassName: designSelection.className,
      newClassName: designClassDraft
    }

    setDesignApplying(true)
    setDesignApplyError(null)
    try {
      const res: DesignApplyResult = await window.api.design.apply(req)
      if (!res?.ok) throw new Error(res?.message || 'Failed to apply design changes')

      postToPreview({
        kind: 'studio:design',
        type: 'apply',
        selector: designSelection.selector,
        newText: designTextDraft,
        newClassName: designClassDraft
      })

      const raw = (previewRoute || '/').trim() || '/'
      const route = raw.startsWith('/') ? raw : `/${raw}`
      setPreviewFrameRoute(route)
      setPreviewFrameNonce((n) => n + 1)
    } catch (err) {
      setDesignApplyError(err instanceof Error ? err.message : String(err))
    } finally {
      setDesignApplying(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Titlebar */}
      <div className="flex h-8 items-center gap-3 border-b border-border bg-[var(--titlebar-bg)] px-3">
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold tracking-wide text-foreground">{APP_TITLE}</div>
          <div className="h-4 w-px bg-border" />
        </div>

        <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {activeProject ? (
            <span>
              <span className="text-foreground">{activeProject.name}</span>
              <span className="ml-2 opacity-70">{activeProject.path}</span>
            </span>
          ) : (
            'No project open'
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-2 border border-border bg-secondary px-2 py-0.5">
            <span
              className="h-2 w-2"
              style={{
                background:
                  previewStatus?.state === 'running'
                    ? 'var(--success)'
                    : previewStatus?.state === 'starting'
                      ? 'var(--warning)'
                      : previewStatus?.state === 'error'
                        ? 'var(--error)'
                        : 'var(--muted-foreground)'
              }}
            />
            {previewStatus?.state ?? 'stopped'}
            {previewStatus?.port ? <span className="opacity-70">:{previewStatus.port}</span> : null}
          </span>
          {busy ? <span className="opacity-70">Loading…</span> : null}
        </div>
      </div>

      {/* Command bar */}
      <div className="flex h-9 items-center gap-2 border-b border-border bg-[var(--toolbar-bg)] px-2">
        <ToolButton onClick={() => setNewProjectOpen(true)} title="New Project (Ctrl/Cmd+N)">
          ＋ New
        </ToolButton>

        <ToolButton
          onClick={() => {
            if (!activeProject) return
            if (previewStarting) return
            if (previewStatus?.state === 'running') {
              void stopPreview()
            } else {
              void startPreview(false)
            }
          }}
          disabled={!activeProject || previewStarting}
          title={previewStatus?.state === 'running' ? 'Stop preview (F5)' : 'Run preview (F5)'}
        >
          {previewStatus?.state === 'running' ? '■ Stop' : '▶ Run'}
        </ToolButton>

        <ToolButton
          onClick={() => {
            if (!activeProject) return
            if (previewStarting) return
            void startPreview(true)
          }}
          disabled={!activeProject || previewStarting}
          title="Restart preview"
        >
          ↻ Restart
        </ToolButton>

        {previewIssue ? (
          <ToolButton
            onClick={() => {
              if (!activeProject) return
              void fixPreviewWithAi()
            }}
            disabled={!activeProject || autoFixBusy}
            title="Ask AI to fix preview errors"
          >
            {autoFixBusy ? 'Fixing…' : '✨ Fix'}
          </ToolButton>
        ) : null}

        <div className="h-4 w-px bg-border" />

        <ToolButton
          onClick={() => {
            if (!activeProject) return
            if (!previewSrc) return
            const next = !designInspectEnabled
            setDesignInspectEnabled(next)
            if (!next) setDesignSelection(null)
            setPreviewPaneTab('preview')
            postToPreview({ kind: 'studio:design', type: 'ping' })
            postToPreview({ kind: 'studio:design', type: 'enable', enabled: next })
          }}
          disabled={!activeProject || !previewSrc}
          active={designInspectEnabled}
          title="Toggle Inspect (Ctrl/Cmd+I)"
        >
          ⌖ Inspect
        </ToolButton>

        {!designBridgeReady && activeProject && previewSrc ? (
          <span className="text-xs text-muted-foreground">(bridge not ready yet)</span>
        ) : null}

        <div className="flex-1" />

        {error ? (
          <div className="max-w-[45%] whitespace-pre-line truncate text-xs text-destructive">
            {error}
          </div>
        ) : null}

        <ToolButton onClick={() => setSettingsOpen(true)} title="Settings (Ctrl/Cmd+,)">
          ⚙ Settings
        </ToolButton>

        {activeProject ? (
          <ToolButton onClick={closeProject} title="Close project">
            ✕ Close
          </ToolButton>
        ) : null}
      </div>

      {/* Main panes */}
      <ResizablePanels
        defaultLeftWidth={280}
        defaultChatWidth={420}
        minWidth={220}
        left={
          <div className="flex h-full flex-col border-r border-border bg-[var(--pane-bg)]">
            <div className="flex">
              <TabButton
                active={leftPaneTab === 'projects'}
                onClick={() => setLeftPaneTab('projects')}
                className="flex-1"
              >
                Projects
              </TabButton>
              <TabButton
                active={leftPaneTab === 'files'}
                onClick={() => setLeftPaneTab('files')}
                disabled={!activeProject}
                className="flex-1"
              >
                Files
              </TabButton>
            </div>

            {leftPaneTab === 'projects' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-border bg-[var(--toolbar-bg)] p-2">
                  <input
                    className="w-full border border-border bg-secondary px-2 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    placeholder="Search projects…"
                  />
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-2">
                  {busy ? (
                    <div className="text-xs text-muted-foreground">Loading…</div>
                  ) : filteredProjects.length === 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">No projects found.</div>
                      <ToolButton onClick={() => setNewProjectOpen(true)}>
                        ＋ Create a project
                      </ToolButton>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {filteredProjects.map((p) => {
                        const isActive = activeProject?.id === p.id
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => void openProject(p)}
                            className={
                              'w-full border border-border px-3 py-2 text-left text-xs transition-colors ' +
                              (isActive
                                ? 'bg-[var(--selected-bg)] text-white'
                                : 'bg-transparent text-foreground hover:bg-[var(--hover-bg)]')
                            }
                            title={p.path}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 truncate font-semibold">
                                <span className="mr-2">📦</span>
                                {p.name}
                              </div>
                              {isActive ? (
                                <span className="text-[11px] opacity-90">Open</span>
                              ) : null}
                            </div>
                            <div className="mt-1 truncate text-[11px] opacity-70">
                              {p.templateId}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {!activeProject ? (
                  <div className="text-xs text-muted-foreground">
                    Open a project to browse files.
                  </div>
                ) : tree ? (
                  <TreeView
                    root={tree}
                    onOpenFile={(path) => {
                      const route = guessRouteFromFilePath(path)
                      if (!route) return
                      setPreviewRoute(route)
                      setPreviewFrameRoute(route)
                      setPreviewFrameNonce((n) => n + 1)
                      setPreviewPaneTab('preview')
                      void startPreview(false)
                    }}
                  />
                ) : (
                  <div className="text-xs text-muted-foreground">Loading tree…</div>
                )}
              </div>
            )}
          </div>
        }
        chat={
          <div className="flex h-full flex-col border-r border-border bg-[var(--pane-bg)]">
            <div className="flex">
              <TabButton
                active={chatPaneTab === 'chat'}
                onClick={() => setChatPaneTab('chat')}
                className="flex-1"
              >
                Chat
              </TabButton>
              <TabButton
                active={chatPaneTab === 'logs'}
                onClick={() => setChatPaneTab('logs')}
                className="flex-1"
              >
                Logs
              </TabButton>
            </div>

            {chatPaneTab === 'chat' ? (
              <>
                <div className="min-h-0 flex-1 overflow-auto p-3">
                  {!activeProject ? (
                    <div className="space-y-2">
                      <div className="text-sm font-semibold">Welcome to Studio</div>
                      <div className="text-xs text-muted-foreground">
                        Create or open a project to start chatting with the AI and previewing your
                        app.
                      </div>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">No messages yet.</div>
                      <div className="text-xs text-muted-foreground">
                        Try: “Build a landing page with a hero and pricing section.”
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {messages.map((m) => (
                        <div
                          key={m.id}
                          className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                        >
                          <div
                            className={
                              'max-w-[85%] whitespace-pre-wrap border border-border px-3 py-2 text-xs leading-relaxed ' +
                              (m.role === 'user'
                                ? 'bg-[var(--selected-bg)] text-white'
                                : 'bg-popover text-foreground')
                            }
                          >
                            {m.content}
                          </div>
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                    </div>
                  )}
                </div>

                <div className="border-t border-border bg-[var(--toolbar-bg)] p-3">
                  <textarea
                    className="h-24 w-full resize-none border border-border bg-secondary p-2 text-xs text-foreground outline-none placeholder:text-muted-foreground"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onChatKeyDown}
                    placeholder={
                      activeProject
                        ? 'Describe what you want to build…'
                        : 'Open a project to start chatting…'
                    }
                    disabled={!activeProject || aiBusy || autoFixBusy}
                  />

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="text-[11px] text-muted-foreground">
                      Enter to send · Shift+Enter for newline
                    </div>

                    <div className="flex gap-2">
                      {aiBusy || autoFixBusy ? (
                        <ToolButton onClick={() => void cancelAi()} title="Cancel current AI task">
                          ■ Stop
                        </ToolButton>
                      ) : null}
                      <ToolButton
                        onClick={() => void sendMessage()}
                        disabled={!activeProject || aiBusy || autoFixBusy || !draft.trim()}
                        title="Send"
                        className="bg-primary text-primary-foreground hover:bg-[#106ebe]"
                      >
                        ➤ Send
                      </ToolButton>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto p-3">
                {!activeProject ? (
                  <div className="text-xs text-muted-foreground">
                    Open a project to view preview logs.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {previewRuntimeError ? (
                      <div className="border border-[color:var(--error)] bg-[color:rgba(241,76,76,0.10)] p-3 text-xs">
                        <div className="font-semibold">Runtime error</div>
                        <div className="mt-1 whitespace-pre-wrap opacity-90">
                          {previewRuntimeError.message}
                        </div>
                        {previewRuntimeError.stack ? (
                          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap border border-border bg-background p-2 text-[11px]">
                            {previewRuntimeError.stack}
                          </pre>
                        ) : null}
                      </div>
                    ) : null}

                    <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap border border-border bg-background p-3 text-[11px] text-foreground">
                      {(previewLogs ?? []).join('\n') || 'No logs yet.'}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        }
        preview={
          <div className="flex h-full flex-col bg-[var(--pane-bg)]">
            <div className="flex border-b border-border bg-[var(--toolbar-bg)]">
              <TabButton
                active={previewPaneTab === 'preview'}
                onClick={() => setPreviewPaneTab('preview')}
                className="flex-1"
              >
                Preview
              </TabButton>
              <TabButton
                active={previewPaneTab === 'pages'}
                onClick={() => setPreviewPaneTab('pages')}
                className="flex-1"
                disabled={!activeProject}
              >
                Pages
              </TabButton>
            </div>

            {previewPaneTab === 'pages' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between border-b border-border bg-[var(--toolbar-bg)] px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Routes
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {previewRoutesLoading ? 'Scanning…' : `${previewRoutes.length} found`}
                    </span>
                    <ToolButton
                      onClick={() => activeProject && void refreshPreviewRoutes(activeProject.path)}
                      disabled={!activeProject || previewRoutesLoading}
                      title="Rescan"
                    >
                      ↻
                    </ToolButton>
                  </div>
                </div>

                <div className="border-b border-border p-2">
                  <input
                    className="w-full border border-border bg-secondary px-2 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
                    value={previewRoutesQuery}
                    onChange={(e) => setPreviewRoutesQuery(e.target.value)}
                    placeholder="Filter routes…"
                    disabled={!activeProject}
                  />
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-2">
                  {!activeProject ? (
                    <div className="text-xs text-muted-foreground">
                      Open a project to scan routes.
                    </div>
                  ) : previewRoutesLoading ? (
                    <div className="text-xs text-muted-foreground">Scanning…</div>
                  ) : (
                    <div className="space-y-1">
                      {filteredPreviewRoutes.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => {
                            const route = normalizeRoute(r)
                            setPreviewRoute(route)
                            setPreviewFrameRoute(route)
                            setPreviewFrameNonce((n) => n + 1)
                            setPreviewPaneTab('preview')
                          }}
                          className="w-full border border-border bg-transparent px-3 py-2 text-left text-xs text-foreground hover:bg-[var(--hover-bg)]"
                        >
                          {r}
                        </button>
                      ))}
                      {filteredPreviewRoutes.length === 0 ? (
                        <div className="text-xs text-muted-foreground">No matching routes.</div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                {/* Navigation */}
                <div className="flex items-center gap-1 border-b border-border bg-[var(--toolbar-bg)] px-2 py-2">
                  <ToolButton
                    onClick={() =>
                      postToPreview({ kind: 'studio:design', type: 'nav', action: 'back' })
                    }
                    disabled={!previewSrc}
                    title="Back"
                  >
                    ←
                  </ToolButton>
                  <ToolButton
                    onClick={() =>
                      postToPreview({ kind: 'studio:design', type: 'nav', action: 'forward' })
                    }
                    disabled={!previewSrc}
                    title="Forward"
                  >
                    →
                  </ToolButton>
                  <ToolButton
                    onClick={() => {
                      const route = '/'
                      setPreviewRoute(route)
                      setPreviewFrameRoute(route)
                      setPreviewFrameNonce((n) => n + 1)
                    }}
                    disabled={!activeProject}
                    title="Home"
                  >
                    ⌂
                  </ToolButton>
                  <ToolButton
                    onClick={() => {
                      if (!activeProject) return
                      const route = normalizeRoute(previewRoute)
                      setPreviewRoute(route)
                      setPreviewFrameRoute(route)
                      setPreviewFrameNonce((n) => n + 1)
                    }}
                    disabled={!activeProject}
                    title="Reload"
                  >
                    ↻
                  </ToolButton>

                  <div className="mx-1 h-4 w-px bg-border" />

                  <div className="flex min-w-0 flex-1 items-center gap-1 border border-border bg-secondary px-2 py-1 text-xs">
                    <span className="shrink-0 text-muted-foreground">
                      {previewStatus?.url ?? 'http://localhost'}
                    </span>
                    <input
                      className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                      value={previewRoute}
                      onChange={(e) => setPreviewRoute(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        const route = normalizeRoute(previewRoute)
                        setPreviewRoute(route)
                        setPreviewFrameRoute(route)
                        setPreviewFrameNonce((n) => n + 1)
                      }}
                      placeholder="/"
                      disabled={!activeProject}
                    />
                  </div>

                  <ToolButton
                    onClick={() => {
                      if (!previewSrc) return
                      window.open(previewSrc, '_blank')
                    }}
                    disabled={!previewSrc}
                    title="Open in browser"
                  >
                    ↗
                  </ToolButton>

                  <div className="ml-1 text-[11px] text-muted-foreground">
                    {previewStatus?.state === 'starting'
                      ? 'Starting…'
                      : previewStatus?.state === 'running'
                        ? 'Live'
                        : ''}
                  </div>
                </div>

                {previewIssue ? (
                  <div className="border-b border-border bg-[color:rgba(241,76,76,0.10)] p-3 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold">{previewIssue.title}</div>
                        {previewIssue.details ? (
                          <div className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">
                            {previewIssue.details}
                          </div>
                        ) : null}
                      </div>
                      <ToolButton
                        onClick={() => activeProject && void fixPreviewWithAi()}
                        disabled={!activeProject || autoFixBusy}
                        className="bg-primary text-primary-foreground hover:bg-[#106ebe]"
                      >
                        {autoFixBusy ? 'Fixing…' : 'Fix with AI'}
                      </ToolButton>
                    </div>
                  </div>
                ) : null}

                {autoFixError ? (
                  <div className="border-b border-border bg-[color:rgba(241,76,76,0.10)] p-3 text-xs">
                    <div className="font-semibold">Auto-fix failed</div>
                    <div className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">
                      {autoFixError}
                    </div>
                  </div>
                ) : null}

                <div className="flex min-h-0 flex-1 overflow-hidden">
                  <div className="min-w-0 flex-1 bg-background">
                    {!activeProject ? (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        Open a project to start preview.
                      </div>
                    ) : previewStatus?.state === 'error' ? (
                      <div className="flex h-full items-center justify-center p-6">
                        <div className="max-w-xl border border-border bg-popover p-4 text-xs">
                          <div className="font-semibold">Preview error</div>
                          <div className="mt-2 whitespace-pre-wrap text-muted-foreground">
                            {previewStatus.error ?? 'Unknown error'}
                          </div>
                        </div>
                      </div>
                    ) : previewSrc ? (
                      <iframe
                        key={previewFrameNonce}
                        ref={previewIframeRef}
                        title="preview"
                        className="h-full w-full bg-white"
                        src={previewSrc}
                        onLoad={() => {
                          setPreviewLastLoadedAt(Date.now())
                          setDesignBridgeReady(false)
                          setPreviewRuntimeError(null)
                          previewRuntimeErrorRef.current = null
                          setAutoFixError(null)
                          postToPreview({ kind: 'studio:design', type: 'ping' })
                          postToPreview({
                            kind: 'studio:design',
                            type: 'enable',
                            enabled: designInspectEnabled
                          })
                        }}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        {previewStarting ? 'Starting preview…' : 'Preview is not running.'}
                      </div>
                    )}
                  </div>

                  {designInspectEnabled ? (
                    <div className="w-80 shrink-0 border-l border-border bg-[var(--pane-bg)]">
                      <div className="border-b border-border bg-[var(--toolbar-bg)] px-3 py-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Inspector
                        </div>
                      </div>
                      <div className="h-full overflow-auto p-3">
                        {!previewSrc ? (
                          <div className="text-xs text-muted-foreground">
                            Run preview to inspect elements.
                          </div>
                        ) : !designBridgeReady ? (
                          <div className="text-xs text-muted-foreground">
                            Waiting for the inspector bridge…
                          </div>
                        ) : !designSelection ? (
                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">
                              Click an element in the preview to edit text and className.
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              Tip: press Esc to clear selection.
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <div className="text-[11px] text-muted-foreground">Tag</div>
                              <div className="border border-border bg-secondary px-2 py-1 text-xs">
                                {designSelection.tag}
                              </div>
                            </div>

                            <div className="space-y-1">
                              <div className="text-[11px] text-muted-foreground">Selector</div>
                              <div className="border border-border bg-secondary px-2 py-1 text-[11px]">
                                {designSelection.selector}
                              </div>
                            </div>

                            <div className="space-y-1">
                              <div className="text-[11px] text-muted-foreground">Text</div>
                              <textarea
                                className="h-24 w-full resize-none border border-border bg-secondary p-2 text-xs text-foreground outline-none"
                                value={designTextDraft}
                                onChange={(e) => setDesignTextDraft(e.target.value)}
                              />
                            </div>

                            <div className="space-y-1">
                              <div className="text-[11px] text-muted-foreground">className</div>
                              <textarea
                                className="h-24 w-full resize-none border border-border bg-secondary p-2 text-xs text-foreground outline-none"
                                value={designClassDraft}
                                onChange={(e) => setDesignClassDraft(e.target.value)}
                              />
                            </div>

                            {designApplyError ? (
                              <div className="border border-[color:var(--error)] bg-[color:rgba(241,76,76,0.10)] p-2 text-xs text-foreground">
                                {designApplyError}
                              </div>
                            ) : null}

                            <div className="flex flex-wrap gap-2">
                              <ToolButton
                                onClick={() => void applyDesignChanges()}
                                disabled={designApplying || !designBridgeReady}
                                className="bg-primary text-primary-foreground hover:bg-[#106ebe]"
                              >
                                {designApplying ? 'Applying…' : 'Apply'}
                              </ToolButton>
                              <ToolButton
                                onClick={() => setDesignSelection(null)}
                                disabled={!designSelection}
                              >
                                Clear
                              </ToolButton>
                            </div>

                            <div className="text-[11px] text-muted-foreground">
                              Changes are written to source files and reflected via Next.js HMR.
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        }
      />

      {settings && (
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          initial={settings}
          onSaved={(s) => setSettings(s)}
        />
      )}

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        templates={templates}
        onCreate={createProject}
        settingsOpen={() => setSettingsOpen(true)}
      />
    </div>
  )
}
