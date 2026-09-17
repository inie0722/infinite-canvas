import { HTTPException } from "hono/http-exception";

export function assertOwner(expected: string | undefined, actual: string) {
    if (expected !== actual) throw new HTTPException(409, { message: "账号已改变，请重新加载页面" });
}

export function collectFileIds(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string" && /^(image|video|audio|file|video-reference|audio-reference):[a-zA-Z0-9_-]+$/.test(value)) keys.add(value);
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey) keys.add(value.storageKey);
    for (const item of Object.values(value)) collectFileIds(item, keys);
    return keys;
}

// Runtime media addresses must never become persistent file references.
export function assertPersistentData(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
        if (["apiKey", "accessKeyId", "secretAccessKey"].includes(key)) throw new HTTPException(400, { message: "业务数据不得包含接口密钥" });
        if (typeof item === "string" && (item.startsWith("blob:") || /[?&]X-Amz-(Signature|Credential)=/i.test(item))) throw new HTTPException(400, { message: "请使用文件标识保存素材" });
        assertPersistentData(item);
    }
}
