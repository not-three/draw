import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AppLoader from './AppLoader.tsx'

const url = new URL(window.location.href);
if (!url.pathname.endsWith('/')) url.pathname = url.pathname.substring(0, url.pathname.lastIndexOf('/')) + '/';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).EXCALIDRAW_ASSET_PATH = url.toString();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppLoader />
  </StrictMode>,
)
