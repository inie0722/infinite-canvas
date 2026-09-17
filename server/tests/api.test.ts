import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

Object.assign(process.env, {
    DATABASE_URL: "postgresql://unused:unused@localhost/unused", APP_ORIGIN: "http://localhost:3000",
    AUTH_SECRET: "isolated-test-secret-not-for-production-000000000000",
    S3_ENDPOINT: "http://storage.invalid", S3_REGION: "us-east-1", S3_BUCKET: "test",
    S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test", S3_FORCE_PATH_STYLE: "true",
});
const { createAuth } = await import("../src/auth.js");
const { createApp } = await import("../src/app.js");
const { pool } = await import("../src/db.js");
const schema = await import("../src/schema.js");
const { storage: realStorage } = await import("../src/storage.js");
const postgres = new PGlite();
const database = drizzle(postgres, { schema });
const auth = createAuth(database as unknown as Parameters<typeof createAuth>[0]);
const objects = new Map<string, { bytes: number; mimeType: string; etag: string }>();
let copies = 0;
let copyFails = false;
const storage = {
    upload: async (key: string) => `https://objects.invalid/${key}`,
    read: async (key: string) => `https://objects.invalid/${key}`,
    head: async (key: string) => {
        const value = objects.get(key);
        if (!value) throw new Error("NoSuchKey");
        return { ContentLength: value.bytes, ContentType: value.mimeType, ETag: value.etag };
    },
    copy: async (from: string, to: string, etag: string) => {
        if (copyFails || objects.get(from)?.etag !== etag) throw new Error("CopyFailed");
        copies++;
        objects.set(to, { ...objects.get(from)! });
        return {};
    },
    remove: async (key: string) => { objects.delete(key); return {}; },
} as unknown as typeof realStorage;
const app = createApp(database as unknown as Parameters<typeof createApp>[0], auth, storage);
type Identity = { id: string; cookie: string; email: string; ip: string };
let ipCounter = 1;
async function login(email: string, password = "test-password-123", ip = `192.0.2.${ipCounter++}`) {
    const response = await app.request("http://localhost:3000/api/auth/sign-in/email", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json", "X-Real-IP": ip }, body: JSON.stringify({ email, password }) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return { id: result.user.id, email, ip, cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") };
}
async function identity(role = "user") {
    const email = `${randomUUID()}@example.com`;
    await auth.api.createUser({ body: { email, password: "test-password-123", name: "Test", role } });
    return login(email);
}
async function request(who: Identity | null, path: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) {
    return app.request(`http://localhost:3000/api${path}`, { method, headers: { Origin: "http://localhost:3000", "Content-Type": "application/json", ...(who ? { Cookie: who.cookie, "X-Session-User": who.id, "X-Real-IP": who.ip } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const project = (id = randomUUID()) => ({ id, title: "项目", nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } });
async function uploaded(who: Identity, bytes = 3) {
    const id = `image:${randomUUID()}`;
    const response = await request(who, "/files", "POST", { id, prefix: "image", bytes, mimeType: "image/png" });
    assert.equal(response.status, 201);
    const signed = await response.json();
    objects.set(new URL(signed.url).pathname.slice(1), { bytes, mimeType: "image/png", etag: "original" });
    return { id, signed };
}

before(async () => { await postgres.exec(await readFile(new URL("../migrations/0000_cloud.sql", import.meta.url), "utf8")); });
after(async () => { await postgres.close(); await pool.end(); });

test("requires login, validates source and rejects stale account headers", async () => {
    const a = await identity();
    assert.equal((await request(null, "/projects")).status, 401);
    assert.equal((await request(a, "/projects", "POST", project(), { Origin: "https://evil.invalid" })).status, 403);
    assert.equal((await request(a, "/projects", "GET", undefined, { "X-Session-User": "old-account" })).status, 409);
    assert.equal((await request(null, "/auth/sign-up/email", "POST", {})).status, 404);
});

test("isolates projects, rejects stale revisions and keeps private data out of lists", async () => {
    const a = await identity(), b = await identity();
    const input = project();
    assert.equal((await request(a, "/projects", "POST", input)).status, 201);
    assert.equal((await request(b, `/projects/${input.id}`)).status, 404);
    assert.deepEqual(await (await request(b, "/projects")).json(), []);
    assert.equal((await request(b, `/projects/${input.id}`, "PUT", { ...input, revision: 1 })).status, 404);
    assert.equal((await request(a, `/projects/${input.id}`, "PUT", { ...input, title: "新版", revision: 1 })).status, 200);
    assert.equal((await request(a, `/projects/${input.id}`, "PUT", { ...input, revision: 1 })).status, 409);
    assert.equal((await request(a, `/projects/${input.id}`, "DELETE", { revision: 1 })).status, 409);
    assert.equal((await (await request(a, `/projects/${input.id}`)).json()).title, "新版");
});

test("only owners finalize and read files; completion is idempotent and immutable", async () => {
    const a = await identity(), b = await identity();
    const { id, signed } = await uploaded(a);
    assert.equal((await request(b, `/files/${id}/complete`, "POST", {})).status, 404);
    assert.equal((await request(a, `/files/${id}`)).status, 404);
    const before = copies;
    assert.equal((await request(a, `/files/${id}/complete`, "POST", {})).status, 200);
    objects.set(new URL(signed.url).pathname.slice(1), { bytes: 3, mimeType: "image/png", etag: "replacement" });
    assert.equal((await request(a, `/files/${id}/complete`, "POST", {})).status, 200);
    assert.equal(copies, before + 1);
    const read = await (await request(a, `/files/${id}`)).json();
    assert.equal(objects.get(new URL(read.url).pathname.slice(1))?.etag, "original");
    assert.equal((await request(b, `/files/${id}`)).status, 404);
    assert.equal((await request(b, `/files/${id}/content?user=${b.id}`)).status, 404);
});

test("rejects oversized, incomplete and foreign file references; deletion preserves other references", async () => {
    const a = await identity(), b = await identity();
    assert.equal((await request(a, "/files", "POST", { id: `image:${randomUUID()}`, prefix: "image", mimeType: "image/png", bytes: 104857601 })).status, 400);
    const { id } = await uploaded(a);
    const input = { ...project(), nodes: [{ metadata: { storageKey: id, content: "" } }] };
    assert.equal((await request(a, "/projects", "POST", input)).status, 400);
    await request(a, `/files/${id}/complete`, "POST", {});
    assert.equal((await request(b, "/projects", "POST", input)).status, 400);
    assert.equal((await request(a, "/projects", "POST", input)).status, 201);
    const asset = { id: randomUUID(), title: "素材", kind: "image", tags: [], data: { storageKey: id, dataUrl: "" } };
    assert.equal((await request(a, "/assets", "POST", asset)).status, 201);
    assert.equal((await request(a, `/assets/${asset.id}`, "DELETE", { revision: 1 })).status, 200);
    assert.equal((await request(a, `/files/${id}`)).status, 200);
    const refs = await postgres.query("select * from file_references where file_id = $1", [id]);
    assert.equal(refs.rows.length, 1);
});

test("upload validation and S3 failure never publish a ready file", async () => {
    const a = await identity();
    const bad = await uploaded(a);
    objects.get(new URL(bad.signed.url).pathname.slice(1))!.bytes++;
    assert.equal((await request(a, `/files/${bad.id}/complete`, "POST", {})).status, 400);
    assert.equal((await request(a, `/files/${bad.id}`)).status, 404);
    const good = await uploaded(a);
    copyFails = true;
    assert.equal((await request(a, `/files/${good.id}/complete`, "POST", {})).status, 503);
    copyFails = false;
    assert.equal((await request(a, `/files/${good.id}`)).status, 404);
    assert.equal((await request(a, `/files/${good.id}/complete`, "POST", {})).status, 200);
});

test("admin management is restricted and password reset/disable revoke existing sessions", async () => {
    const admin = await identity("admin"), a = await identity();
    assert.equal((await request(a, "/auth/admin/list-users")).status, 403);
    assert.equal((await request(admin, "/auth/admin/impersonate-user", "POST", { userId: a.id })).status, 404);
    assert.equal((await request(admin, "/auth/admin/ban-user", "POST", { userId: admin.id })).status, 403);
    assert.equal((await request(admin, "/auth/admin/set-user-password", "POST", { userId: a.id, newPassword: "replacement-password" })).status, 200);
    assert.equal((await request(a, "/assets")).status, 401);
    const fresh = await login(a.email, "replacement-password");
    assert.equal((await request(admin, "/auth/admin/ban-user", "POST", { userId: a.id })).status, 200);
    assert.equal((await request(fresh, "/assets")).status, 401);
    assert.equal((await request(admin, "/auth/admin/unban-user", "POST", { userId: a.id })).status, 200);
    assert.equal((await request(await login(a.email, "replacement-password"), "/assets")).status, 200);
});

test("limits login to five attempts per IP per minute", async () => {
    const headers = { Origin: "http://localhost:3000", "Content-Type": "application/json", "X-Real-IP": "198.51.100.17" };
    for (let attempt = 0; attempt < 5; attempt++) assert.equal((await app.request("http://localhost:3000/api/auth/sign-in/email", { method: "POST", headers, body: JSON.stringify({ email: "missing@example.com", password: "incorrect-password" }) })).status, 401);
    assert.equal((await app.request("http://localhost:3000/api/auth/sign-in/email", { method: "POST", headers, body: JSON.stringify({ email: "missing@example.com", password: "incorrect-password" }) })).status, 429);
});

test("does not accept temporary addresses or credentials as persistent project data", async () => {
    const a = await identity();
    assert.equal((await request(a, "/projects", "POST", { ...project(), nodes: [{ metadata: { content: "blob:temporary" } }] })).status, 400);
    assert.equal((await request(a, "/projects", "POST", { ...project(), apiKey: "secret" })).status, 400);
});

test("AWS SDK signs private uploads and reads with the agreed 15 minute lifetime", async () => {
    const put = new URL(await realStorage.upload("pending/test", "image/png", 3));
    const get = new URL(await realStorage.read("files/test"));
    assert.equal(put.searchParams.get("X-Amz-Expires"), "900");
    assert.equal(get.searchParams.get("X-Amz-Expires"), "900");
    assert.ok(put.searchParams.get("X-Amz-SignedHeaders")?.includes("content-length"));
});


test("stores image and video logs separately and enforces ownership and revisions", async () => {
    const a = await identity(), b = await identity();
    for (const kind of ["image", "video"]) {
        const input = { id: randomUUID(), kind, status: "success", createdAt: Date.now(), config: {} };
        assert.equal((await request(a, "/generation-logs", "POST", input)).status, 201);
        const rows = await (await request(a, `/generation-logs?kind=${kind}`)).json();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].kind, kind);
        assert.equal((await request(b, `/generation-logs/${input.id}`)).status, 404);
        assert.equal((await request(a, `/generation-logs/${input.id}`, "PUT", { ...input, revision: 1 })).status, 200);
        assert.equal((await request(a, `/generation-logs/${input.id}`, "DELETE", { revision: 1 })).status, 409);
        assert.equal((await request(a, `/generation-logs/${input.id}`, "DELETE", { revision: 2 })).status, 200);
    }
});

test("validates bare reference IDs and prevents reuse of files marked for deletion", async () => {
    const a = await identity(), b = await identity();
    const { id } = await uploaded(a);
    await request(a, `/files/${id}/complete`, "POST", {});
    assert.equal((await request(b, "/projects", "POST", { ...project(), nodes: [{ metadata: { references: [id] } }] })).status, 400);
    const own = { ...project(), nodes: [{ metadata: { references: [id] } }] };
    assert.equal((await request(a, "/projects", "POST", own)).status, 201);
    const references = await database.select().from(schema.fileReferences);
    assert.ok(references.some((ref) => ref.fileId === id && ref.entityId === own.id));
    const { eq } = await import("drizzle-orm");
    await database.update(schema.files).set({ status: "deleting" }).where(eq(schema.files.id, id));
    assert.equal((await request(a, `/files/${id}/complete`, "POST", {})).status, 409);
    assert.equal((await request(a, "/files", "POST", { id, prefix: "image", bytes: 3, mimeType: "image/png" })).status, 409);
    assert.equal((await request(a, `/files/${id}`)).status, 404);
});


test("admin-created accounts enforce password bounds and password changes revoke other sessions", async () => {
    const administrator = await identity("admin");
    const email = `${randomUUID()}@example.com`;
    for (const password of ["short", "x".repeat(129)]) {
        assert.ok((await request(administrator, "/auth/admin/create-user", "POST", { email, password, name: "New", role: "user" })).status >= 400);
    }
    assert.equal((await request(administrator, "/auth/admin/create-user", "POST", { email, password: "new-password-123", name: "New", role: "user" })).status, 200);
    const first = await login(email, "new-password-123");
    const second = await login(email, "new-password-123");
    const current = await (await request(first, "/auth/get-session")).json();
    const lifetime = new Date(current.session.expiresAt).getTime() - new Date(current.session.createdAt).getTime();
    assert.ok(Math.abs(lifetime - 7 * 24 * 60 * 60 * 1000) < 1000);
    assert.equal((await request(first, "/auth/change-password", "POST", { currentPassword: "new-password-123", newPassword: "changed-password-123", revokeOtherSessions: false })).status, 200);
    assert.equal((await request(second, "/projects")).status, 401);
});
