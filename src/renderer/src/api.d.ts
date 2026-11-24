import type { TaskDropApi } from '../../preload'

declare global {
  interface Window {
    api: TaskDropApi
  }
}

export {}