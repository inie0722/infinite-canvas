import localforage from "localforage";
import { accountDatabaseName, maxFileBytes, requireUserId } from "@/lib/session-context";
import { accountFetch, api } from "./client";

export type PendingUpload = { id: string; blob: Blob; error?: string };
const uploads = () => localforage.createInstance({ name: accountDatabaseName(), storeName: "cloud_uploads" });
export const notifyCloud = () => window.dispatchEvent(new Event("cloud-changed"));

export async function pendingUploads() {
    const result: PendingUpload[] = [];
    await uploads().iterate<PendingUpload, void>((value) => { result.push(value); });
    return result;
}
export function assertFileSize(blob: Blob) {
    if (blob.size > maxFileBytes || !blob.size) throw new Error(`文件必须大于 0 且不超过 ${Math.floor(maxFileBytes / 1024 / 1024)} MiB`);
}
export async function uploadCloudFile(id: string, blob: Blob) {
    assertFileSize(blob);
    const owner = requireUserId();
    const store = uploads();
    await store.setItem(id, { id, blob });
    try {
        const signed = await api<{ url?: string; ready?: boolean }>("/files", "POST", { id, prefix: id.split(":")[0], bytes: blob.size, mimeType: blob.type || "application/octet-stream" }, owner);
        if (!signed.ready) {
            const response = await accountFetch(signed.url!, { method: "PUT", credentials: "omit", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob }, owner);
            if (!response.ok) throw new Error("S3 上传失败，请检查存储服务和 CORS 配置");
            await api(`/files/${encodeURIComponent(id)}/complete`, "POST", {}, owner);
        }
        await store.removeItem(id);
    } catch (error) {
        await store.setItem(id, { id, blob, error: error instanceof Error ? error.message : "上传失败" });
        // The local file remains usable; entity writes reject this reference until a manual retry succeeds.
    } finally { notifyCloud(); }
}
export async function retryUploads() {
    for (const upload of await pendingUploads()) await uploadCloudFile(upload.id, upload.blob);
}
export async function assertUploaded(ids: Iterable<string>) {
    const store = uploads();
    for (const id of ids) if (await store.getItem(id)) throw new Error("素材尚未上传到云端，请在云端保存状态中重试");
}
export async function downloadCloudFile(id: string) {
    const owner = requireUserId();
    const signed = await api<{ url: string }>(`/files/${encodeURIComponent(id)}`);
    const response = await accountFetch(signed.url, { credentials: "omit" }, owner);
    if (!response.ok) throw new Error("素材下载失败，请重试");
    return response.blob();
}

export function cloudFileUrl(id: string) { return new URL(`/api/files/${encodeURIComponent(id)}/content?user=${encodeURIComponent(requireUserId())}`, window.location.origin).href; }
