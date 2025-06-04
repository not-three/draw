import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AppLoader from './AppLoader.tsx'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).EXCALIDRAW_ASSET_PATH = "/";

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppLoader />
  </StrictMode>,
)
