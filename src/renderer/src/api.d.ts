import type { DTaskApi } from '../../preload'

declare global {
  interface Window {
    api: DTaskApi
  }
}

export {}