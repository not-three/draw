export default function LoadingSpinner() {
  return (
    <div style={{ height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="spinner" />
      <style>
      {`
            .spinner {
              margin: 0 auto 1rem auto;
              border: 8px solid #f3f3f3;
              border-top: 8px solid #3498db;
              border-radius: 50%;
              width: 48px;
              height: 48px;
              animation: spin 1s linear infinite;
            }
            @keyframes spin {
              0% { transform: rotate(0deg);}
              100% { transform: rotate(360deg);}
            }
          `}
        </style>
      </div>
    );
  }
  