export type SessionUser = { id: string; email: string; name: string; role?: string | null };
let currentUser: SessionUser | null = null;
export let maxFileBytes = 100 * 1024 * 1024;
export const getSessionUser = () => currentUser;
export function setSessionUser(user: SessionUser | null) { currentUser = user; }
export function setFileLimit(value: number) { maxFileBytes = value; }
export function requireUserId() {
    if (!currentUser) throw new Error("请先登录");
    return currentUser.id;
}
export const accountDatabaseName = () => `infinite-canvas:user:${requireUserId()}`;
export const scopedKey = (key: string) => `${accountDatabaseName()}:${key}`;
export const accountStorage = {
    getItem: (key: string) => localStorage.getItem(scopedKey(key)),
    setItem: (key: string, value: string) => localStorage.setItem(scopedKey(key), value),
    removeItem: (key: string) => localStorage.removeItem(scopedKey(key)),
};

let importedCredentials: { baseUrl: string | null; apiKey: string | null } | null = null;
export function captureCredentials() {
    const url = new URL(window.location.href);
    const baseUrl = url.searchParams.get("baseUrl") || url.searchParams.get("baseurl");
    const apiKey = url.searchParams.get("apiKey") || url.searchParams.get("apikey");
    if (!baseUrl && !apiKey) return;
    importedCredentials = { baseUrl, apiKey };
    for (const key of ["baseUrl", "baseurl", "apiKey", "apikey"]) url.searchParams.delete(key);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
export function takeCredentials() { const value = importedCredentials; importedCredentials = null; return value; }
