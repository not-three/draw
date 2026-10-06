import { CaptureUpdateAction, Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Collaborator, ExcalidrawImperativeAPI, SocketId } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { diff, reconcile } from "./collab";
import { installDrawKeys } from "./keys";

type AppProps = {
  initialElements?: ExcalidrawElement[];
  isReadonly?: boolean;
  keysEnabled?: boolean;
};

type Peer = {
  id: string;
  name: string;
  color: string;
  pointer: { x: number; y: number } | null;
  selected: string[];
};

type Pointer = { pointer: { x: number; y: number } | null; selected: string[] };

const EMPTY_ELEMENTS: ExcalidrawElement[] = [];

function sceneNeedsUpdate(live: readonly ExcalidrawElement[], merged: readonly ExcalidrawElement[]) {
  return live.length !== merged.length || diff(live, merged).length > 0 ||
    live.some((element, index) => element.id !== merged[index].id);
}

function App({ initialElements = EMPTY_ELEMENTS, isReadonly = false, keysEnabled = false }: AppProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initialKeysEnabled = useRef(keysEnabled);
  const collaboratorsRef = useRef<Map<SocketId, Collaborator> | null>(null);
  const elementsRef = useRef<readonly ExcalidrawElement[]>(initialElements);
  const emittedRef = useRef<readonly ExcalidrawElement[]>(initialElements);
  const collabRef = useRef(false);
  const [isCollaborating, setIsCollaborating] = useState(false);
  const deltaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerRef = useRef<Pointer>({ pointer: null, selected: [] });
  const selectedRef = useRef<string[]>([]);

  const post = useCallback((name: string, payload: unknown) => {
    window.parent.postMessage({ type: `not3/draw/${name}`, payload }, "*");
  }, []);

  const currentScene = useCallback(() => {
    const live = apiRef.current?.getSceneElementsIncludingDeleted() ?? [];
    return reconcile(elementsRef.current, live);
  }, []);

  const clearTimers = useCallback(() => {
    if (deltaTimerRef.current !== null) clearTimeout(deltaTimerRef.current);
    if (pointerTimerRef.current !== null) clearTimeout(pointerTimerRef.current);
    deltaTimerRef.current = null;
    pointerTimerRef.current = null;
  }, []);

  const queueDelta = useCallback(() => {
    if (!collabRef.current || deltaTimerRef.current !== null) return;
    deltaTimerRef.current = setTimeout(() => {
      deltaTimerRef.current = null;
      if (!collabRef.current) return;
      const scene = currentScene();
      const changed = diff(emittedRef.current, scene);
      if (changed.length > 0) post("collab/delta", { elements: changed });
      emittedRef.current = scene;
    }, 34);
  }, [currentScene, post]);

  const queuePointer = useCallback(() => {
    if (!collabRef.current || pointerTimerRef.current !== null) return;
    pointerTimerRef.current = setTimeout(() => {
      pointerTimerRef.current = null;
      if (collabRef.current) post("collab/pointer", pointerRef.current);
    }, 50);
  }, [post]);

  useEffect(() => {
    elementsRef.current = initialElements;
    emittedRef.current = initialElements;
  }, [initialElements]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
      const { type, payload } = event.data;
      switch (type) {
        case "not3/draw/collab/start": {
          if (!payload?.self || typeof payload.self.id !== "string") return;
          clearTimers();
          collabRef.current = true;
          collaboratorsRef.current = null;
          setIsCollaborating(true);
          elementsRef.current = currentScene();
          emittedRef.current = elementsRef.current;
          post("collab/scene", { elements: elementsRef.current });
          break;
        }
        case "not3/draw/collab/elements": {
          if (!collabRef.current || !Array.isArray(payload?.elements)) return;
          const live = apiRef.current?.getSceneElementsIncludingDeleted() ?? elementsRef.current;
          const merged = reconcile(reconcile(elementsRef.current, live), payload.elements);
          elementsRef.current = merged;
          // Remote elements belong to the delta baseline, so updateScene's
          // onChange callback cannot send them back as local edits.
          emittedRef.current = reconcile(emittedRef.current, payload.elements);
          if (sceneNeedsUpdate(live, merged)) apiRef.current?.updateScene({
            elements: merged,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          break;
        }
        case "not3/draw/collab/pointers": {
          if (!collabRef.current || !Array.isArray(payload?.peers)) return;
          const collaborators = new Map<SocketId, Collaborator>();
          for (const peer of payload.peers as Peer[]) {
            if (typeof peer.id !== "string" || !Array.isArray(peer.selected)) continue;
            collaborators.set(peer.id as SocketId, {
              username: peer.name,
              color: { background: peer.color, stroke: peer.color },
              ...(peer.pointer ? { pointer: { ...peer.pointer, tool: "pointer" as const } } : {}),
              selectedElementIds: Object.fromEntries(peer.selected.map((id) => [id, true as const])),
            });
          }
          collaboratorsRef.current = collaborators;
          apiRef.current?.updateScene({ collaborators });
          break;
        }
        case "not3/draw/collab/scene-request": {
          if (!collabRef.current) return;
          elementsRef.current = currentScene();
          post("collab/scene", { elements: elementsRef.current });
          break;
        }
        case "not3/draw/collab/stop": {
          collabRef.current = false;
          collaboratorsRef.current = null;
          setIsCollaborating(false);
          clearTimers();
          apiRef.current?.updateScene({ collaborators: new Map() });
          break;
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      clearTimers();
      window.removeEventListener("message", handleMessage);
    };
  }, [clearTimers, currentScene, post]);

  useEffect(() => installDrawKeys(
    containerRef.current!, () => apiRef.current, () => post("save", elementsRef.current),
    initialKeysEnabled.current,
  ), [post]);

  return (
    <div
      ref={containerRef}
      style={{ height: "100%", width: "100%" }}
      onPointerLeave={() => {
        if (!collabRef.current) return;
        pointerRef.current = { pointer: null, selected: selectedRef.current };
        queuePointer();
      }}
    >
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api;
          if (!collabRef.current) return;
          const live = api.getSceneElementsIncludingDeleted();
          const merged = reconcile(live, elementsRef.current);
          elementsRef.current = merged;
          if (sceneNeedsUpdate(live, merged)) api.updateScene({
            elements: merged,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          if (collaboratorsRef.current) api.updateScene({ collaborators: collaboratorsRef.current });
          if (diff(emittedRef.current, merged).length > 0) queueDelta();
        }}
        isCollaborating={isCollaborating}
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
        initialData={{ elements: initialElements, appState: { theme: "dark" } }}
        viewModeEnabled={isReadonly}
        onChange={(elements, appState) => {
          elementsRef.current = collabRef.current ? reconcile(elementsRef.current, elements) : elements;
          const selected = Object.keys(appState.selectedElementIds).filter((id) => appState.selectedElementIds[id]);
          if (collabRef.current && selected.join("\0") !== selectedRef.current.join("\0")) {
            pointerRef.current = { ...pointerRef.current, selected };
            queuePointer();
          }
          selectedRef.current = selected;
          if (collabRef.current) queueDelta();
          else post("change", elements);
        }}
        onPointerUpdate={({ pointer }) => {
          if (!collabRef.current) return;
          pointerRef.current = { pointer: { x: pointer.x, y: pointer.y }, selected: selectedRef.current };
          queuePointer();
        }}
      />
    </div>
  );
}

export default App;
