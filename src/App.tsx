import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

function App() {
  return (
    <>
      <div style={{ height: "100%", width: "100%" }}>
        <Excalidraw
          libraryReturnUrl="https://example.com"
          UIOptions={{
            canvasActions: {
              saveToActiveFile: false,
              export: false,
              loadScene: false,
            },
            tools: {
              image: false, // TODO: Enable when extensive storage feature is implemented
            }
          }}
          initialData={{
            appState: {
              theme: "dark",
            }
          }}
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          onChange={(excalidrawElements, _appState, _files) => {
            window.parent.postMessage({
              type: "not3/draw/change",
              payload: excalidrawElements,
            })
          }}
        />
      </div>
    </>
  );
}

export default App;
