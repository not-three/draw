import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

function preferred(a: ExcalidrawElement, b: ExcalidrawElement): ExcalidrawElement {
  if (a.version !== b.version) return a.version > b.version ? a : b;
  if (a.versionNonce !== b.versionNonce) return a.versionNonce < b.versionNonce ? a : b;
  if (a.isDeleted !== b.isDeleted) return a.isDeleted ? a : b;
  // A version/nonce collision should still converge regardless of arrival order.
  return JSON.stringify(a) <= JSON.stringify(b) ? a : b;
}

export function reconcile(elements: readonly ExcalidrawElement[], incoming: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  const byId = new Map<string, ExcalidrawElement>();
  for (const element of [...elements, ...incoming]) {
    const current = byId.get(element.id);
    byId.set(element.id, current ? preferred(current, element) : element);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function diff(previous: readonly ExcalidrawElement[], next: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  const byId = new Map(previous.map((element) => [element.id, element]));
  return next.filter((element) => {
    const before = byId.get(element.id);
    return !before || before.version !== element.version || before.versionNonce !== element.versionNonce || before.isDeleted !== element.isDeleted;
  });
}
