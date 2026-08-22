// The only module that reads process.env (test harness excepted).
// Values are getters so importing this module is always safe;
// assertProductionEnv() runs at boot and crashes on missing required vars.

export const env = {
  get nodeEnv() {
    return process.env.NODE_ENV ?? "development";
  },
  get databaseUrl() {
    // postgres.js connects lazily, so the placeholder only fails if queried.
    return process.env.DATABASE_URL ?? "postgres://DATABASE_URL-not-set@localhost:5432/unset";
  },
  get authSecret() {
    return process.env.AUTH_SECRET;
  },
  get baseUrl() {
    return process.env.BASE_URL ?? "http://localhost:3000";
  },
  get port() {
    return Number(process.env.PORT ?? "3000");
  },
  get resendApiKey() {
    return process.env.RESEND_API_KEY;
  },
  get emailFrom() {
    return process.env.EMAIL_FROM;
  },
};

const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "BASE_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
] as const;

/** Called from boot: a missing secret is a crash, not a silent downgrade. */
export function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== "production") return;
  const missing = REQUIRED_IN_PRODUCTION.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`missing required environment variables: ${missing.join(", ")}`);
  }
}
