import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db, schema } from "./db";
import { sendEmail } from "./email";
import { env } from "./env";

export const auth = betterAuth({
  baseURL: env.baseUrl,
  secret: env.authSecret,
  rateLimit: {
    // spec: docs/model/L1-model#signup-open — signup is rate-limited per
    // IP (better-auth keys rate limits by client IP). Also keeps the
    // magic-link endpoint from being an open email amplifier. Memory
    // storage is fine for a single container.
    enabled: true,
    customRules: {
      "/sign-in/magic-link": { window: 60, max: 3 },
    },
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for"],
    },
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  plugins: [
    magicLink({
      // Open signup: a magic link to an unknown address creates the
      // account on verification. spec: docs/model/L1-model#signup-open
      disableSignUp: false,
      // Single-use (better-auth guarantees), expires within 15 minutes.
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        await sendEmail({
          to: email,
          subject: "sign in to wit",
          text: `Follow this link to sign in:\n\n${url}\n\nIt works once and expires in 15 minutes.`,
        });
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
