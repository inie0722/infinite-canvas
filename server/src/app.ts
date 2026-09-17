import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auth as defaultAuth } from "./auth.js";
import { config, FILE_LIMIT, SIGNED_URL_SECONDS } from "./config.js";
import { db as defaultDb } from "./db.js";
import { assets, fileReferences, files, imageGenerationLogs, videoGenerationLogs, projects, session, user } from "./schema.js";
import { assertOwner, assertPersistentData, collectFileIds } from "./policy.js";
import { storage as defaultStorage } from "./storage.js";

type Variables = { user: { id: string; role?: string | null } };
export function createApp(database = defaultDb, authentication = defaultAuth, objectStorage = defaultStorage) {
const db = database;
const auth = authentication;
const storage = objectStorage;
const app = new Hono<{ Variables: Variables }>();
app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ message: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ message: "请求数据格式不正确" }, 400);
    console.error("API request failed", error instanceof Error ? error.name : "UnknownError");
    return c.json({ message: "服务暂时不可用，内容未保存，请手动重试" }, 503);
});
app.get("/health", (c) => c.json({ ok: true }));
app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(c.req.method) && c.req.header("origin") !== config.origin) throw new HTTPException(403, { message: "请求来源不允许" });
    await next();
});

const authPaths = new Set(["/sign-in/email", "/get-session", "/sign-out", "/change-password"]);
const adminPaths = new Set(["/admin/create-user", "/admin/list-users", "/admin/ban-user", "/admin/unban-user", "/admin/set-user-password"]);
app.all("/api/auth/*", async (c) => {
    const path = c.req.path.slice("/api/auth".length);
    if (!authPaths.has(path) && !adminPaths.has(path)) throw new HTTPException(404);
    if (path !== "/sign-in/email" && path !== "/get-session") {
        const current = await auth.api.getSession({ headers: c.req.raw.headers });
        if (!current) throw new HTTPException(401, { message: "请先登录" });
        assertOwner(c.req.header("x-session-user"), current.user.id);
        if (adminPaths.has(path)) {
            if (current.user.role !== "admin") throw new HTTPException(403);
            if (c.req.method === "POST") {
                const body = await c.req.raw.clone().json();
                if (path === "/admin/create-user") z.string().min(8).max(128).parse(body.password);
                if (path === "/admin/set-user-password") z.string().min(8).max(128).parse(body.newPassword);
                if (path === "/admin/create-user" && (body.role && body.role !== "user" || body.data)) throw new HTTPException(403);
                if (body.userId) {
                    const [target] = await db.select().from(user).where(eq(user.id, body.userId));
                    if (!target || target.role === "admin") throw new HTTPException(403, { message: "此入口只能管理普通账号" });
                }
            }
        }
    }
    if (path === "/change-password" || path === "/sign-in/email") {
        const body = await c.req.raw.clone().json();
        if (path === "/change-password") body.revokeOtherSessions = true;
        else body.rememberMe = true;
        return auth.handler(new Request(c.req.raw.url, { method: "POST", headers: c.req.raw.headers, body: JSON.stringify(body) }));
    }
    const passwordResetBody = path === "/admin/set-user-password" ? await c.req.raw.clone().json() : null;
    const response = await auth.handler(c.req.raw);
    if (response.ok && path === "/admin/set-user-password") {
        await db.delete(session).where(eq(session.userId, passwordResetBody.userId));
    }
    return response;
});

app.use("/api/*", async (c, next) => {
    const current = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!current) throw new HTTPException(401, { message: "登录已失效，请重新登录" });
    assertOwner(c.req.header("x-session-user") || (c.req.path.endsWith("/content") ? c.req.query("user") : undefined), current.user.id);
    c.set("user", current.user);
    await next();
});
app.get("/api/settings", (c) => c.json({ maxFileBytes: FILE_LIMIT }));

const object = z.record(z.string(), z.unknown());
const projectData = z.object({ title: z.string(), nodes: z.array(object), connections: z.array(object), chatSessions: z.array(object), activeChatId: z.string().nullable(), backgroundMode: z.string(), showImageInfo: z.boolean(), viewport: z.object({ x: z.number(), y: z.number(), k: z.number() }) }).passthrough();
const assetData = z.object({ kind: z.enum(["text", "image", "video"]), title: z.string(), data: object, tags: z.array(z.string()) }).passthrough();
const logData = z.object({ kind: z.enum(["image", "video"]), status: z.enum(["pending", "success", "failed"]), createdAt: z.number(), config: object }).passthrough();
const resources = { projects: { tables: [projects], schema: projectData }, assets: { tables: [assets], schema: assetData }, "generation-logs": { tables: [imageGenerationLogs, videoGenerationLogs], schema: logData } };

for (const [name, { tables, schema }] of Object.entries(resources)) {
    type Table = typeof tables[number];
    const owned = (table: Table, id: string, ownerId: string) => and(eq(table.id, id), eq(table.ownerId, ownerId));
    const serialize = (row: typeof projects.$inferSelect): Record<string, unknown> & { id: string; revision: number } => ({ ...row.data, id: row.id, revision: row.revision });
    app.get(`/api/${name}`, async (c) => {
        const rows = (await Promise.all(tables.map((table) => db.select().from(table).where(eq(table.ownerId, c.get("user").id))))).flat();
        const result = rows.map(serialize).filter((row) => name !== "generation-logs" || !c.req.query("kind") || row.kind === c.req.query("kind"));
        return c.json(name === "projects" ? result.map(({ nodes, connections, chatSessions, ...summary }) => ({ ...summary, nodeCount: Array.isArray(nodes) ? nodes.length : 0, connectionCount: Array.isArray(connections) ? connections.length : 0 })) : result);
    });
    app.get(`/api/${name}/:id`, async (c) => {
        const rows = (await Promise.all(tables.map((table) => db.select().from(table).where(owned(table, c.req.param("id"), c.get("user").id))))).flat();
        const row = rows[0];
        if (!row) throw new HTTPException(404, { message: "记录不存在" });
        return c.json(serialize(row));
    });
    app.on(["POST", "PUT", "DELETE"], [`/api/${name}`, `/api/${name}/:id`], async (c) => {
        const ownerId = c.get("user").id;
        const body = await c.req.json();
        const creating = c.req.method === "POST";
        const removing = c.req.method === "DELETE";
        const id = creating ? z.string().min(1).parse(body.id) : c.req.param("id");
        if (!id || (creating && c.req.param("id"))) throw new HTTPException(400);
        const revision = creating ? 0 : z.number().int().positive().parse(body.revision);
        const data = removing ? null : schema.parse(body);
        if (data) {
            delete data.ownerId;
            delete data.revision;
            delete data.id;
            assertPersistentData(data);
        }
        return db.transaction(async (tx) => {
            // Serialize writes and maintenance per owner, including first insertion and reference changes.
            await tx.select({ id: user.id }).from(user).where(eq(user.id, ownerId)).for("update");
            let table = tables[0];
            let previous: typeof projects.$inferSelect | undefined;
            for (const candidate of tables) {
                const [found] = await tx.select().from(candidate).where(owned(candidate, id, ownerId));
                if (found) { table = candidate; previous = found; break; }
            }
            if (name === "generation-logs" && !removing) {
                if (previous && previous.data.kind !== data!.kind) throw new HTTPException(400, { message: "不能更改生成记录类型" });
                table = tables[data!.kind === "video" ? 1 : 0];
            }
            if (!creating && !previous) throw new HTTPException(404, { message: "记录不存在" });
            if (creating && previous || !creating && previous?.revision !== revision) throw new HTTPException(409, { message: "内容已在其他页面修改，请重新加载或另存副本" });
            const fileIds = [...collectFileIds(data)];
            if (fileIds.length) {
                const found = await tx.select().from(files).where(and(inArray(files.id, fileIds), eq(files.ownerId, ownerId), eq(files.status, "ready")));
                if (found.length !== fileIds.length) throw new HTTPException(400, { message: "文件未完成上传或不属于当前账号" });
            }
            const entityType = name === "generation-logs" ? `${name}:${previous?.data.kind || data!.kind}` : name;
            await tx.delete(fileReferences).where(and(eq(fileReferences.entityType, entityType), eq(fileReferences.entityId, id)));
            if (removing) {
                await tx.delete(table).where(owned(table, id, ownerId));
                return c.json({ ok: true });
            }
            const [saved] = creating
                ? await tx.insert(table).values({ id, ownerId, data: data! }).returning()
                : await tx.update(table).set({ data: data!, revision: revision + 1, updatedAt: new Date() }).where(owned(table, id, ownerId)).returning();
            if (fileIds.length) await tx.insert(fileReferences).values(fileIds.map((fileId) => ({ fileId, entityType, entityId: id })));
            return c.json(serialize(saved), creating ? 201 : 200);
        });
    });
}

app.post("/api/files", async (c) => {
    const input = z.object({ id: z.string().regex(/^(image|video|audio|file|video-reference|audio-reference):[a-zA-Z0-9_-]+$/), prefix: z.enum(["image", "video", "audio", "file", "video-reference", "audio-reference"]), mimeType: z.string().min(1), bytes: z.number().int().positive().max(FILE_LIMIT) }).parse(await c.req.json());
    if (!input.id.startsWith(`${input.prefix}:`)) throw new HTTPException(400);
    const ownerId = c.get("user").id;
    return db.transaction(async (tx) => {
        await tx.select({ id: user.id }).from(user).where(eq(user.id, ownerId)).for("update");
        const [previous] = await tx.select().from(files).where(eq(files.id, input.id));
        if (previous && (previous.ownerId !== ownerId || previous.bytes !== input.bytes || previous.mimeType !== input.mimeType)) throw new HTTPException(409, { message: "文件标识冲突" });
        if (previous?.status === "deleting") throw new HTTPException(409, { message: "文件正在清理，请重新导入" });
        if (previous?.status === "ready") return c.json({ storageKey: previous.id, ready: true });
        const key = `${ownerId}/${randomUUID()}`;
        const stagingKey = previous?.stagingKey || `pending/${key}`;
        const expiresAt = new Date(Date.now() + SIGNED_URL_SECONDS * 1000);
        const url = await storage.upload(stagingKey, input.mimeType, input.bytes);
        if (previous) await tx.update(files).set({ uploadExpiresAt: expiresAt }).where(eq(files.id, previous.id));
        else await tx.insert(files).values({ id: input.id, ownerId, bytes: input.bytes, mimeType: input.mimeType, objectKey: `files/${key}`, stagingKey, uploadExpiresAt: expiresAt });
        return c.json({ storageKey: input.id, url, expiresAt: expiresAt.toISOString() }, 201);
    });
});

app.post("/api/files/:id/complete", async (c) => db.transaction(async (tx) => {
    const ownerId = c.get("user").id;
    await tx.select({ id: user.id }).from(user).where(eq(user.id, ownerId)).for("update");
    const [file] = await tx.select().from(files).where(and(eq(files.id, c.req.param("id")), eq(files.ownerId, ownerId))).for("update");
    if (!file) throw new HTTPException(404);
    if (file.status === "deleting") throw new HTTPException(409);
    if (file.status !== "ready") {
        const head = await storage.head(file.stagingKey);
        if (head.ContentLength !== file.bytes || head.ContentLength > FILE_LIMIT || head.ContentType !== file.mimeType || !head.ETag) throw new HTTPException(400, { message: "上传文件校验失败，未保存" });
        await storage.copy(file.stagingKey, file.objectKey, head.ETag);
        await tx.update(files).set({ status: "ready", updatedAt: new Date() }).where(eq(files.id, file.id));
    }
    return c.json({ storageKey: file.id, bytes: file.bytes, mimeType: file.mimeType });
}));
app.get("/api/files/:id", async (c) => {
    const [file] = await db.select().from(files).where(and(eq(files.id, c.req.param("id")), eq(files.ownerId, c.get("user").id), eq(files.status, "ready")));
    if (!file) throw new HTTPException(404, { message: "文件不存在" });
    return c.json({ url: await storage.read(file.objectKey), expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString() });
});

app.get("/api/files/:id/content", async (c) => {
    const [file] = await db.select().from(files).where(and(eq(files.id, c.req.param("id")), eq(files.ownerId, c.get("user").id), eq(files.status, "ready")));
    if (!file) throw new HTTPException(404);
    return c.redirect(await storage.read(file.objectKey), 302);
});

return app;
}
export const app = createApp();
