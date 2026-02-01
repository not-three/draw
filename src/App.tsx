import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useEffect, useRef } from "react";

type AppProps = {
  initialElements?: ExcalidrawElement[];
  isReadonly?: boolean;
};

function App({ initialElements = [], isReadonly = false }: AppProps) {
  const elementsRef = useRef<readonly ExcalidrawElement[]>(initialElements);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        window.parent.postMessage({
          type: "not3/draw/save",
          payload: elementsRef.current,
        }, "*");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

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
            },
          }}
          initialData={{
            elements: initialElements,
            appState: {
              theme: "dark",
            },
          }}
          viewModeEnabled={isReadonly}
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          onChange={(excalidrawElements, _appState, _files) => {
            elementsRef.current = excalidrawElements;
            window.parent.postMessage({
              type: "not3/draw/change",
              payload: excalidrawElements,
            }, "*");
          }}
        />
      </div>
    </>
  );
}

export default App;
