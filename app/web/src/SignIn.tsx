import { useState } from "react";
import { api } from "./api";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");

  return (
    <div className="center-card">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.requestMagicLink(email.trim());
            setState("sent");
          } catch {
            setState("error");
          }
        }}
      >
        <h1>
          <span className="wordmark">wit</span>
        </h1>
        <p className="hint">
          A magic link signs you in — and signs you up if you're new here.
        </p>
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="primary">send magic link</button>
        {state === "sent" && <p className="ok-line">Check your email for the link.</p>}
        {state === "error" && (
          <p className="error-line">Couldn't send the link — wait a minute and try again.</p>
        )}
      </form>
    </div>
  );
}
