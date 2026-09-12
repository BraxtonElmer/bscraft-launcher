// Runs the real Vite frontend in a plain browser against the mock backend.
// npx vite --config tools/ui-preview/vite.mock.config.mjs  ->  http://localhost:5179/?s=update
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const mock = fileURLToPath(new URL('./tauri-mock.js', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@tauri-apps\/api\/(core|event|app|window)$/, replacement: mock }],
  },
  server: {
    port: 5179,
    strictPort: true,
    fs: { allow: [here, fileURLToPath(new URL('../..', import.meta.url))] },
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
