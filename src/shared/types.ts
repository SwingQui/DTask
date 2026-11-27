export type TaskStatus = 'draft' | 'active' | 'resolved' | 'voided'
export type TaskMode = 'simple' | 'standard'
export type TaskDirection = 'in' | 'out' | 'local'

export interface Attachment {
  id: string
  name: string
  size: number
  mime: string
  file: string
}

export interface Task {
  id: string
  mode: TaskMode
  title: string
  description: string
  status: TaskStatus
  direction: TaskDirection
  senderId: string
  senderName: string
  senderPort?: number
  receiverId: string | null
  receiverName: string | null
  attachments: Attachment[]
  unread: boolean
  deleted: boolean
  revision: number
  createdAt: number
  updatedAt: number
}

export interface Device {
  id: string
  name: string
  alias: string
  platform: string
  ip: string
  port: number
  online: boolean
  manual: boolean
  lastSeen: number
}

export interface SelfInfo {
  id: string
  name: string
  port: number
  platform: string
}

export interface AppState {
  self: SelfInfo
  devices: Device[]
  tasks: Task[]
  dataDir: string
}

export interface TaskInput {
  mode: TaskMode
  title: string
  description: string
  attachments: Attachment[]
}

export interface PeerIdentity {
  deviceId: string
  name: string
  platform: string
  port: number
}

export interface AnnouncePacket {
  app: 'dtask'
  type: 'announce' | 'probe'
  deviceId: string
  name: string
  port: number
  platform: string
  ts: number
}