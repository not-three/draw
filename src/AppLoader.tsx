import { useEffect, useState } from "react";
import LoadingSpinner from "./LoadingSpinner";
import ErrorComponent from "./ErrorComponent";
import App from "./App";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";

export default function AppLoader() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [initData, setInitData] = useState<{
    content: ExcalidrawElement[],
    readonly: boolean,
  }>({content: [], readonly: false});

  useEffect(() => {
    let contacted = false;
    const timer = setTimeout(() => {
      if (!contacted) setStatus("error");
    }, 5000);

    function handleContact(event: MessageEvent) {
      if (typeof event.data !== "object") return;
      if (event.data.type !== "not3/draw/init") return;
      contacted = true;
      setStatus("ready");
      if (event.data.payload && Array.isArray(event.data.payload.content)) setInitData({
        content: event.data.payload.content,
        readonly: event.data.payload.readonly,
      });
    }

    window.addEventListener("message", handleContact);
    window.parent.postMessage({ type: "not3/draw/load" }, "*");

    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", handleContact);
    };
  }, []);

  if (status === "loading") return <LoadingSpinner />;
  if (status === "error") return <ErrorComponent />;
  return <App initialElements={initData.content} isReadonly={initData.readonly} />;
}
