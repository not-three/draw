// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AppLoader from "./AppLoader";

vi.mock("./App", () => ({ default: () => <div>drawing ready</div> }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("accepts init only from the parent window", () => {
  vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  render(<AppLoader />);
  const data = { type: "not3/draw/init", payload: { content: [], readonly: false } };
  act(() => window.dispatchEvent(new MessageEvent("message", { data, source: new MessageChannel().port1 })));
  expect(screen.queryByText("drawing ready")).toBeNull();
  act(() => window.dispatchEvent(new MessageEvent("message", { data, source: window.parent })));
  expect(screen.getByText("drawing ready")).toBeTruthy();
});
