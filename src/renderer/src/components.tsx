import { useEffect, useRef, useState } from 'react'
import type { Attachment, Device, SelfInfo, Task, TaskInput, TaskStatus } from '../../shared/types'
import { STATUS_LABEL, displayName, formatSize, formatTime, initials, platformLabel } from './utils'

type IconProps = { size?: number }

function Icon({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
export const IconSend = (p: IconProps) => (
  <Icon {...p}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
  </Icon>
)
export const IconPaperclip = (p: IconProps) => (
  <Icon {...p}>
    <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Icon>
)
export const IconPencil = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Icon>
)
export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </Icon>
)
export const IconX = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
)
export const IconMonitor = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Icon>
)
export const IconFolder = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />
  </Icon>
)
export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
)
export const IconChevron = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

interface SidebarProps {
  self: SelfInfo
  devices: Device[]
  unreadByDevice: Record<string, number>
  dragActive: boolean
  dragOverDevice: string | null
  onDragOverDevice: (id: string | null) => void
  onDropTask: (taskId: string, deviceId: string) => void
  onSetAlias: (id: string, alias: string) => Promise<void>
  onRemovePeer: (id: string) => void
  onAddPeer: (address: string) => Promise<void>
  onSetSelfName: (name: string) => Promise<void>
  onReveal: () => void
}

export function Sidebar(props: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [address, setAddress] = useState('')
  const [addError, setAddError] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [selfEditing, setSelfEditing] = useState(false)
  const [selfValue, setSelfValue] = useState(props.self.name)

  useEffect(() => {
    setSelfValue(props.self.name)
  }, [props.self.name])

  const onlineCount = props.devices.filter((d) => d.online).length

  const startAlias = (device: Device) => {
    setEditingId(device.id)
    setEditValue(device.alias)
  }

  const commitAlias = async (device: Device) => {
    await props.onSetAlias(device.id, editValue)
    setEditingId(null)
  }

  const submitAddress = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!address.trim() || addBusy) return
    setAddBusy(true)
    setAddError('')
    try {
      await props.onAddPeer(address)
      setAddress('')
      setAdding(false)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddBusy(false)
    }
  }

  return (
    <aside className={`sidebar ${props.dragActive ? 'drag-mode' : ''}`}>
      <div className="brand">
        <div className="brand-mark">TD</div>
        <div className="brand-text">
          <h1>DTask</h1>
          <p>局域网任务投递</p>
        </div>
      </div>

      <div className="self-card">
        <span className="presence online" />
        <div className="self-meta">
          <span className="micro">本机</span>
          {selfEditing ? (
            <input
              className="inline-input self-input"
              autoFocus
              value={selfValue}
              onChange={(e) => setSelfValue(e.target.value)}
              onBlur={() => setSelfEditing(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const value = selfValue.trim()
                  if (value) void props.onSetSelfName(value)
                  setSelfEditing(false)
                }
                if (e.key === 'Escape') setSelfEditing(false)
              }}
            />
          ) : (
            <strong>{props.self.name}</strong>
          )}
          <span className="micro">
            {platformLabel(props.self.platform)} · 端口 {props.self.port}
          </span>
        </div>
        <button
          className="icon-btn subtle"
          title="修改本机设备名"
          onClick={() => {
            setSelfValue(props.self.name)
            setSelfEditing(true)
          }}
        >
          <IconPencil size={14} />
        </button>
      </div>

      <div className="section-title">
        <span>同事设备</span>
        <span className="section-count">
          {onlineCount}/{props.devices.length} 在线
        </span>
      </div>

      <div className="device-list">
        {props.devices.length === 0 && (
          <div className="device-empty">
            还没有发现同事
            <br />
            等对方打开软件，或手动添加 IP
          </div>
        )}

        {props.devices.map((device) => {
          const isEditing = editingId === device.id
          const unread = props.unreadByDevice[device.id] || 0
          return (
            <div
              key={device.id}
              className={[
                'device',
                device.online ? 'is-online' : 'is-offline',
                props.dragOverDevice === device.id ? 'is-drop-target' : ''
              ].join(' ')}
              onDragOver={(e) => {
                if (!props.dragActive || !device.online) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                props.onDragOverDevice(device.id)
              }}
              onDragLeave={() => {
                if (props.dragOverDevice === device.id) props.onDragOverDevice(null)
              }}
              onDrop={(e) => {
                if (!device.online) return
                e.preventDefault()
                props.onDragOverDevice(null)
                const taskId = e.dataTransfer.getData('text/dtask') || e.dataTransfer.getData('text/plain')
                if (taskId) props.onDropTask(taskId, device.id)
              }}
            >
              <div className="avatar">{initials(displayName(device))}</div>

              {isEditing ? (
                <div className="device-edit">
                  <input
                    className="inline-input"
                    autoFocus
                    value={editValue}
                    placeholder="给这台设备起个备注"
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitAlias(device)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                  <div className="device-edit-actions">
                    <button className="mini primary-mini" onClick={() => void commitAlias(device)}>
                      保存
                    </button>
                    <button className="mini" onClick={() => setEditingId(null)}>
                      取消
                    </button>
                    {!device.online && (
                      <button
                        className="mini danger-mini"
                        onClick={() => {
                          setEditingId(null)
                          props.onRemovePeer(device.id)
                        }}
                      >
                        移除
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="device-body">
                  <div className="device-name">
                    {displayName(device)}
                    {unread > 0 && <span className="badge">{unread}</span>}
                  </div>
                  <div className="device-sub">
                    {device.alias ? `${device.name} · ` : ''}
                    {device.online ? device.ip : device.ip ? '离线' : '等待发现'}
                  </div>
                </div>
              )}

              {!isEditing && (
                <button className="icon-btn subtle device-edit-btn" title="修改备注" onClick={() => startAlias(device)}>
                  <IconPencil size={13} />
                </button>
              )}
              <span className={`presence ${device.online ? 'online' : 'offline'}`} />
            </div>
          )
        })}
      </div>

      {adding ? (
        <form className="add-device-form" onSubmit={submitAddress}>
          <input
            className="inline-input"
            autoFocus
            placeholder="192.168.1.8 或 192.168.1.8:47821"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAdding(false)
                setAddError('')
              }
            }}
          />
          <div className="add-device-actions">
            <button className="mini primary-mini" type="submit" disabled={addBusy}>
              {addBusy ? '连接中…' : '连接'}
            </button>
            <button
              className="mini"
              type="button"
              onClick={() => {
                setAdding(false)
                setAddError('')
              }}
            >
              取消
            </button>
          </div>
          {addError && <div className="form-error">{addError}</div>}
        </form>
      ) : (
        <button className="add-device" onClick={() => setAdding(true)}>
          <IconPlus size={15} /> 手动添加设备 IP
        </button>
      )}

      <div className="sidebar-footer" onClick={props.onReveal} title="打开本地数据目录">
        <IconFolder size={14} /> 数据目录
      </div>
    </aside>
  )
}

interface ComposerProps {
  input: TaskInput
  editing: boolean
  busy: boolean
  onlineDevices: Device[]
  onChange: (patch: Partial<TaskInput>) => void
  onSaveDraft: () => void
  onSendNow: (device: Device) => void
  onPickAttachments: () => void
  onRemoveAttachment: (attachment: Attachment) => void
  onAddFiles: (files: File[]) => void
  onCancelEdit: () => void
}

export function Composer(props: ComposerProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [fileOver, setFileOver] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  useEffect(() => {
    if (props.onlineDevices.length === 0) setMenuOpen(false)
  }, [props.onlineDevices.length])

  const valid =
    props.input.mode === 'simple'
      ? props.input.description.trim().length > 0
      : props.input.title.trim().length > 0 && props.input.description.trim().length > 0

  return (
    <section
      className={`composer card ${fileOver ? 'file-over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setFileOver(true)
        }
      }}
      onDragLeave={() => setFileOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setFileOver(false)
        props.onAddFiles(Array.from(e.dataTransfer.files))
      }}
    >
      <div className="composer-head">
        <div className="mode-tabs">
          <button
            className={props.input.mode === 'simple' ? 'on' : ''}
            onClick={() => props.onChange({ mode: 'simple' })}
          >
            简易
          </button>
          <button
            className={props.input.mode === 'standard' ? 'on' : ''}
            onClick={() => props.onChange({ mode: 'standard' })}
          >
            标准
          </button>
        </div>
        <span className="composer-tip">
          {props.input.mode === 'simple' ? '只填描述，适合顺手交代的事' : '标题 + 描述，适合正式一点的任务'}
        </span>
        {props.editing && (
          <>
            <span className="editing-pill">正在编辑草稿</span>
            <button className="link-btn" onClick={props.onCancelEdit}>
              取消编辑
            </button>
          </>
        )}
      </div>

      {props.input.mode === 'standard' && (
        <input
          className="title-input"
          placeholder="任务标题"
          value={props.input.title}
          onChange={(e) => props.onChange({ title: e.target.value })}
          maxLength={200}
        />
      )}

      <textarea
        className="desc-input"
        placeholder={
          props.input.mode === 'simple'
            ? '只写描述，例如：帮忙把预发环境的日志清一下'
            : '补充描述、复现步骤、验收标准…'
        }
        value={props.input.description}
        onChange={(e) => props.onChange({ description: e.target.value })}
        rows={props.input.mode === 'simple' ? 4 : 5}
      />

      {props.input.attachments.length > 0 && (
        <div className="attachments">
          {props.input.attachments.map((attachment) => (
            <span className="att-chip" key={attachment.id}>
              <IconPaperclip size={13} />
              <span className="att-name">{attachment.name}</span>
              <span className="att-size">{formatSize(attachment.size)}</span>
              <button
                className="att-remove"
                title="移除附件"
                onClick={() => props.onRemoveAttachment(attachment)}
              >
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="composer-foot">
        <button className="soft-btn" onClick={props.onPickAttachments}>
          <IconPaperclip size={15} /> 附件
        </button>
        <span className="hint">文件也可以直接拖进这块区域</span>
        <span className="spacer" />
        <button className="ghost-btn" disabled={!valid || props.busy} onClick={props.onSaveDraft}>
          存为草稿
        </button>
        <div className="send-wrap" ref={menuRef}>
          <button
            className="primary-btn"
            disabled={!valid || props.busy || props.onlineDevices.length === 0}
            onClick={() => setMenuOpen((open) => !open)}
            title={props.onlineDevices.length === 0 ? '等同事设备上线后才能发送' : '选择一台设备'}
          >
            <IconSend size={15} /> 发送给…
            <IconChevron size={14} />
          </button>
          {menuOpen && (
            <div className="send-menu">
              {props.onlineDevices.map((device) => (
                <button
                  key={device.id}
                  onClick={() => {
                    setMenuOpen(false)
                    props.onSendNow(device)
                  }}
                >
                  <span className="menu-avatar">{initials(displayName(device))}</span>
                  <span className="menu-label">
                    <strong>{displayName(device)}</strong>
                    <small>{device.ip}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {fileOver && <div className="file-overlay">松开即可添加附件</div>}
    </section>
  )
}

interface DraftTrayProps {
  drafts: Task[]
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onDragStart: (task: Task) => void
  onDragEnd: () => void
  onSend: (task: Task) => void
}

export function DraftTray(props: DraftTrayProps) {
  return (
    <section className="draft-section">
      <div className="section-row">
        <h2>草稿</h2>
        <span className="section-hint">
          {props.drafts.length > 0 ? '按住卡片拖到左侧同事设备，松手即发送' : '还没有草稿'}
        </span>
      </div>

      {props.drafts.length === 0 ? (
        <div className="draft-empty">在上面的编辑器里写好内容，点「存为草稿」</div>
      ) : (
        <div className="draft-row">
          {props.drafts.map((task) => (
            <article
              className="draft-card"
              key={task.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/dtask', task.id)
                e.dataTransfer.setData('text/plain', task.id)
                e.dataTransfer.effectAllowed = 'move'
                props.onDragStart(task)
              }}
              onDragEnd={props.onDragEnd}
            >
              <div className="draft-top">
                <span className={`mode-tag ${task.mode}`}>{task.mode === 'simple' ? '简易' : '标准'}</span>
                <span className="draft-time">{formatTime(task.updatedAt)}</span>
              </div>
              <div className="draft-title">{task.title || task.description.split('\n')[0] || '未命名草稿'}</div>
              {task.title && task.description && <div className="draft-desc">{task.description}</div>}
              <div className="draft-foot">
                <span className="draft-meta">
                  {task.attachments.length > 0 && (
                    <span>
                      <IconPaperclip size={12} /> {task.attachments.length}
                    </span>
                  )}
                  <span className="grab-hint">拖动发送</span>
                </span>
                <span className="draft-actions">
                  <button className="icon-btn" title="编辑" onClick={() => props.onEdit(task)}>
                    <IconPencil size={13} />
                  </button>
                  <button className="icon-btn" title="删除" onClick={() => props.onDelete(task)}>
                    <IconTrash size={13} />
                  </button>
                  <button className="icon-btn send" title="发送给…" onClick={() => props.onSend(task)}>
                    <IconSend size={13} />
                  </button>
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export type FilterKey = 'all' | 'new' | 'active' | 'resolved' | 'voided'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'new', label: '新任务' },
  { key: 'active', label: '启用' },
  { key: 'resolved', label: '解决' },
  { key: 'voided', label: '作废' }
]

interface TaskCardProps {
  task: Task
  devices: Device[]
  onStatus: (task: Task, status: TaskStatus) => void
  onDelete: (task: Task) => void
  onRead: (task: Task) => void
  onOpenAttachment: (task: Task, attachment: Attachment) => void
}

function TaskCard(props: TaskCardProps) {
  const { task } = props
  const peerName = (() => {
    if (task.direction === 'out') {
      const device = props.devices.find((d) => d.id === task.receiverId)
      return device ? displayName(device) : task.receiverName || '对方设备'
    }
    return task.senderName || '同事'
  })()

  return (
    <article
      className={`task-card status-${task.status} ${task.unread ? 'is-unread' : ''}`}
      onClick={() => props.onRead(task)}
    >
      <div className="task-head">
        {task.unread && <span className="new-pill">新</span>}
        <span className={`mode-tag ${task.mode}`}>{task.mode === 'simple' ? '简易' : '标准'}</span>
        <span className={`route ${task.direction}`}>
          {task.direction === 'in' ? `来自 ${peerName}` : `发给 ${peerName}`}
        </span>
        <span className="task-time">{formatTime(task.updatedAt)}</span>
        <span className="spacer" />
        <select
          className={`status-select ${task.status}`}
          value={task.status}
          title="修改任务状态"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => props.onStatus(task, e.target.value as TaskStatus)}
        >
          <option value="active">启用</option>
          <option value="resolved">解决</option>
          <option value="voided">作废</option>
        </select>
        <button
          className="icon-btn danger"
          title="删除任务"
          onClick={(e) => {
            e.stopPropagation()
            props.onDelete(task)
          }}
        >
          <IconTrash size={14} />
        </button>
      </div>

      {task.title && <h3 className="task-title">{task.title}</h3>}
      {task.description && <p className="task-desc">{task.description}</p>}

      {task.attachments.length > 0 && (
        <div className="attachments">
          {task.attachments.map((attachment) => {
            const ready = Boolean(attachment.file)
            return (
              <button
                key={attachment.id}
                className={`att-chip ${ready ? '' : 'pending'}`}
                disabled={!ready}
                title={ready ? '打开附件' : '正在接收附件'}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onOpenAttachment(task, attachment)
                }}
              >
                <IconPaperclip size={13} />
                <span className="att-name">{attachment.name}</span>
                <span className="att-size">{ready ? formatSize(attachment.size) : '接收中…'}</span>
              </button>
            )
          })}
        </div>
      )}
    </article>
  )
}

interface TaskListProps {
  tasks: Task[]
  devices: Device[]
  filter: FilterKey
  counts: Record<FilterKey, number>
  onFilter: (filter: FilterKey) => void
  onStatus: (task: Task, status: TaskStatus) => void
  onDelete: (task: Task) => void
  onRead: (task: Task) => void
  onOpenAttachment: (task: Task, attachment: Attachment) => void
}

export function TaskList(props: TaskListProps) {
  return (
    <section className="task-section">
      <div className="toolbar">
        <div className="filters">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              className={`filter-chip ${props.filter === filter.key ? 'on' : ''}`}
              onClick={() => props.onFilter(filter.key)}
            >
              {filter.label}
              <span className="filter-count">{props.counts[filter.key] || 0}</span>
            </button>
          ))}
        </div>
        <span className="toolbar-note">状态改动会自动同步给对方</span>
      </div>

      {props.tasks.length === 0 ? (
        <div className="task-empty">
          {props.filter === 'all'
            ? '还没有任务。写好一条，拖到左侧同事设备上试试。'
            : `没有${FILTERS.find((f) => f.key === props.filter)?.label || ''}状态的任务`}
        </div>
      ) : (
        <div className="task-list">
          {props.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              devices={props.devices}
              onStatus={props.onStatus}
              onDelete={props.onDelete}
              onRead={props.onRead}
              onOpenAttachment={props.onOpenAttachment}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export interface ToastItem {
  id: number
  kind: 'ok' | 'error'
  text: string
}

export function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="toasts">
      {items.map((item) => (
        <div key={item.id} className={`toast ${item.kind}`}>
          {item.kind === 'ok' ? <IconCheck size={14} /> : <IconX size={14} />}
          {item.text}
        </div>
      ))}
    </div>
  )
}