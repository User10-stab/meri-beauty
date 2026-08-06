"use client";

import { useEffect } from "react";

// Catches crashes in the root layout itself, which app/error.js cannot —
// it must render its own <html>/<body> since it replaces the whole root
// layout when triggered. Kept deliberately plain (no shared fonts/styles
// import) since a crash here means even those may not be safe to rely on.
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error("[root layout error boundary]", error);
  }, [error]);

  return (
    <html lang="fr">
      <body>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            width: "100%",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
            backgroundColor: "#faf7f1",
            color: "#232a21",
          }}
        >
          <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "12px" }}>
            Quelque chose s&apos;est mal passé
          </h1>
          <p style={{ maxWidth: 420, color: "rgba(35,42,33,0.6)", marginBottom: "24px" }}>
            Nous n&apos;avons pas pu afficher cette page. Vous pouvez réessayer.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              borderRadius: 9999,
              backgroundColor: "#b89664",
              color: "#fff",
              fontWeight: 600,
              padding: "14px 32px",
              border: "none",
              cursor: "pointer",
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
