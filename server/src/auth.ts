import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { config } from "./config.js";
import { db } from "./db.js";
import * as schema from "./schema.js";

export function createAuth(database = db) { return betterAuth({
    baseURL: config.origin,
    secret: config.secret,
    database: drizzleAdapter(database, { provider: "pg", schema }),
    trustedOrigins: [config.origin],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8, maxPasswordLength: 128, revokeSessionsOnPasswordReset: true },
    session: { expiresIn: 7 * 24 * 60 * 60, disableSessionRefresh: true, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: config.origin.startsWith("https:"), ipAddress: { ipAddressHeaders: ["x-real-ip"] } },
    rateLimit: { enabled: true, storage: "database", customRules: { "/sign-in/email": { window: 60, max: 5 }, "/*": false } },
    plugins: [admin()],
}); }

export const auth = createAuth();
