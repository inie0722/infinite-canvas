import { lazy, Suspense, useEffect, useState } from "react";
import { Alert, App, Button, ConfigProvider, Form, Input, Spin } from "antd";
import zhCN from "antd/es/locale/zh_CN";
import { api, abortAccountRequests } from "@/services/api/client";
import { getSessionUser, setFileLimit, setSessionUser, type SessionUser } from "@/lib/session-context";

const Workspace = lazy(() => import("@/workspace"));
const channel = new BroadcastChannel("infinite-canvas-session");
export function announceSessionChange() { channel.postMessage("changed"); }

export default function SessionRoot() {
    const [user, setUser] = useState<SessionUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const load = async () => {
        setLoading(true);
        setError("");
        try {
            const result = await api<{ user: SessionUser } | null>("/auth/get-session");
            setSessionUser(result?.user || null);
            if (result?.user) {
                const settings = await api<{ maxFileBytes: number }>("/settings");
                setFileLimit(settings.maxFileBytes);
            }
            setUser(result?.user || null);
        } catch (reason) { setError(reason instanceof Error ? reason.message : "无法连接服务"); }
        finally { setLoading(false); }
    };
    useEffect(() => {
        void load();
        const expire = () => { window.dispatchEvent(new Event("session-clearing")); abortAccountRequests(); setSessionUser(null); window.location.reload(); };
        const changed = async () => {
            try {
                const result = await api<{ user: SessionUser } | null>("/auth/get-session");
                if (result?.user.id !== getSessionUser()?.id) expire();
            } catch { /* An unreachable server is not a logout. */ }
        };
        channel.addEventListener("message", changed);
        window.addEventListener("session-expired", expire);
        window.addEventListener("focus", changed);
        return () => { channel.removeEventListener("message", changed); window.removeEventListener("session-expired", expire); window.removeEventListener("focus", changed); };
    }, []);
    if (loading) return <div className="flex h-dvh items-center justify-center"><Spin tip="正在确认登录状态" /></div>;
    if (user) return <Suspense fallback={<div className="p-8">正在加载工作空间…</div>}><Workspace /></Suspense>;
    return <ConfigProvider locale={zhCN}><App><main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
        <section className="w-full max-w-sm space-y-7">
            <div><img src="/logo.svg" alt="无限画布" className="mb-6 size-12" /><h1 className="text-3xl font-semibold">登录无限画布</h1><p className="mt-3 text-sm opacity-60">在你的私有空间中继续创作。账号由管理员提供。</p></div>
            {error ? <Alert type="error" title={error} action={<Button onClick={() => void load()}>重试连接</Button>} /> : null}
            <Form layout="vertical" onFinish={async (values) => {
                setError("");
                try { await api("/auth/sign-in/email", "POST", values); announceSessionChange(); await load(); }
                catch (reason) { setError(reason instanceof Error ? reason.message : "登录失败"); }
            }}>
                <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email", message: "请输入邮箱" }]}><Input autoComplete="username" size="large" /></Form.Item>
                <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}><Input.Password autoComplete="current-password" size="large" /></Form.Item>
                <Button type="primary" htmlType="submit" size="large" block>登录</Button>
            </Form>
        </section>
    </main></App></ConfigProvider>;
}
