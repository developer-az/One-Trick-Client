import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

export function renderPage(node: ReactNode): void {
  const root = document.getElementById('root')
  if (!root) throw new Error('Missing #root')
  createRoot(root).render(<StrictMode>{node}</StrictMode>)
}
