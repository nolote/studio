import React, { memo, useCallback, useEffect, useRef, useState } from 'react'

interface ResizablePanelsProps {
  left: React.ReactNode
  chat: React.ReactNode
  preview: React.ReactNode
  defaultLeftWidth?: number
  defaultChatWidth?: number
  minWidth?: number
}

const Splitter = memo(function Splitter({
  onMouseDown,
  isDragging
}: {
  onMouseDown: () => void
  isDragging: boolean
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={
        'w-1 shrink-0 cursor-col-resize transition-colors will-change-[background-color] ' +
        (isDragging ? 'bg-primary' : 'bg-[var(--toolbar-bg)] hover:bg-[#454545]')
      }
    />
  )
})

function ResizablePanelsInner({
  left,
  chat,
  preview,
  defaultLeftWidth = 260,
  defaultChatWidth = 380,
  minWidth = 200
}: ResizablePanelsProps) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth)
  const [chatWidth, setChatWidth] = useState(defaultChatWidth)
  const [dragging, setDragging] = useState<'left' | 'chat' | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging || !containerRef.current) return

      if (rafRef.current) cancelAnimationFrame(rafRef.current)

      rafRef.current = requestAnimationFrame(() => {
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return

        const totalWidth = rect.width

        if (dragging === 'left') {
          const newWidth = Math.max(minWidth, Math.min(e.clientX - rect.left, totalWidth * 0.35))
          setLeftWidth(newWidth)
        } else if (dragging === 'chat') {
          const chatStart = rect.left + leftWidth + 4
          const newWidth = Math.max(minWidth, Math.min(e.clientX - chatStart, totalWidth * 0.5))
          setChatWidth(newWidth)
        }
      })
    },
    [dragging, leftWidth, minWidth]
  )

  const handleMouseUp = useCallback(() => {
    setDragging(null)
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const startDragLeft = useCallback(() => setDragging('left'), [])
  const startDragChat = useCallback(() => setDragging('chat'), [])

  useEffect(() => {
    if (!dragging) return

    document.addEventListener('mousemove', handleMouseMove, { passive: true })
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, handleMouseMove, handleMouseUp])

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden contain-layout">
      <div style={{ width: leftWidth }} className="shrink-0 contain-strict">
        {left}
      </div>

      <Splitter onMouseDown={startDragLeft} isDragging={dragging === 'left'} />

      <div style={{ width: chatWidth }} className="shrink-0 contain-strict">
        {chat}
      </div>

      <Splitter onMouseDown={startDragChat} isDragging={dragging === 'chat'} />

      <div className="min-w-0 flex-1 contain-strict">{preview}</div>
    </div>
  )
}

export const ResizablePanels = memo(ResizablePanelsInner)
