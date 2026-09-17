import localforage from "localforage";
import { nanoid } from "nanoid";
import { accountDatabaseName, requireUserId } from "@/lib/session-context";
import { api } from "./client";
import { assertUploaded, notifyCloud } from "./cloud-files";

export type Resource = "projects" | "assets" | "generation-logs";
export type CloudEntity = { id: string; revision?: number; [key: string]: unknown };
export type CloudDraft = { key: string; resource: Resource; value: CloudEntity; deleting?: boolean; error?: string };
const drafts = () => localforage.createInstance({ name: accountDatabaseName(), storeName: "cloud_drafts" });

export function fileIds(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string" && /^(image|video|audio|file|video-reference|audio-reference):[a-zA-Z0-9_-]+$/.test(value)) keys.add(value);
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey) keys.add(value.storageKey);
    Object.values(value).forEach((item) => fileIds(item, keys));
    return keys;
}
export function persistentData<T>(value: T): T {
    if (Array.isArray(value)) return value.map(persistentData) as T;
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(source).map(([key, item]) => {
        if (["loaded", "nodeCount", "connectionCount"].includes(key)) return [key, undefined];
        if (source.cover && key === "coverUrl") return [key, ""];
        if (source.storageKey && ["url", "dataUrl", "content"].includes(key)) return [key, ""];
        if (key === "coverUrl" && typeof item === "string" && (item.startsWith("blob:") || item.startsWith("data:") || (source.data && typeof source.data === "object" && "storageKey" in source.data && (item === (source.data as { dataUrl?: string }).dataUrl || item.includes(`/files/${encodeURIComponent(String(source.data.storageKey))}/content`))))) return [key, ""];
        return [key, persistentData(item)];
    })) as T;
}
export async function listDrafts() {
    const result: CloudDraft[] = [];
    await drafts().iterate<CloudDraft, void>((value) => { result.push(value); });
    return result;
}
export async function writeDraft(resource: Resource, value: CloudEntity, deleting = false, error?: string) {
    const draft = { key: `${resource}:${value.id}`, resource, value: persistentData(value), deleting, error };
    try { await drafts().setItem(draft.key, draft); }
    catch (error) { window.dispatchEvent(new CustomEvent("cloud-error", { detail: "本地草稿保存失败，请立即导出备份后重试" })); throw error; }
    notifyCloud();
    return draft;
}
export async function saveEntity<T extends { id: string; revision?: number }>(resource: Resource, value: T, deleting = false): Promise<T> {
    const owner = requireUserId();
    const store = drafts();
    const draft = await writeDraft(resource, value as CloudEntity, deleting);
    try {
        if (!deleting) await assertUploaded(fileIds(value));
        const creating = !value.revision;
        const result = await api<T>(`/${resource}${creating ? "" : `/${encodeURIComponent(value.id)}`}`, deleting ? "DELETE" : creating ? "POST" : "PUT", draft.value, owner);
        const current = await store.getItem<CloudDraft>(draft.key);
        if (current && JSON.stringify(current.value) === JSON.stringify(draft.value)) await store.removeItem(draft.key);
        else if (current && !deleting) await store.setItem(draft.key, { ...current, value: { ...current.value, revision: result.revision } });
        notifyCloud();
        return result;
    } catch (error) {
        const current = await store.getItem<CloudDraft>(draft.key);
        await store.setItem(draft.key, { ...(current || draft), error: error instanceof Error ? error.message : "保存失败" });
        notifyCloud();
        throw error;
    }
}
export async function retryDraft(draft: CloudDraft, copy = false) {
    const value = copy ? { ...draft.value, id: nanoid(), revision: undefined, title: `${draft.value.title || "未命名"}（副本）` } : draft.value;
    await saveEntity(draft.resource, value, copy ? false : draft.deleting);
    if (copy) await discardDraft(draft.key);
}
export async function discardDraft(key: string) { await drafts().removeItem(key); notifyCloud(); }
