import { nanoid } from "nanoid";
import { fileIds, persistentData } from "@/services/api/cloud-data";

type PackageFile = { storageKey: string; path: string; mimeType: string };
export async function importPackageFiles<T>(data: T, files: PackageFile[], zip: Map<string, Blob>): Promise<T> {
    const keys = fileIds(data);
    const remap = new Map<string, string>();
    // Validate the entire manifest before performing uploads. Never trust packaged cloud IDs.
    for (const key of keys) {
        const file = files.find((item) => item.storageKey === key);
        if (!file || !zip.has(file.path)) throw new Error("导入包缺少引用的文件，已停止导入");
        const prefix = key.split(":")[0];
        if (!["image", "video", "audio", "file", "video-reference", "audio-reference"].includes(prefix)) throw new Error("文件类型不受支持");
        remap.set(key, `${prefix}:${nanoid()}`);
    }
    const [{ setImageBlob }, { setMediaBlob }] = await Promise.all([import("@/services/image-storage"), import("@/services/file-storage")]);
    for (const [oldKey, newKey] of remap) {
        const file = files.find((item) => item.storageKey === oldKey)!;
        const blob = zip.get(file.path)!;
        const typed = blob.slice(0, blob.size, file.mimeType);
        await (newKey.startsWith("image:") ? setImageBlob(newKey, typed) : setMediaBlob(newKey, typed));
    }
    const replace = (value: unknown): unknown => {
        if (typeof value === "string" && remap.has(value)) return remap.get(value);
        if (Array.isArray(value)) return value.map(replace);
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "storageKey" ? remap.get(String(item))! : replace(item)]));
    };
    return replace(persistentData(data)) as T;
}
