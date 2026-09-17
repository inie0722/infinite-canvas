import { getSessionUser } from "@/lib/session-context";

export class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
const requests = new Set<AbortController>();
export function abortAccountRequests() { requests.forEach((request) => request.abort()); requests.clear(); }

export async function accountFetch(url: string, init: RequestInit = {}, userId = getSessionUser()?.id) {
    if (getSessionUser()?.id !== userId) throw new ApiError(409, "账号已改变");
    const controller = new AbortController();
    requests.add(controller);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (getSessionUser()?.id !== userId) throw new ApiError(409, "账号已改变");
        return response;
    } finally { requests.delete(controller); }
}
export async function api<T>(path: string, method = "GET", body?: unknown, userId = getSessionUser()?.id): Promise<T> {
        const response = await accountFetch(`/api${path}`, {
            method, credentials: "same-origin",
            headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(userId ? { "X-Session-User": userId } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        }, userId);
        const data = await response.json();
        if (getSessionUser()?.id !== userId) throw new ApiError(409, "账号已改变");
        if (!response.ok) {
            if (response.status === 401 && userId) window.dispatchEvent(new Event("session-expired"));
            throw new ApiError(response.status, response.status === 429 ? `登录请求过于频繁，请 ${response.headers.get("X-Retry-After") || "60"} 秒后重试` : data.message || "请求失败，请重试");
        }
        return data as T;
}
