import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Ensures the preview project includes the studio design bridge so that the Studio can:
 * - show a browser-like live preview (route tracking + back/forward)
 * - optionally enable Inspect mode (hover highlight + click selection)
 * - detect runtime errors / console errors inside the preview, so the Studio can offer "Fix with AI"
 *
 * This is applied at runtime (when starting preview/design) so older projects work too.
 */

const BRIDGE_VERSION_MARKER = 'studioDesignBridge v5'

// IMPORTANT: Use String.raw so backslashes are preserved exactly as written in the bridge TSX (prevents broken regex literals).
const BRIDGE_FILE_NAME = 'studio-design-bridge.tsx'

const BRIDGE_SOURCE = String.raw`/* studioDesignBridge v5 */
/**
 * Runs inside the previewed Next.js app (in an iframe).
 *
 * Responsibilities:
 * - Tell the parent (Studio) when the bridge is ready
 * - Report the current route so the Studio can show a browser-like address bar
 * - (Optional) Inspect mode: hover outline + click-to-select element metadata
 * - Apply quick DOM edits for a smoother UX while source files are being rewritten
 * - Report runtime errors / console errors so the Studio can offer an AI auto-fix
 */

'use client'

import { useEffect, useRef, useState } from 'react'

type DesignSelection = {
  selector: string
  tag: string
  text?: string
  className?: string
}

type ParentMessage =
  | { kind: 'studio:design'; type: 'ping' }
  | { kind: 'studio:design'; type: 'enable'; enabled: boolean }
  | { kind: 'studio:design'; type: 'apply'; selector: string; newText?: string; newClassName?: string }
  | { kind: 'studio:design'; type: 'navigate'; route: string }
  | { kind: 'studio:design'; type: 'nav'; action: 'back' | 'forward' | 'reload' }

function cssEscape(value: string): string {
  // Prefer the platform escape (widely supported in modern browsers).
  const css = (globalThis as any).CSS
  if (css && typeof css.escape === 'function') return css.escape(value)
  // Fallback: escape quotes + backslashes (enough for our data-vb-id usage).
  return value.replace(/["\\]/g, '\\$&')
}

function ensureVbId(el: HTMLElement): string {
  if (!el.dataset.vbId) {
    el.dataset.vbId = 'vb_' + Math.random().toString(16).slice(2) + Date.now().toString(16)
  }
  return el.dataset.vbId
}

function selectionFromElement(el: HTMLElement): DesignSelection {
  const id = ensureVbId(el)
  const selector = '[data-vb-id="' + cssEscape(id) + '"]'
  const text = (el.innerText || el.textContent || '').trim()
  const className = (el.getAttribute('class') || '').trim()
  return {
    selector,
    tag: el.tagName.toLowerCase(),
    text: text.length > 400 ? text.slice(0, 399) + '…' : text,
    className,
  }
}

function postToParent(msg: any) {
  try {
    window.parent?.postMessage(msg, '*')
  } catch {
    // ignore
  }
}

function currentRoute(): string {
  return window.location.pathname + window.location.search + window.location.hash
}

function safeStringify(v: any): string {
  try {
    if (typeof v === 'string') return v
    if (v instanceof Error) return v.message
    return JSON.stringify(v)
  } catch {
    try {
      return String(v)
    } catch {
      return '[unprintable]'
    }
  }
}

export default function studioDesignBridge() {
  const [enabled, setEnabled] = useState(false)

  const hoverBoxRef = useRef<HTMLDivElement | null>(null)
  const selectBoxRef = useRef<HTMLDivElement | null>(null)

  function updateBox(box: HTMLDivElement, el: HTMLElement) {
    const r = el.getBoundingClientRect()
    box.style.display = 'block'
    box.style.left = r.left + 'px'
    box.style.top = r.top + 'px'
    box.style.width = r.width + 'px'
    box.style.height = r.height + 'px'
  }

  function notifyRoute() {
    postToParent({ kind: 'studio:design', type: 'route', route: currentRoute() })
  }

  // Boot + keep the parent informed of route changes.
  useEffect(() => {
    postToParent({ kind: 'studio:design', type: 'ready' })
    notifyRoute()

    // -------- runtime error reporting (for "Fix with AI") --------
    let lastRuntimeSentAt = 0
    const sendRuntimeError = (payload: { message: string; stack?: string; source?: string }) => {
      const now = Date.now()
      if (now - lastRuntimeSentAt < 250) return
      lastRuntimeSentAt = now

      const message = (payload.message || '').toString().slice(0, 4000)
      const stack = payload.stack ? payload.stack.toString().slice(0, 12000) : undefined
      const source = payload.source

      postToParent({
        kind: 'studio:design',
        type: 'runtime-error',
        message,
        stack,
        source,
        route: currentRoute(),
      })
    }

    const onError = (e: any) => {
      const message = (e?.message || 'Uncaught error').toString()
      const stack = e?.error?.stack ? String(e.error.stack) : undefined
      sendRuntimeError({ message, stack, source: 'error' })
    }

    const onRejection = (e: any) => {
      const reason = e?.reason
      if (reason instanceof Error) {
        sendRuntimeError({
          message: reason.message || 'Unhandled rejection',
          stack: reason.stack,
          source: 'unhandledrejection',
        })
      } else {
        sendRuntimeError({ message: 'Unhandled rejection: ' + safeStringify(reason), source: 'unhandledrejection' })
      }
    }

    window.addEventListener('error', onError, true)
    window.addEventListener('unhandledrejection', onRejection, true)

    // Also forward console.error (throttled) — useful for Next dev overlay + stack traces.
    const origConsoleError = console.error
    let lastConsoleSentAt = 0
    console.error = (...args: any[]) => {
      origConsoleError(...args)
      const now = Date.now()
      if (now - lastConsoleSentAt < 250) return
      lastConsoleSentAt = now
      try {
        postToParent({
          kind: 'studio:design',
          type: 'console',
          level: 'error',
          message: args.map(safeStringify).join(' ').slice(0, 8000),
          route: currentRoute(),
        })
      } catch {
        // ignore
      }
    }

    // Monkey-patch history so SPA navigations still report routes.
    const origPush = history.pushState
    const origReplace = history.replaceState

    function wrap(fn: typeof history.pushState) {
      return function (this: any, ...args: any[]) {
        const res = fn.apply(this, args as any)
        // defer to let router finish updating location
        setTimeout(notifyRoute, 0)
        return res
      } as any
    }

    try {
      history.pushState = wrap(origPush)
      history.replaceState = wrap(origReplace)
    } catch {
      // ignore if read-only
    }

    window.addEventListener('popstate', notifyRoute)
    window.addEventListener('hashchange', notifyRoute)

    return () => {
      try {
        history.pushState = origPush
        history.replaceState = origReplace
      } catch {
        // ignore
      }
      window.removeEventListener('popstate', notifyRoute)
      window.removeEventListener('hashchange', notifyRoute)

      window.removeEventListener('error', onError, true)
      window.removeEventListener('unhandledrejection', onRejection, true)

      console.error = origConsoleError
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Message handling from Studio.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as ParentMessage | any
      if (!data || typeof data !== 'object') return
      if (data.kind !== 'studio:design') return

      if (data.type === 'ping') {
        postToParent({ kind: 'studio:design', type: 'pong' })
        notifyRoute()
        return
      }

      if (data.type === 'enable') {
        setEnabled(!!data.enabled)
        return
      }

      if (data.type === 'apply') {
        const selector = typeof data.selector === 'string' ? data.selector : null
        if (!selector) return
        const el = document.querySelector(selector) as HTMLElement | null
        if (!el) return

        if (typeof data.newText === 'string') {
          el.innerText = data.newText
        }
        if (typeof data.newClassName === 'string') {
          el.setAttribute('class', data.newClassName)
        }
        return
      }

      if (data.type === 'navigate') {
        const route = typeof data.route === 'string' ? data.route : '/'
        try {
          // Allow either a path (/about) or a full URL.
          if (route.startsWith('http://') || route.startsWith('https://') || route.startsWith('//')) {
            window.location.assign(route)
          } else {
            const raw = route.trim() || '/'
            const next = raw.startsWith('/') ? raw : '/' + raw
            window.location.assign(next)
          }
        } catch {
          // ignore
        }
        return
      }

      if (data.type === 'nav') {
        const action = data.action
        try {
          if (action === 'back') history.back()
          if (action === 'forward') history.forward()
          if (action === 'reload') window.location.reload()
        } catch {
          // ignore
        }
        return
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Create overlays once.
  useEffect(() => {
    if (!hoverBoxRef.current) {
      const d = document.createElement('div')
      d.style.position = 'fixed'
      d.style.zIndex = '2147483647'
      d.style.pointerEvents = 'none'
      d.style.border = '2px solid rgba(59,130,246,0.9)'
      d.style.background = 'rgba(59,130,246,0.08)'
      d.style.display = 'none'
      document.body.appendChild(d)
      hoverBoxRef.current = d
    }
    if (!selectBoxRef.current) {
      const d = document.createElement('div')
      d.style.position = 'fixed'
      d.style.zIndex = '2147483647'
      d.style.pointerEvents = 'none'
      d.style.border = '2px solid rgba(34,197,94,0.95)'
      d.style.background = 'rgba(34,197,94,0.06)'
      d.style.display = 'none'
      document.body.appendChild(d)
      selectBoxRef.current = d
    }
  }, [])

  // Inspect mode listeners.
  useEffect(() => {
    if (!enabled) {
      if (hoverBoxRef.current) hoverBoxRef.current.style.display = 'none'
      return
    }

    function onMove(e: MouseEvent) {
      if (!enabled) return
      const target = e.target as HTMLElement | null
      if (!target) return

      if (target === hoverBoxRef.current || target === selectBoxRef.current) return
      if (target.closest('[data-vb-ignore]')) return

      const box = hoverBoxRef.current
      if (!box) return
      updateBox(box, target)
    }

    function onClick(e: MouseEvent) {
      if (!enabled) return

      // While inspect is enabled, prevent navigation and let the user select.
      e.preventDefault()
      e.stopPropagation()

      const target = e.target as HTMLElement | null
      if (!target) return
      if (target === hoverBoxRef.current || target === selectBoxRef.current) return
      if (target.closest('[data-vb-ignore]')) return

      const selection = selectionFromElement(target)

      // lock selection outline
      if (selectBoxRef.current) updateBox(selectBoxRef.current, target)

      postToParent({ kind: 'studio:design', type: 'selected', selection })
    }

    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('click', onClick, true)

    return () => {
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('click', onClick, true)
    }
  }, [enabled])

  return null
}
`

async function fileExists(p: string) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function candidateLayoutFiles(projectPath: string): string[] {
  const root = path.resolve(projectPath)
  return [
    path.join(root, 'src/app/layout.tsx'),
    path.join(root, 'app/layout.tsx'),
    path.join(root, 'src/app/layout.jsx'),
    path.join(root, 'app/layout.jsx')
  ]
}

function isSrcLayout(layoutAbs: string): boolean {
  const norm = layoutAbs.replace(/\\/g, '/')
  return norm.includes('/src/')
}

function computeBridgeAbs(projectPath: string, layoutAbs: string): string {
  const root = path.resolve(projectPath)
  const componentsDir = isSrcLayout(layoutAbs) ? 'src/components' : 'components'
  return path.join(root, componentsDir, BRIDGE_FILE_NAME)
}

function importSpecifier(fromFileAbs: string, toFileAbs: string): string {
  const rel = path.relative(path.dirname(fromFileAbs), toFileAbs).replace(/\\/g, '/')
  const noExt = rel.replace(/\.(tsx|ts|jsx|js)$/i, '')
  return noExt.startsWith('.') ? noExt : './' + noExt
}

function ensureImport(src: string, spec: string): string {
  if (src.includes('studioDesignBridge')) return src

  const importLine = `import studioDesignBridge from "${spec}";\n`

  const m = src.match(/^(?:import[^\n]*\n)+/m)
  if (m && m.index === 0) {
    return src.replace(m[0], m[0] + importLine)
  }
  return importLine + src
}

function ensureRender(src: string): string {
  if (src.includes('<studioDesignBridge')) return src

  if (/<\/body>/i.test(src)) {
    return src.replace(/<\/body>/i, `  <studioDesignBridge />\n</body>`)
  }
  if (/<\/html>/i.test(src)) {
    return src.replace(/<\/html>/i, `  <studioDesignBridge />\n</html>`)
  }
  return src + `\n<studioDesignBridge />\n`
}

export async function ensureDesignBridge(projectPath: string): Promise<void> {
  const layouts = candidateLayoutFiles(projectPath)
  let layoutAbs: string | null = null

  for (const candidate of layouts) {
    if (await fileExists(candidate)) {
      layoutAbs = candidate
      break
    }
  }

  if (!layoutAbs) {
    return
  }

  const bridgeAbs = computeBridgeAbs(projectPath, layoutAbs)
  const bridgeDir = path.dirname(bridgeAbs)
  await fs.mkdir(bridgeDir, { recursive: true })

  const existing = await fs.readFile(bridgeAbs, 'utf-8').catch(() => null)
  if (existing !== BRIDGE_SOURCE) {
    await fs.writeFile(bridgeAbs, BRIDGE_SOURCE, 'utf-8')
  }

  const src = await fs.readFile(layoutAbs, 'utf-8').catch(() => null)
  if (src == null) return

  const spec = importSpecifier(layoutAbs, bridgeAbs)
  let next = src
  next = ensureImport(next, spec)
  next = ensureRender(next)

  if (next !== src) {
    await fs.writeFile(layoutAbs, next, 'utf-8')
  }
}
