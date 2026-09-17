import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";

const browser = new EventTarget();
const localValues = new Map<string, string>();
Object.assign(globalThis, { window: browser, self: globalThis, localStorage: { getItem: (key: string) => localValues.get(key) || null, setItem: (key: string, value: string) => localValues.set(key, value) } });
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Firefox/128" }, configurable: true });
const { setSessionUser, setFileLimit } = await import("../../web/src/lib/session-context.js");
const { saveEntity, listDrafts, writeDraft, persistentData, fileIds } = await import("../../web/src/services/api/cloud-data.js");
const { uploadCloudFile, pendingUploads, retryUploads } = await import("../../web/src/services/api/cloud-files.js");
const { importPackageFiles } = await import("../../web/src/services/import-files.js");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let userNumber = 0;
function account(id = `test-${userNumber++}`) { setSessionUser({ id, name: id, email: `${id}@example.com` }); return id; }

test("keeps local drafts isolated between accounts", async () => {
    const a = account();
    await writeDraft("projects", { id: "draft", title: "Private" });
    account();
    assert.deepEqual(await listDrafts(), []);
    account(a);
    assert.equal((await listDrafts())[0].value.title, "Private");
});

test("preserves a failed write as a draft without automatic retries", async () => {
    account();
    let calls = 0;
    globalThis.fetch = async () => { calls++; return json({ message: "offline" }, 503); };
    await assert.rejects(saveEntity("projects", { id: "offline", title: "Work" }), /offline/);
    assert.equal(calls, 1);
    assert.equal((await listDrafts())[0].value.title, "Work");
    assert.equal((await listDrafts())[0].error, "offline");
});

test("acknowledging an older save does not discard newer edits", async () => {
    account();
    let release!: (value: Response) => void;
    let reached!: () => void;
    const sending = new Promise<void>((resolve) => { reached = resolve; });
    globalThis.fetch = async () => { reached(); return new Promise<Response>((resolve) => { release = resolve; }); };
    const save = saveEntity("projects", { id: "editing", title: "First", revision: 1 });
    await sending;
    await writeDraft("projects", { id: "editing", title: "Second", revision: 1 });
    release(json({ id: "editing", title: "First", revision: 2 }));
    await save;
    const [draft] = await listDrafts();
    assert.equal(draft.value.title, "Second");
    assert.equal(draft.value.revision, 2);
});

test("a response arriving after account change cannot write into the new account", async () => {
    const a = account();
    let release!: (value: Response) => void;
    let reached!: () => void;
    const sending = new Promise<void>((resolve) => { reached = resolve; });
    globalThis.fetch = async () => { reached(); return new Promise<Response>((resolve) => { release = resolve; }); };
    const save = saveEntity("assets", { id: "private", title: "Private" });
    await sending;
    account();
    release(json({ id: "private", revision: 1 }));
    await assert.rejects(save, /账号已改变/);
    assert.deepEqual(await listDrafts(), []);
    account(a);
    assert.equal((await listDrafts())[0].value.title, "Private");
});

test("failed uploads preserve the original bytes and block entity publication until manual retry", async () => {
    account();
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("network failure"); };
    await uploadCloudFile("image:pending", new Blob(["original bytes"], { type: "image/png" }));
    assert.equal(calls, 1);
    assert.equal(await (await pendingUploads())[0].blob.text(), "original bytes");
    await assert.rejects(saveEntity("assets", { id: "a", data: { storageKey: "image:pending", dataUrl: "blob:local" } }), /素材尚未上传/);
    assert.equal(calls, 1);
    globalThis.fetch = async (url) => {
        calls++;
        if (String(url) === "/api/files") return json({ url: "https://storage.invalid/pending" });
        return json({ ok: true });
    };
    await retryUploads();
    assert.equal(calls, 4);
    assert.deepEqual(await pendingUploads(), []);
});

test("rejects files above the configured maximum before requesting an upload", async () => {
    account();
    setFileLimit(100 * 1024 * 1024);
    const blob = new Blob(["x"]);
    Object.defineProperty(blob, "size", { value: 100 * 1024 * 1024 + 1 });
    let called = false;
    globalThis.fetch = async () => { called = true; return json({}); };
    await assert.rejects(uploadCloudFile("image:oversized", blob), /100 MiB/);
    assert.equal(called, false);
    assert.deepEqual(await pendingUploads(), []);
});

test("serializes references rather than transient media URLs", () => {
    const result = persistentData({ nodes: [{ metadata: { storageKey: "image:one", content: "blob:runtime" } }], title: "Title", cover: { storageKey: "image:cover" }, coverUrl: "blob:cover" });
    assert.equal(result.nodes[0].metadata.content, "");
    assert.equal(result.nodes[0].metadata.storageKey, "image:one");
    assert.equal(result.coverUrl, "");
    assert.equal(result.title, "Title");
});

test("import packages cannot reference unbundled cloud files", async () => {
    account();
    await assert.rejects(importPackageFiles({ metadata: { storageKey: "image:someone-elses-file" } }, [], new Map()), /缺少引用的文件/);
});


test("renaming an unloaded project preserves its complete nodes and revision", async () => {
    account();
    const { useCanvasStore } = await import("../../web/src/stores/canvas/use-canvas-store.js");
    const project = { id: "rename-me", revision: 4, title: "Before", nodes: [{ id: "important", metadata: { content: "Keep this" } }], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } };
    let submitted: Record<string, unknown> | undefined;
    globalThis.fetch = async (url, init) => {
        if (init?.method === "PUT") {
            submitted = JSON.parse(String(init.body));
            return json({ ...submitted, revision: 5 });
        }
        if (String(url) === "/api/projects") return json([{ id: project.id, title: project.title, revision: 4, nodeCount: 1 }]);
        return json(project);
    };
    await useCanvasStore.getState().loadProjects();
    await useCanvasStore.getState().renameProject(project.id, "After");
    assert.equal(submitted?.title, "After");
    assert.equal(submitted?.revision, 4);
    assert.deepEqual(submitted?.nodes, project.nodes);
    assert.equal(useCanvasStore.getState().projects[0].revision, 5);
});


test("bare reference IDs participate in archive validation and file tracking", async () => {
    account();
    const data = { metadata: { references: ["image:someone-elses-file"] } };
    assert.deepEqual([...fileIds(data)], ["image:someone-elses-file"]);
    await assert.rejects(importPackageFiles(data, [], new Map()), /缺少引用的文件/);
});
