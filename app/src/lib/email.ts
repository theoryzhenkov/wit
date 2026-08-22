import { env } from "./env";

// Thin outbound-email interface over Resend (linker pattern). Without
// credentials (dev, tests) it prints and records instead of sending —
// devOutbox is the seam tests use to capture magic links.

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/** Last few emails "sent" while no credentials are configured. Bounded. */
export const devOutbox: Email[] = [];
const DEV_OUTBOX_MAX = 20;

export async function sendEmail(email: Email): Promise<void> {
  const apiKey = env.resendApiKey;
  const from = env.emailFrom;

  if (!apiKey || !from) {
    devOutbox.push(email);
    if (devOutbox.length > DEV_OUTBOX_MAX) devOutbox.shift();
    if (env.nodeEnv !== "test") {
      console.log(`[email] to=${email.to} subject=${JSON.stringify(email.subject)}\n${email.text}`);
    }
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: `wit <${from}>`, to: [email.to], subject: email.subject, text: email.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`resend: ${res.status} ${await res.text()}`);
  }
}
