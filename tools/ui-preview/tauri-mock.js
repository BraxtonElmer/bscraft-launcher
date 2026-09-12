// Single module standing in for every @tauri-apps/api/* import in the Vite mock preview.
import { createMocks } from './mocks.js'

const m = createMocks().modules

export const invoke = m['@tauri-apps/api/core'].invoke
export const listen = m['@tauri-apps/api/event'].listen
export const getVersion = m['@tauri-apps/api/app'].getVersion
export const getCurrentWindow = m['@tauri-apps/api/window'].getCurrentWindow
