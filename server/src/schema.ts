import { boolean, bigint, integer, jsonb, pgTable, primaryKey, text, timestamp, index } from "drizzle-orm/pg-core";

const timestamps = () => ({ createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow() });
export const user = pgTable("users", {
    id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false), image: text("image"),
    role: text("role").default("user"), banned: boolean("banned").default(false), banReason: text("ban_reason"), banExpires: timestamp("ban_expires"), ...timestamps(),
});
export const session = pgTable("sessions", {
    id: text("id").primaryKey(), token: text("token").notNull().unique(), userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(), ipAddress: text("ip_address"), userAgent: text("user_agent"), impersonatedBy: text("impersonated_by"), ...timestamps(),
});
export const account = pgTable("accounts", {
    id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(), userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"), accessTokenExpiresAt: timestamp("access_token_expires_at"), refreshTokenExpiresAt: timestamp("refresh_token_expires_at"), scope: text("scope"), password: text("password"), ...timestamps(),
});
export const verification = pgTable("verifications", { id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(), expiresAt: timestamp("expires_at").notNull(), ...timestamps() });
export const rateLimit = pgTable("rate_limits", { id: text("id").primaryKey(), key: text("key").unique().notNull(), count: integer("count").notNull(), lastRequest: bigint("last_request", { mode: "number" }).notNull() });

const entityColumns = () => ({
    id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => user.id),
    revision: integer("revision").notNull().default(1), data: jsonb("data").$type<Record<string, unknown>>().notNull(), ...timestamps(),
});
export const projects = pgTable("projects", entityColumns(), (t) => [index("projects_owner_idx").on(t.ownerId)]);
export const assets = pgTable("assets", entityColumns(), (t) => [index("assets_owner_idx").on(t.ownerId)]);
export const imageGenerationLogs = pgTable("image_generation_logs", entityColumns(), (t) => [index("image_logs_owner_idx").on(t.ownerId)]);
export const videoGenerationLogs = pgTable("video_generation_logs", entityColumns(), (t) => [index("video_logs_owner_idx").on(t.ownerId)]);
export const files = pgTable("files", {
    id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => user.id), objectKey: text("object_key").notNull().unique(),
    stagingKey: text("staging_key").notNull().unique(), status: text("status").notNull().default("pending"),
    mimeType: text("mime_type").notNull(), bytes: integer("bytes").notNull(), uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true }).notNull(), ...timestamps(),
}, (t) => [index("files_owner_idx").on(t.ownerId)]);
export const fileReferences = pgTable("file_references", {
    fileId: text("file_id").notNull().references(() => files.id), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(),
}, (t) => [primaryKey({ columns: [t.fileId, t.entityType, t.entityId] })]);
