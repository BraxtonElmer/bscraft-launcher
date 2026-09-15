import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './styles/globals.css'
import { isMac } from './lib/platform'

// Styles that differ per OS (the macOS window buttons sit over the nav rail)
document.documentElement.dataset.platform = isMac ? 'mac' : 'windows'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
