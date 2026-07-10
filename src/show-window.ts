import { appWindow } from '@tauri-apps/api/window'

console.log('[show-window] showing main window')
appWindow.show().then(() => {
  console.log('[show-window] window shown')
}).catch((err) => {
  console.error('[show-window] failed to show window:', err)
})
