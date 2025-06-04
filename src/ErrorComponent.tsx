export default function ErrorComponent() {
  return (
    <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <h2>Unsupported Mode</h2>
      <p>
        This app isn't available in standalone mode. Please visit{" "}
        <a href="https://not-th.re">not-th.re</a> to access the full experience.
      </p>
    </div>
  );
}
