// Route-test helper: real end-to-end magic-link signup against the Hono
// app, capturing the link from the dev outbox. Returns the session
// cookie to use in authenticated requests.

import type { Hono } from "hono";
import { devOutbox } from "./email";

export interface SignedUp {
  cookie: string;
}

export async function signUpViaMagicLink(
  app: Hono,
  email: string,
  ip: string,
): Promise<SignedUp> {
  const res = await app.request("/api/auth/sign-in/magic-link", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, callbackURL: "/" }),
  });
  if (res.status !== 200) {
    throw new Error(`magic-link request failed: ${res.status} ${await res.text()}`);
  }

  const sent = devOutbox.findLast((e) => e.to === email);
  const url = sent?.text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error(`no magic link captured for ${email}`);

  const verify = await app.request(url, { headers: { "x-forwarded-for": ip } });
  if (verify.status !== 302) {
    throw new Error(`magic-link verify failed: ${verify.status} ${await verify.text()}`);
  }
  const cookie = verify.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");
  if (!cookie) throw new Error("verify set no session cookie");
  return { cookie };
}
