import { useEffect, useState } from "react";
import LoadingSpinner from "./LoadingSpinner";
import ErrorComponent from "./ErrorComponent";
import App from "./App";

export default function AppLoader() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let contacted = false;
    const timer = setTimeout(() => {
      if (!contacted) setStatus("error");
    }, 5000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function handleContact(event: MessageEvent<any>) {
      if (typeof event.data !== "object") return;
      if (event.data.type !== "not3/draw/init") return;
      contacted = true;
      setStatus("ready");
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
  return <App />;
}
