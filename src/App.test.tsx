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
  updateScene: vi.fn(),
}));

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: (props: NonNullable<typeof editor.props>) => {
    editor.props = props;
    props.excalidrawAPI({
      getSceneElementsIncludingDeleted: () => editor.scene,
      updateScene: (update: { elements?: ExcalidrawElement[]; collaborators?: Map<string, unknown> }) => {
        editor.updateScene(update);
        if (update.elements) {
          editor.scene = update.elements;
          if (editor.echoOnUpdate) editor.props?.onChange(update.elements, { selectedElementIds: {} });
        }
      },
    });
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
  editor.updateScene.mockClear();
  vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
});

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
    }));
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
