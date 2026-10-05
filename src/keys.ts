import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

type Action =
  | { kind: "none" }
  | { kind: "replay"; key: string }
  | { kind: "draw"; command: string; args?: unknown };

type KeyInit = Pick<KeyboardEventInit, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;
type Pending = { key: string; original: KeyInit; fallback?: boolean; action?: Action; timer: ReturnType<typeof setTimeout> };

const PREFIX = "not3/draw/keys/1/";
const TOOLS = new Set([
  "selection", "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw",
  "text", "image", "eraser", "hand", "laser", "frame",
]);

const KEY_CODES: Record<string, string> = {
  escape: "Escape", enter: "Enter", tab: "Tab", space: "Space", backspace: "Backspace",
  delete: "Delete", insert: "Insert", home: "Home", end: "End", pageup: "PageUp",
  pagedown: "PageDown", arrowup: "ArrowUp", arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft", arrowright: "ArrowRight", up: "ArrowUp", down: "ArrowDown",
  left: "ArrowLeft", right: "ArrowRight", ";": "Semicolon", "=": "Equal",
  ",": "Comma", "-": "Minus", ".": "Period", "/": "Slash", "`": "Backquote",
  "[": "BracketLeft", "\\": "Backslash", "]": "BracketRight", "'": "Quote",
};

const CODE_KEYS: Record<string, string> = Object.fromEntries(
  Object.entries(KEY_CODES).map(([key, code]) => [code, key]),
);
const SHIFTED_KEYS: Record<string, string> = {
  "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&",
  "8": "*", "9": "(", "0": ")", "-": "_", "=": "+", "[": "{", "]": "}",
  "\\": "|", ";": ":", "'": "\"", ",": "<", ".": ">", "/": "?", "`": "~",
};

const isMac = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export function isKeyEnable(event: MessageEvent): boolean {
  if (event.source !== window.parent || !event.data || typeof event.data !== "object" ||
      event.data.type !== `${PREFIX}enable`) return false;
  const payload = event.data.payload;
  return payload === undefined || (payload !== null && typeof payload === "object" &&
    !Array.isArray(payload) && Object.keys(payload).length === 0);
}

function keyFromEvent(event: KeyboardEvent): string | null {
  const key = event.key.toLowerCase();
  if (["control", "shift", "alt", "meta", "os", "altgraph"].includes(key)) return null;
  let name = CODE_KEYS[event.code] ?? key;
  if (event.code?.startsWith("Key")) name = event.code.slice(3).toLowerCase();
  else if (event.code?.startsWith("Digit")) name = event.code.slice(5);
  else if (/^Numpad[0-9]$/.test(event.code)) name = event.code.toLowerCase();
  else if (key === " ") name = "space";
  else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) name = key;
  const modifiers = [];
  if (isMac()) {
    if (event.metaKey) modifiers.push("ctrl");
    if (event.ctrlKey) modifiers.push("winctrl");
  } else {
    if (event.ctrlKey) modifiers.push("ctrl");
    if (event.metaKey) modifiers.push("winctrl");
  }
  if (event.shiftKey) modifiers.push("shift");
  if (event.altKey) modifiers.push("alt");
  return [...modifiers, name].join("+");
}

function editable(target: EventTarget | null): boolean {
  let node = target instanceof Node ? target : null;
  while (node) {
    if (node instanceof Element && (
      node.matches("input, textarea") || node.hasAttribute("contenteditable") && node.getAttribute("contenteditable") !== "false"
    )) return true;
    node = node.parentNode;
  }
  return false;
}

function parseStroke(stroke: string) {
  const parts = stroke.toLowerCase().split("+");
  if (parts.some((part) => !part)) return null;
  const name = parts.pop()!;
  const modifiers = new Set(parts);
  if (modifiers.size !== parts.length || parts.some((part) => !["ctrl", "cmd", "meta", "winctrl", "shift", "alt"].includes(part))) return null;
  if (!/^[a-z0-9]$/.test(name) && !/^f([1-9]|1[0-9]|2[0-4])$/.test(name) &&
      !/^numpad[0-9]$/.test(name) && !(name in KEY_CODES)) return null;
  const primary = modifiers.has("ctrl") || modifiers.has("cmd") || modifiers.has("meta");
  const code = KEY_CODES[name] ?? (/^[a-z]$/.test(name) ? `Key${name.toUpperCase()}` :
    /^[0-9]$/.test(name) ? `Digit${name}` : /^numpad[0-9]$/.test(name) ? `Numpad${name.slice(-1)}` : name.toUpperCase());
  const key = name === "space" ? " " : name.startsWith("arrow") ? code :
    ["up", "down", "left", "right"].includes(name) ? code :
    /^numpad[0-9]$/.test(name) ? name.slice(-1) :
    /^f([1-9]|1[0-9]|2[0-4])$/.test(name) ? code :
    /^[a-z]$/.test(name) && modifiers.has("shift") ? name.toUpperCase() :
    modifiers.has("shift") && name in SHIFTED_KEYS ? SHIFTED_KEYS[name] :
    name.length === 1 || name.startsWith("f") ? name : code;
  return {
    key, code,
    ctrlKey: isMac() ? modifiers.has("winctrl") : primary,
    metaKey: isMac() ? primary : modifiers.has("winctrl"),
    shiftKey: modifiers.has("shift"), altKey: modifiers.has("alt"),
  };
}

function validAction(value: unknown): value is Action {
  if (!value || typeof value !== "object") return false;
  const action = value as Record<string, unknown>;
  if (action.kind === "none") return true;
  if (action.kind === "draw") return typeof action.command === "string";
  if (action.kind === "replay") return typeof action.key === "string" &&
    action.key.split(" ").length <= 2 && action.key.split(" ").every((stroke) => parseStroke(stroke));
  return false;
}

function executeDraw(command: string, api: ExcalidrawImperativeAPI | null) {
  if (!api) return;
  if (command.startsWith("draw.tool.")) {
    const tool = command.slice("draw.tool.".length);
    if (TOOLS.has(tool)) api.setActiveTool({ type: tool } as Parameters<typeof api.setActiveTool>[0]);
    return;
  }
  if (command === "draw.scrollToContent") return void api.scrollToContent();
  if (!["draw.toggleGrid", "draw.toggleTheme", "draw.zoomIn", "draw.zoomOut", "draw.zoomReset"].includes(command)) return;
  const state = api.getAppState();
  if (command === "draw.toggleGrid") return void api.updateScene({ appState: { gridModeEnabled: !state.gridModeEnabled } });
  if (command === "draw.toggleTheme") return void api.updateScene({ appState: { theme: state.theme === "dark" ? "light" : "dark" } });
  if (["draw.zoomIn", "draw.zoomOut", "draw.zoomReset"].includes(command)) {
    const value = command === "draw.zoomReset" ? 1 : Math.max(0.1, Math.min(30,
      state.zoom.value * (command === "draw.zoomIn" ? 1.1 : 1 / 1.1),
    ));
    api.updateScene({ appState: { zoom: { value: value as typeof state.zoom.value } } });
  }
}

export function installDrawKeys(
  container: HTMLElement,
  getApi: () => ExcalidrawImperativeAPI | null,
  onLegacySave: () => void,
  initiallyEnabled = false,
) {
  let enabled = initiallyEnabled;
  let seq = 0;
  let next = 1;
  const pending = new Map<number, Pending>();

  function replay(key: string) {
    for (const stroke of key.split(" ")) {
      const init = parseStroke(stroke);
      if (!init) continue;
      replayStroke(init);
    }
  }

  function replayStroke(init: KeyInit) {
    container.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
    container.dispatchEvent(new KeyboardEvent("keyup", { ...init, bubbles: true, cancelable: true }));
  }

  function drain() {
    while (pending.get(next)?.action) {
      const press = pending.get(next)!;
      clearTimeout(press.timer);
      pending.delete(next++);
      const action = press.action!;
      if (action.kind === "replay") {
        if (press.fallback) replayStroke(press.original);
        else replay(action.key);
      }
      else if (action.kind === "draw") executeDraw(action.command, getApi());
    }
  }

  function capture(event: KeyboardEvent) {
    if (!event.isTrusted || event.isComposing || editable(event.target)) return;
    const key = keyFromEvent(event);
    if (!key) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const current = ++seq;
    const timer = setTimeout(() => {
      const press = pending.get(current);
      if (!press || press.action) return;
      press.fallback = true;
      press.action = { kind: "replay", key: press.key };
      drain();
    }, 150);
    pending.set(current, { key, timer, original: {
      key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
      shiftKey: event.shiftKey, altKey: event.altKey,
    } });
    window.parent.postMessage({ type: `${PREFIX}keydown`, payload: { seq: current, key, repeat: event.repeat } }, "*");
  }

  function legacy(event: KeyboardEvent) {
    if (!enabled && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onLegacySave();
    }
  }

  function message(event: MessageEvent) {
    if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
    if (event.data.type === `${PREFIX}enable`) {
      if (enabled || !isKeyEnable(event)) return;
      enabled = true;
      window.addEventListener("keydown", capture, true);
      return;
    }
    if (event.data.type !== `${PREFIX}reply` || !enabled) return;
    const payload = event.data.payload;
    if (!payload || !Number.isSafeInteger(payload.seq) || payload.seq < 1 || !validAction(payload.action)) return;
    const press = pending.get(payload.seq);
    if (!press || press.action) return;
    press.action = payload.action;
    drain();
  }

  window.addEventListener("keydown", legacy);
  window.addEventListener("message", message);
  if (enabled) window.addEventListener("keydown", capture, true);
  return () => {
    window.removeEventListener("keydown", legacy);
    window.removeEventListener("keydown", capture, true);
    window.removeEventListener("message", message);
    for (const press of pending.values()) clearTimeout(press.timer);
    pending.clear();
  };
}
