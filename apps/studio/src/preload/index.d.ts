import type { studioApiWithCompat } from '../shared/types'

declare global {
  interface Window {
    api: studioApiWithCompat
  }
}

export {}
