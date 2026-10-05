// @vitest-environment jsdom
import { act, render, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import App from "./App";

const editor = vi.hoisted(() => ({
  props: null as null | {
    excalidrawAPI: (api: unknown) => void;
    onChange: (elements: ExcalidrawElement[], appState: { selectedElementIds: Record<string, boolean> }) => void;
    onPointerUpdate: (payload: { pointer: { x: number; y: number; tool: "pointer" } }) => void;
  },
  scene: [] as ExcalidrawElement[],
  echoOnUpdate: false,
  deferApi: false,
  api: null as unknown,
  updateScene: vi.fn(),
  setActiveTool: vi.fn(),
  scrollToContent: vi.fn(),
  getAppState: vi.fn(),
  appState: { zoom: { value: 1 }, gridModeEnabled: false, theme: "dark" },
}));

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "NEVER" },
  Excalidraw: (props: NonNullable<typeof editor.props>) => {
    editor.props = props;
    const api = {
      getSceneElementsIncludingDeleted: () => editor.scene,
      updateScene: (update: { elements?: ExcalidrawElement[]; collaborators?: Map<string, unknown> }) => {
        editor.updateScene(update);
        if (update.elements) {
          editor.scene = update.elements;
          if (editor.echoOnUpdate) editor.props?.onChange(update.elements, { selectedElementIds: {} });
        }
      },
      setActiveTool: editor.setActiveTool,
      scrollToContent: editor.scrollToContent,
      getAppState: () => {
        editor.getAppState();
        return editor.appState;
      },
    };
    editor.api = api;
    if (!editor.deferApi) props.excalidrawAPI(api);
    return null;
  },
}));

const element = (id: string, version: number, versionNonce = 1) =>
  ({ id, version, versionNonce, isDeleted: false }) as ExcalidrawElement;

function message(type: string, payload: unknown = {}) {
  act(() => window.dispatchEvent(new MessageEvent("message", {
    data: { type: `not3/draw/${type}`, payload }, source: window.parent,
  })));
}

function changes(elements: ExcalidrawElement[]) {
  editor.scene = elements;
  act(() => editor.props?.onChange(elements, { selectedElementIds: {} }));
}

beforeEach(() => {
  editor.scene = [];
  editor.props = null;
  editor.echoOnUpdate = false;
  editor.deferApi = false;
  editor.api = null;
  editor.updateScene.mockClear();
  editor.setActiveTool.mockClear();
  editor.scrollToContent.mockClear();
  editor.getAppState.mockClear();
  editor.appState = { zoom: { value: 1 }, gridModeEnabled: false, theme: "dark" };
  vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
});

function nativeKey(options: Partial<KeyboardEvent> & { key: string; target?: EventTarget | null }) {
  const event = {
    key: options.key,
    code: options.code ?? `Key${options.key.toUpperCase()}`,
    target: options.target ?? document.body,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    repeat: options.repeat ?? false,
    isComposing: options.isComposing ?? false,
    isTrusted: options.isTrusted ?? true,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return event;
}

function capturedKeydown(spy: ReturnType<typeof vi.spyOn>) {
  const call = spy.mock.calls.find((args: unknown[]) => args[0] === "keydown" && args[2] === true);
  expect(call).toBeDefined();
  return call?.[1] as (event: KeyboardEvent) => void;
}

function sentKeys() {
  return vi.mocked(window.parent.postMessage).mock.calls
    .map(([data]) => data as { type: string; payload: unknown })
    .filter(({ type }) => type === "not3/draw/keys/1/keydown");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("cowork bridge", () => {
  it("merges remote elements without overwriting newer local work", () => {
    render(<App initialElements={[element("local", 4)]} />);
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    changes([element("local", 5)]);
    message("collab/elements", { elements: [element("local", 3), element("remote", 1)] });
    expect(editor.updateScene).toHaveBeenCalledWith(expect.objectContaining({
      elements: [element("local", 5), element("remote", 1)],
      captureUpdate: "NEVER",
    }));
  });

  it("applies queued remote elements when the editor API becomes available", () => {
    editor.deferApi = true;
    render(<App />);
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    message("collab/elements", { elements: [element("remote", 1)] });
    expect(editor.updateScene).not.toHaveBeenCalled();
    act(() => editor.props?.excalidrawAPI(editor.api));
    expect(editor.updateScene).toHaveBeenCalledWith(expect.objectContaining({
      elements: [element("remote", 1)],
      captureUpdate: "NEVER",
    }));
  });

  it("applies queued collaborator pointers when the editor API becomes available", () => {
    editor.deferApi = true;
    render(<App />);
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    message("collab/pointers", { peers: [{
      id: "peer", name: "Ada", color: "#f00", pointer: { x: 12, y: 23 }, selected: ["shape"],
    }] });
    expect(editor.updateScene).not.toHaveBeenCalled();
    act(() => editor.props?.excalidrawAPI(editor.api));
    const update = editor.updateScene.mock.calls.find(([value]) => value.collaborators)?.[0];
    expect(update.collaborators.get("peer")).toMatchObject({
      username: "Ada", color: { background: "#f00", stroke: "#f00" },
      pointer: { x: 12, y: 23, tool: "pointer" },
      selectedElementIds: { shape: true },
    });
  });

  it("does not replay pointers from a stopped session", () => {
    editor.deferApi = true;
    render(<App />);
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    message("collab/pointers", { peers: [{
      id: "peer", name: "Ada", color: "#f00", pointer: { x: 12, y: 23 }, selected: [],
    }] });
    message("collab/stop");
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    act(() => editor.props?.excalidrawAPI(editor.api));
    expect(editor.updateScene.mock.calls.some(([value]) => value.collaborators?.has("peer"))).toBe(false);
  });

  it("sets named, colored remote collaborators", () => {
    render(<App />);
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    message("collab/pointers", { peers: [{
      id: "peer", name: "Ada", color: "#f00", pointer: { x: 12, y: 23 }, selected: ["shape"],
    }] });
    const update = editor.updateScene.mock.lastCall?.[0];
    expect(update.collaborators.get("peer")).toMatchObject({
      username: "Ada", color: { background: "#f00", stroke: "#f00" },
      pointer: { x: 12, y: 23, tool: "pointer" },
      selectedElementIds: { shape: true },
    });
  });

  it("sends the full scene on start and scene request", () => {
    render(<App initialElements={[element("first", 1)]} />);
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    changes([element("first", 2)]);
    message("collab/scene-request");
    expect(window.parent.postMessage).toHaveBeenCalledWith({
      type: "not3/draw/collab/scene", payload: { elements: [element("first", 2)] },
    }, "*");
  });

  it("ignores messages from another window", () => {
    render(<App />);
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: { type: "not3/draw/collab/start", payload: { self: { id: "me", name: "Me", color: "#123" } } },
      source: new MessageChannel().port1,
    })));
    expect(window.parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "not3/draw/collab/scene" }), "*");
  });

  it("does not echo remote elements as a local delta", () => {
    vi.useFakeTimers();
    editor.echoOnUpdate = true;
    render(<App />);
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    message("collab/elements", { elements: [element("remote", 2)] });
    act(() => vi.advanceTimersByTime(100));
    expect(window.parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "not3/draw/collab/delta" }), "*");
  });

  it("coalesces changed elements into no more than 30 deltas per second", () => {
    vi.useFakeTimers();
    render(<App />);
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    changes([element("a", 1)]);
    changes([element("a", 2)]);
    act(() => vi.advanceTimersByTime(33));
    expect(window.parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "not3/draw/collab/delta" }), "*");
    act(() => vi.advanceTimersByTime(1));
    expect(window.parent.postMessage).toHaveBeenCalledWith({
      type: "not3/draw/collab/delta", payload: { elements: [element("a", 2)] },
    }, "*");
    changes([element("a", 3)]);
    act(() => vi.advanceTimersByTime(33));
    expect(vi.mocked(window.parent.postMessage).mock.calls.filter(([data]) =>
      (data as { type: string }).type === "not3/draw/collab/delta")).toHaveLength(1);
  });

  it("does not resend the scene that existed when cowork started", () => {
    vi.useFakeTimers();
    render(<App />);
    changes([element("existing", 1)]);
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    changes([element("existing", 1), element("new", 1)]);
    act(() => vi.advanceTimersByTime(34));
    expect(window.parent.postMessage).toHaveBeenCalledWith({
      type: "not3/draw/collab/delta", payload: { elements: [element("new", 1)] },
    }, "*");
  });

  it("coalesces local pointers to at most 20 updates per second", () => {
    vi.useFakeTimers();
    render(<App />);
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    act(() => editor.props?.onPointerUpdate({ pointer: { x: 1, y: 1, tool: "pointer" } }));
    act(() => editor.props?.onPointerUpdate({ pointer: { x: 2, y: 3, tool: "pointer" } }));
    act(() => vi.advanceTimersByTime(49));
    expect(window.parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "not3/draw/collab/pointer" }), "*");
    act(() => vi.advanceTimersByTime(1));
    expect(window.parent.postMessage).toHaveBeenCalledWith({
      type: "not3/draw/collab/pointer", payload: { pointer: { x: 2, y: 3 }, selected: [] },
    }, "*");
  });

  it("clears the pointer when it leaves the drawing", () => {
    vi.useFakeTimers();
    const { container } = render(<App />);
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    act(() => editor.props?.onPointerUpdate({ pointer: { x: 2, y: 3, tool: "pointer" } }));
    fireEvent.pointerLeave(container.firstElementChild as Element);
    act(() => vi.advanceTimersByTime(50));
    expect(window.parent.postMessage).toHaveBeenCalledWith({
      type: "not3/draw/collab/pointer", payload: { pointer: null, selected: [] },
    }, "*");
  });

  it("sends selection changes with the current pointer", () => {
    vi.useFakeTimers();
    render(<App />);
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    act(() => editor.props?.onPointerUpdate({ pointer: { x: 2, y: 3, tool: "pointer" } }));
    act(() => vi.advanceTimersByTime(50));
    act(() => editor.props?.onChange([element("shape", 1)], { selectedElementIds: { shape: true } }));
    act(() => vi.advanceTimersByTime(50));
    expect(window.parent.postMessage).toHaveBeenCalledWith({
      type: "not3/draw/collab/pointer", payload: { pointer: { x: 2, y: 3 }, selected: ["shape"] },
    }, "*");
  });

  it("keeps ordinary change and save messages outside cowork mode", () => {
    render(<App />);
    changes([element("plain", 1)]);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })));
    expect(window.parent.postMessage).toHaveBeenCalledWith({
      type: "not3/draw/change", payload: [element("plain", 1)],
    }, "*");
    expect(window.parent.postMessage).toHaveBeenCalledWith({
      type: "not3/draw/save", payload: [element("plain", 1)],
    }, "*");
  });

  it("cancels queued delta and pointer messages when stopped", () => {
    vi.useFakeTimers();
    render(<App />);
    message("collab/start", { self: { id: "me", name: "Me", color: "#123" } });
    changes([element("local", 1)]);
    act(() => editor.props?.onPointerUpdate({ pointer: { x: 1, y: 1, tool: "pointer" } }));
    message("collab/stop");
    act(() => vi.advanceTimersByTime(100));
    expect(window.parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "not3/draw/collab/delta" }), "*");
    expect(window.parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "not3/draw/collab/pointer" }), "*");
    changes([element("local", 2)]);
    expect(window.parent.postMessage).toHaveBeenCalledWith({
      type: "not3/draw/change", payload: [element("local", 2)],
    }, "*");
  });
});

describe("draw key bridge", () => {
  it("installs capture immediately for an enable received before mount", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    render(<App keysEnabled />);
    expect(capturedKeydown(addListener)).toBeDefined();
  });

  it("keeps legacy Ctrl+S until a valid parent enable", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    render(<App />);
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: { type: "not3/draw/keys/1/enable" }, source: new MessageChannel().port1,
    })));
    expect(addListener.mock.calls.some(([type, , capture]) => type === "keydown" && capture === true)).toBe(false);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })));
    expect(window.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "not3/draw/save" }), "*");
    message("keys/1/enable");
    expect(capturedKeydown(addListener)).toBeDefined();
  });

  it("rejects an enable message with an invalid payload", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    render(<App />);
    message("keys/1/enable", []);
    expect(addListener.mock.calls.some(([type, , capture]) => type === "keydown" && capture === true)).toBe(false);
  });

  it("forwards a normalized stroke with increasing seq and repeat", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    render(<App />);
    message("keys/1/enable");
    const keydown = capturedKeydown(addListener);
    const first = nativeKey({ key: "S", code: "KeyS", ctrlKey: true, shiftKey: true });
    const second = nativeKey({ key: "Escape", code: "Escape", repeat: true });
    act(() => { keydown(first as unknown as KeyboardEvent); keydown(second as unknown as KeyboardEvent); });
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(first.stopPropagation).toHaveBeenCalledOnce();
    expect(sentKeys()).toEqual([
      { type: "not3/draw/keys/1/keydown", payload: { seq: 1, key: "ctrl+shift+s", repeat: false } },
      { type: "not3/draw/keys/1/keydown", payload: { seq: 2, key: "escape", repeat: true } },
    ]);
  });

  it("uses winctrl for a literal Windows key instead of the primary modifier", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    render(<App />);
    message("keys/1/enable");
    act(() => capturedKeydown(addListener)(nativeKey({ key: "s", code: "KeyS", metaKey: true }) as unknown as KeyboardEvent));
    expect(sentKeys()).toEqual([{ type: "not3/draw/keys/1/keydown", payload: { seq: 1, key: "winctrl+s", repeat: false } }]);
  });

  it.each(["input", "textarea", "contenteditable"])("leaves %s targets alone", (kind) => {
    const addListener = vi.spyOn(window, "addEventListener");
    const { container } = render(<App />);
    message("keys/1/enable");
    const target = document.createElement(kind === "contenteditable" ? "span" : kind);
    if (kind === "contenteditable") target.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    target.append(child);
    container.append(target);
    const event = nativeKey({ key: "x", target: child });
    act(() => capturedKeydown(addListener)(event as unknown as KeyboardEvent));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(sentKeys()).toHaveLength(0);
  });

  it.each([
    { key: "x", isComposing: true },
    { key: "Control" },
    { key: "x", isTrusted: false },
  ])("leaves composition, modifiers, and synthetic keys alone: %o", (options) => {
    const addListener = vi.spyOn(window, "addEventListener");
    render(<App />);
    message("keys/1/enable");
    const event = nativeKey(options);
    act(() => capturedKeydown(addListener)(event as unknown as KeyboardEvent));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(sentKeys()).toHaveLength(0);
  });

  it("applies out-of-order replies in press order", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    render(<App />);
    message("keys/1/enable");
    const keydown = capturedKeydown(addListener);
    act(() => { keydown(nativeKey({ key: "a" }) as unknown as KeyboardEvent); keydown(nativeKey({ key: "b" }) as unknown as KeyboardEvent); });
    message("keys/1/reply", { seq: 2, action: { kind: "draw", command: "draw.tool.rectangle" } });
    expect(editor.setActiveTool).not.toHaveBeenCalled();
    message("keys/1/reply", { seq: 1, action: { kind: "draw", command: "draw.tool.ellipse" } });
    expect(editor.setActiveTool.mock.calls).toEqual([[{ type: "ellipse" }], [{ type: "rectangle" }]]);
  });

  it("replays after 150 ms and ignores a late reply", () => {
    vi.useFakeTimers();
    const addListener = vi.spyOn(window, "addEventListener");
    const { container } = render(<App />);
    const replayed: string[] = [];
    container.firstElementChild?.addEventListener("keydown", (event) => replayed.push((event as KeyboardEvent).key));
    message("keys/1/enable");
    act(() => capturedKeydown(addListener)(nativeKey({ key: "x" }) as unknown as KeyboardEvent));
    act(() => vi.advanceTimersByTime(149));
    expect(replayed).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(replayed).toEqual(["x"]);
    message("keys/1/reply", { seq: 1, action: { kind: "draw", command: "draw.tool.rectangle" } });
    expect(editor.setActiveTool).not.toHaveBeenCalled();
  });

  it("preserves native key and code in the local fallback", () => {
    vi.useFakeTimers();
    const addListener = vi.spyOn(window, "addEventListener");
    const { container } = render(<App />);
    const events: KeyboardEvent[] = [];
    container.firstElementChild?.addEventListener("keydown", (event) => events.push(event as KeyboardEvent));
    message("keys/1/enable");
    act(() => capturedKeydown(addListener)(nativeKey({ key: "@", code: "Digit2", shiftKey: true }) as unknown as KeyboardEvent));
    act(() => vi.advanceTimersByTime(150));
    expect(events.map(({ key, code, shiftKey }) => ({ key, code, shiftKey }))).toEqual([
      { key: "@", code: "Digit2", shiftKey: true },
    ]);
  });

  it("replays synthetic keydown and keyup with code and modifier flags", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    const { container } = render(<App />);
    const events: KeyboardEvent[] = [];
    for (const type of ["keydown", "keyup"]) container.firstElementChild?.addEventListener(type, (event) => events.push(event as KeyboardEvent));
    message("keys/1/enable");
    act(() => capturedKeydown(addListener)(nativeKey({ key: "z" }) as unknown as KeyboardEvent));
    message("keys/1/reply", { seq: 1, action: { kind: "replay", key: "ctrl+shift+y" } });
    expect(events.map(({ type, key, code, ctrlKey, shiftKey, isTrusted }) => ({ type, key, code, ctrlKey, shiftKey, isTrusted }))).toEqual([
      { type: "keydown", key: "Y", code: "KeyY", ctrlKey: true, shiftKey: true, isTrusted: false },
      { type: "keyup", key: "Y", code: "KeyY", ctrlKey: true, shiftKey: true, isTrusted: false },
    ]);
    expect(sentKeys()).toHaveLength(1);
  });

  it("replays shifted punctuation with its browser key value", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    const { container } = render(<App />);
    const events: KeyboardEvent[] = [];
    container.firstElementChild?.addEventListener("keydown", (event) => events.push(event as KeyboardEvent));
    message("keys/1/enable");
    act(() => capturedKeydown(addListener)(nativeKey({ key: "x" }) as unknown as KeyboardEvent));
    message("keys/1/reply", { seq: 1, action: { kind: "replay", key: "shift+/" } });
    expect(events.map(({ key, code, shiftKey }) => ({ key, code, shiftKey }))).toEqual([
      { key: "?", code: "Slash", shiftKey: true },
    ]);
  });

  it("replays function and numpad keys with browser key and code values", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    const { container } = render(<App />);
    const events: KeyboardEvent[] = [];
    container.firstElementChild?.addEventListener("keydown", (event) => events.push(event as KeyboardEvent));
    message("keys/1/enable");
    act(() => capturedKeydown(addListener)(nativeKey({ key: "x" }) as unknown as KeyboardEvent));
    message("keys/1/reply", { seq: 1, action: { kind: "replay", key: "f1 numpad0" } });
    expect(events.map(({ key, code }) => ({ key, code }))).toEqual([
      { key: "F1", code: "F1" }, { key: "0", code: "Numpad0" },
    ]);
  });

  it("replays both strokes of a draw.key chord in order", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    const { container } = render(<App />);
    const events: string[] = [];
    for (const type of ["keydown", "keyup"]) container.firstElementChild?.addEventListener(type, (event) => events.push(`${event.type}:${(event as KeyboardEvent).key}`));
    message("keys/1/enable");
    act(() => capturedKeydown(addListener)(nativeKey({ key: "x" }) as unknown as KeyboardEvent));
    message("keys/1/reply", { seq: 1, action: { kind: "replay", key: "ctrl+k ctrl+s" } });
    expect(events).toEqual(["keydown:k", "keyup:k", "keydown:s", "keyup:s"]);
    expect(window.parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "not3/draw/save" }), "*");
  });

  it("executes an allowed tool and ignores an unknown draw command", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    render(<App />);
    message("keys/1/enable");
    const keydown = capturedKeydown(addListener);
    act(() => { keydown(nativeKey({ key: "x" }) as unknown as KeyboardEvent); keydown(nativeKey({ key: "y" }) as unknown as KeyboardEvent); });
    message("keys/1/reply", { seq: 1, action: { kind: "draw", command: "draw.tool.rectangle" } });
    message("keys/1/reply", { seq: 2, action: { kind: "draw", command: "draw.dangerous" } });
    expect(editor.setActiveTool.mock.calls).toEqual([[{ type: "rectangle" }]]);
    expect(editor.updateScene).not.toHaveBeenCalled();
    expect(editor.getAppState).not.toHaveBeenCalled();
  });

  it("ignores malformed and foreign replies until the local fallback", () => {
    vi.useFakeTimers();
    const addListener = vi.spyOn(window, "addEventListener");
    const { container } = render(<App />);
    const replayed: string[] = [];
    container.firstElementChild?.addEventListener("keydown", (event) => replayed.push((event as KeyboardEvent).key));
    message("keys/1/enable");
    act(() => capturedKeydown(addListener)(nativeKey({ key: "x" }) as unknown as KeyboardEvent));
    message("keys/1/reply", { seq: "1", action: { kind: "draw", command: "draw.tool.rectangle" } });
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: { type: "not3/draw/keys/1/reply", payload: { seq: 1, action: { kind: "draw", command: "draw.tool.rectangle" } } },
      source: new MessageChannel().port1,
    })));
    act(() => vi.advanceTimersByTime(150));
    expect(replayed).toEqual(["x"]);
    expect(editor.setActiveTool).not.toHaveBeenCalled();
  });

  it("routes zoom, grid, theme, and scroll commands through the public API", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    render(<App />);
    message("keys/1/enable");
    const keydown = capturedKeydown(addListener);
    for (const command of ["draw.zoomIn", "draw.zoomOut", "draw.zoomReset", "draw.toggleGrid", "draw.toggleTheme", "draw.scrollToContent"]) {
      const seq = sentKeys().length + 1;
      act(() => keydown(nativeKey({ key: "x" }) as unknown as KeyboardEvent));
      message("keys/1/reply", { seq, action: { kind: "draw", command } });
    }
    expect(editor.updateScene).toHaveBeenCalledWith({ appState: { zoom: { value: 1.1 } } });
    expect(editor.updateScene).toHaveBeenCalledWith({ appState: { zoom: { value: 1 } } });
    expect(editor.updateScene).toHaveBeenCalledWith({ appState: { gridModeEnabled: true } });
    expect(editor.updateScene).toHaveBeenCalledWith({ appState: { theme: "light" } });
    expect(editor.scrollToContent).toHaveBeenCalledOnce();
  });

  it("clears pending key fallbacks when unmounted", () => {
    vi.useFakeTimers();
    const addListener = vi.spyOn(window, "addEventListener");
    const { container, unmount } = render(<App />);
    const replayed: string[] = [];
    container.firstElementChild?.addEventListener("keydown", (event) => replayed.push((event as KeyboardEvent).key));
    message("keys/1/enable");
    act(() => capturedKeydown(addListener)(nativeKey({ key: "x" }) as unknown as KeyboardEvent));
    unmount();
    act(() => vi.advanceTimersByTime(150));
    expect(replayed).toEqual([]);
  });
});
