import { useEffect, useRef, useState } from 'react'
import type { AppState, Attachment, Device, Task, TaskInput, TaskStatus } from '../../shared/types'
import { Composer, DraftTray, Sidebar, TaskList, Toasts, IconX, IconSend } from './components'
import type { FilterKey, ToastItem } from './components'
import { displayName, errorText, initials } from './utils'

const EMPTY_INPUT: TaskInput = { mode: 'simple', title: '', description: '', attachments: [] }

function isValid(input: TaskInput): boolean {
  if (input.mode === 'simple') return input.description.trim().length > 0
  return input.title.trim().length > 0 && input.description.trim().length > 0
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [input, setInput] = useState<TaskInput>(EMPTY_INPUT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [busy, setBusy] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dragOverDevice, setDragOverDevice] = useState<string | null>(null)
  const [pickerTask, setPickerTask] = useState<Task | null>(null)
  const toastId = useRef(0)

  useEffect(() => {
    let alive = true
    void window.api.getState().then((next) => {
      if (alive) setState(next)
    })
    const unsubscribe = window.api.onState((next) => setState(next))
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!pickerTask) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerTask(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pickerTask])

  const toast = (text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = ++toastId.current
    setToasts((current) => [...current, { id, kind, text }])
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
    }, 3200)
  }

  if (!state) {
    return <div className="boot">正在启动局域网发现…</div>
  }

  const tasks = state.tasks
  const drafts = tasks.filter((task) => task.status === 'draft')
  const boardTasks = tasks.filter((task) => task.status !== 'draft')
  const onlineDevices = state.devices.filter((device) => device.online)

  const unreadByDevice: Record<string, number> = {}
  for (const task of boardTasks) {
    if (task.unread && task.direction === 'in') {
      unreadByDevice[task.senderId] = (unreadByDevice[task.senderId] || 0) + 1
    }
  }

  const counts: Record<FilterKey, number> = {
    all: boardTasks.length,
    new: boardTasks.filter((task) => task.unread && task.direction === 'in').length,
    active: boardTasks.filter((task) => task.status === 'active').length,
    resolved: boardTasks.filter((task) => task.status === 'resolved').length,
    voided: boardTasks.filter((task) => task.status === 'voided').length
  }

  const visibleTasks = boardTasks.filter((task) => {
    if (filter === 'all') return true
    if (filter === 'new') return task.unread && task.direction === 'in'
    return task.status === filter
  })

  const resetComposer = () => {
    setInput({ ...EMPTY_INPUT, mode: input.mode })
    setEditingId(null)
  }

  const saveDraft = async (): Promise<Task | null> => {
    if (!isValid(input)) return null
    return window.api.saveTask(input, editingId || undefined)
  }

  const handleSaveDraft = async () => {
    setBusy(true)
    try {
      await saveDraft()
      resetComposer()
      toast('已存为草稿，拖到左侧同事即可投递')
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleSendNow = async (device: Device) => {
    if (!isValid(input)) return
    setBusy(true)
    let task: Task | null = null
    try {
      task = await saveDraft()
      if (!task) return
      await window.api.sendTask(task.id, device.id)
      resetComposer()
      toast(`已投递给 ${displayName(device)}`)
    } catch (err) {
      if (task) setEditingId(task.id)
      toast(errorText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleDropTask = async (taskId: string, deviceId: string) => {
    setDragTaskId(null)
    setDragOverDevice(null)
    const device = state.devices.find((item) => item.id === deviceId)
    if (!device) return
    try {
      await window.api.sendTask(taskId, deviceId)
      toast(`已投递给 ${displayName(device)}`)
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  const handleStatus = async (task: Task, status: TaskStatus) => {
    try {
      await window.api.setStatus(task.id, status)
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  const handleDelete = async (task: Task) => {
    const label = task.title || task.description.split('\n')[0].slice(0, 40) || '这条任务'
    const isDraft = task.status === 'draft'
    const question = isDraft
      ? `删除草稿「${label}」？`
      : `删除「${label}」？\n对方设备上的这条任务也会一起移除。`
    if (!window.confirm(question)) return
    try {
      await window.api.deleteTask(task.id)
      if (editingId === task.id) resetComposer()
      toast('已删除')
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  const handleRead = (task: Task) => {
    if (task.unread && task.direction === 'in') void window.api.markRead(task.id)
  }

  const handleOpenAttachment = async (task: Task, attachment: Attachment) => {
    try {
      await window.api.openAttachment(task.id, attachment.id)
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  const handlePickAttachments = async () => {
    try {
      const added = await window.api.pickAttachments()
      if (added.length) {
        setInput((current) => ({ ...current, attachments: [...current.attachments, ...added] }))
      }
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  const handleAddFiles = async (files: File[]) => {
    const paths = files.map((file) => window.api.getPathForFile(file)).filter(Boolean)
    if (!paths.length) return
    try {
      const added = await window.api.addAttachmentPaths(paths)
      if (added.length) {
        setInput((current) => ({ ...current, attachments: [...current.attachments, ...added] }))
      }
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  const handleRemoveAttachment = async (attachment: Attachment) => {
    setInput((current) => ({
      ...current,
      attachments: current.attachments.filter((item) => item.id !== attachment.id)
    }))
    await window.api.discardAttachment(attachment)
  }

  const handleEditDraft = (task: Task) => {
    setEditingId(task.id)
    setInput({
      mode: task.mode,
      title: task.title,
      description: task.description,
      attachments: task.attachments
    })
    document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleAddPeer = async (address: string) => {
    try {
      await window.api.addPeer(address)
      toast('设备已添加')
    } catch (err) {
      throw new Error(errorText(err))
    }
  }

  const sendDraftTo = async (task: Task, device: Device) => {
    setPickerTask(null)
    try {
      await window.api.sendTask(task.id, device.id)
      toast(`已投递给 ${displayName(device)}`)
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  const requestSendDraft = (task: Task) => {
    if (onlineDevices.length === 1) {
      void sendDraftTo(task, onlineDevices[0])
    } else {
      setPickerTask(task)
    }
  }

  return (
    <div className={`app ${dragTaskId ? 'is-dragging' : ''}`}>
      <Sidebar
        self={state.self}
        devices={state.devices}
        unreadByDevice={unreadByDevice}
        dragActive={Boolean(dragTaskId)}
        dragOverDevice={dragOverDevice}
        onDragOverDevice={setDragOverDevice}
        onDropTask={(taskId, deviceId) => void handleDropTask(taskId, deviceId)}
        onSetAlias={(id, alias) => window.api.setAlias(id, alias)}
        onRemovePeer={(id) => void window.api.removePeer(id)}
        onAddPeer={handleAddPeer}
        onSetSelfName={async (name) => {
          await window.api.setSelfName(name)
          toast('设备名已更新')
        }}
        onReveal={() => void window.api.revealDataDir()}
      />

      <main className="main">
        <header className="topbar">
          <div>
            <h1>任务</h1>
            <p>写一条，拖到左侧同事设备上，任务会直接落到对方电脑里。</p>
          </div>
          <div className={`net-chip ${onlineDevices.length ? 'on' : ''}`}>
            <span className="pulse" />
            {onlineDevices.length ? `${onlineDevices.length} 台设备在线` : '等待同事上线'}
          </div>
        </header>

        <Composer
          input={input}
          editing={Boolean(editingId)}
          busy={busy}
          onlineDevices={onlineDevices}
          onChange={(patch) => setInput((current) => ({ ...current, ...patch }))}
          onSaveDraft={() => void handleSaveDraft()}
          onSendNow={(device) => void handleSendNow(device)}
          onPickAttachments={() => void handlePickAttachments()}
          onRemoveAttachment={(attachment) => void handleRemoveAttachment(attachment)}
          onAddFiles={(files) => void handleAddFiles(files)}
          onCancelEdit={resetComposer}
        />

        <DraftTray
          drafts={drafts}
          onEdit={handleEditDraft}
          onDelete={(task) => void handleDelete(task)}
          onDragStart={(task) => setDragTaskId(task.id)}
          onDragEnd={() => {
            setDragTaskId(null)
            setDragOverDevice(null)
          }}
          onSend={requestSendDraft}
        />

        <TaskList
          tasks={visibleTasks}
          devices={state.devices}
          filter={filter}
          counts={counts}
          onFilter={setFilter}
          onStatus={(task, status) => void handleStatus(task, status)}
          onDelete={(task) => void handleDelete(task)}
          onRead={handleRead}
          onOpenAttachment={(task, attachment) => void handleOpenAttachment(task, attachment)}
        />
      </main>

      <Toasts items={toasts} />

      {dragTaskId && !dragOverDevice && <div className="drag-banner">拖到左侧同事设备上发送</div>}

      {pickerTask && (
        <div className="modal-backdrop" onClick={() => setPickerTask(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>投递给…</h3>
              <button className="icon-btn" onClick={() => setPickerTask(null)} title="关闭">
                <IconX size={15} />
              </button>
            </div>
            <p className="modal-sub">选择一台在线的设备，任务会立刻送达。</p>
            <div className="modal-list">
              {onlineDevices.map((device) => (
                <button key={device.id} className="modal-device" onClick={() => void sendDraftTo(pickerTask, device)}>
                  <span className="menu-avatar">{initials(displayName(device))}</span>
                  <span className="menu-label">
                    <strong>{displayName(device)}</strong>
                    <small>{device.ip}</small>
                  </span>
                  <IconSend size={15} />
                </button>
              ))}
            </div>
            {onlineDevices.length === 0 && <div className="modal-empty">现在没有在线设备</div>}
          </div>
        </div>
      )}
    </div>
  )
}