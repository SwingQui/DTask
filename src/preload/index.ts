import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppState, Attachment, Task, TaskInput, TaskStatus } from '../shared/types'

const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),

  onState: (callback: (state: AppState) => void): (() => void) => {
    const listener = (_event: unknown, state: AppState): void => callback(state)
    ipcRenderer.on('state', listener)
    return () => ipcRenderer.removeListener('state', listener)
  },

  setSelfName: (name: string): Promise<void> => ipcRenderer.invoke('self:setName', name),
  setAlias: (deviceId: string, alias: string): Promise<void> => ipcRenderer.invoke('peer:setAlias', deviceId, alias),
  addPeer: (address: string): Promise<unknown> => ipcRenderer.invoke('peer:add', address),
  removePeer: (deviceId: string): Promise<void> => ipcRenderer.invoke('peer:remove', deviceId),

  pickAttachments: (): Promise<Attachment[]> => ipcRenderer.invoke('attachments:pick'),
  addAttachmentPaths: (paths: string[]): Promise<Attachment[]> => ipcRenderer.invoke('attachments:addPaths', paths),
  discardAttachment: (attachment: Attachment): Promise<void> => ipcRenderer.invoke('attachments:discard', attachment),
  openAttachment: (taskId: string, attachmentId: string): Promise<void> =>
    ipcRenderer.invoke('attachments:open', taskId, attachmentId),

  saveTask: (input: TaskInput, taskId?: string): Promise<Task> => ipcRenderer.invoke('task:save', input, taskId),
  sendTask: (taskId: string, peerId: string): Promise<Task> => ipcRenderer.invoke('task:send', taskId, peerId),
  setStatus: (taskId: string, status: TaskStatus): Promise<Task> =>
    ipcRenderer.invoke('task:status', taskId, status),
  markRead: (taskId: string): Promise<void> => ipcRenderer.invoke('task:read', taskId),
  deleteTask: (taskId: string): Promise<void> => ipcRenderer.invoke('task:delete', taskId),

  revealDataDir: (): Promise<void> => ipcRenderer.invoke('app:revealData'),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('api', api)

export type TaskDropApi = typeof api