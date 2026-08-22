import { describe, expect, it, beforeAll } from "bun:test";
import { ensureMigrated, fixtures } from "./lib/test-db";
import { app } from "./app";
import { db, schema } from "./lib/db";
import { eq } from "drizzle-orm";
import { signUpViaMagicLink } from "./lib/test-auth";

const f = fixtures("auth");

beforeAll(async () => {
  await ensureMigrated();
  await f.reset();
});

describe("magic-link signup", () => {
  // spec: docs/model/L1-model#signup-open
  it("creates an account and a session for an unknown email", async () => {
    const email = f.email("stranger");
    const { cookie } = await signUpViaMagicLink(app, email, "10.1.0.1");

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(user).toBeDefined();
    expect(user!.emailVerified).toBe(true);

    const res = await app.request("/api/auth/get-session", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const session = (await res.json()) as { user?: { email?: string } } | null;
    expect(session?.user?.email).toBe(email);
  });

  // spec: docs/model/L1-model#signup-open — rate-limited per IP
  it("rate-limits magic-link requests per IP", async () => {
    const ip = "10.1.0.99";
    const request = (n: number) =>
      app.request("/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ email: f.email(`burst${n}`), callbackURL: "/" }),
      });
    for (let n = 0; n < 3; n++) {
      expect((await request(n)).status).toBe(200);
    }
    expect((await request(3)).status).toBe(429);
  });
});
