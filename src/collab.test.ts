import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { diff, reconcile } from "./collab";

const element = (id: string, version: number, versionNonce: number, isDeleted = false) =>
  ({ id, version, versionNonce, isDeleted }) as ExcalidrawElement;

const indexedElement = (id: string, index: string, version = 1, versionNonce = 1) =>
  ({ id, index, version, versionNonce, isDeleted: false }) as ExcalidrawElement;

describe("reconcile", () => {
  it("keeps the higher version", () => {
    expect(reconcile([element("a", 3, 9)], [element("a", 2, 1)])).toEqual([element("a", 3, 9)]);
  });

  it("keeps the lower nonce when versions tie", () => {
    expect(reconcile([element("a", 2, 9)], [element("a", 2, 3)])).toEqual([element("a", 2, 3)]);
  });

  it("lets deletion win when version and nonce tie", () => {
    expect(reconcile([element("a", 2, 3)], [element("a", 2, 3, true)])).toEqual([element("a", 2, 3, true)]);
  });

  it("lets a lower nonce win over deletion when only the version ties", () => {
    expect(reconcile([element("a", 2, 3)], [element("a", 2, 9, true)])).toEqual([element("a", 2, 3)]);
  });

  it("converges regardless of arrival order", () => {
    const first = [indexedElement("a", "a0", 2, 5), indexedElement("b", "a1")];
    const second = [indexedElement("a", "a0", 2, 3), indexedElement("c", "a2")];
    expect(reconcile(first, second)).toEqual(reconcile(second, first));
  });

  it("preserves a newer local edit when remote input arrives", () => {
    expect(reconcile([element("a", 5, 4)], [element("a", 4, 1)])).toEqual([element("a", 5, 4)]);
  });

  it("preserves scene stacking order when element IDs sort differently", () => {
    const back = indexedElement("z", "a0");
    const front = indexedElement("a", "a1");
    const updatedFront = indexedElement("a", "a1", 2);
    expect(reconcile([back, front], [updatedFront])).toEqual([back, updatedFront]);
  });
});

describe("diff", () => {
  it("includes only added or changed versions and nonces", () => {
    const previous = [element("a", 1, 1), element("b", 1, 1)];
    const next = [element("a", 1, 1), element("b", 1, 2), element("c", 1, 1)];
    expect(diff(previous, next)).toEqual([next[1], next[2]]);
  });
});
