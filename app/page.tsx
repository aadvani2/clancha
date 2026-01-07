"use client";

import { useState } from "react";
import Header from "../components/Header";

export default function Home() {
  const [text, setText] = useState("");
  const [style, setStyle] = useState("Calm & Clear");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRewrite = async () => {
    if (!text.trim()) return;

    setLoading(true);
    setError("");
    setResult("");

    try {
      const res = await fetch("/api/rewrite-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text, style }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to rewrite message");
      }

      setResult(data.rewrittenText);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header />
      <main className="container">
        <div className="card">
          <div className="input-group">
            <label htmlFor="message">Your Draft</label>
            <textarea
              id="message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type your message here (e.g., 'Can you confirm what time the drop-off is tomorrow?')..."
            />
          </div>

          <div className="controls">
            <div className="style-select">
              <label htmlFor="style">Select Tone</label>
              <select
                id="style"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
              >
                <option value="Calm & Clear">Calm & Clear</option>
                <option value="Firm & Fair">Firm & Fair</option>
              </select>
            </div>

            <button
              className="button"
              onClick={handleRewrite}
              disabled={loading || !text.trim()}
            >
              {loading ? "Rewriting..." : "Rewrite Message"}
            </button>
          </div>

          {error && (
            <div className="error-box">
              <strong>Error:</strong> {error}
            </div>
          )}

          {result && (
            <div className="output-area">
              <label>Rewritten Message</label>
              <div className="result-box">
                {result}
              </div>
              <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--secondary)', textAlign: 'right' }}>
                Style: <strong>{style}</strong>
              </p>
            </div>
          )}
        </div>

        <footer>
          <p>Clancha Demo &copy; {new Date().getFullYear()}</p>
        </footer>
      </main>
    </>
  );
}
