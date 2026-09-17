import { useState } from "react";
import { App, Button, Dropdown, Form, Input, Modal } from "antd";
import { UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getSessionUser } from "@/lib/session-context";
import { api, abortAccountRequests } from "@/services/api/client";
import { announceSessionChange } from "@/components/session-root";
import { useAgentStore } from "@/stores/use-agent-store";

export function AccountActions() {
    const user = getSessionUser()!;
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    return <>
        <Dropdown menu={{ items: [{ key: "identity", label: user.email, disabled: true }, ...(user.role === "admin" ? [{ key: "users", label: "用户管理" }] : []), { key: "password", label: "修改密码" }, { key: "logout", label: "退出登录" }], onClick: async ({ key }) => {
            if (key === "users") navigate("/admin/users");
            if (key === "password") setOpen(true);
            if (key === "logout") {
                try {
                    await api("/auth/sign-out", "POST", {});
                    window.dispatchEvent(new Event("session-clearing"));
                    useAgentStore.getState().disconnectAgent();
                    abortAccountRequests();
                    announceSessionChange();
                    window.location.assign("/");
                } catch (error) { message.error((error as Error).message); }
            }
        } }}><Button type="text" aria-label="账号" icon={<UserRound size={16} />} /></Dropdown>
        <Modal open={open} title="修改密码" footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
            <Form layout="vertical" onFinish={async (values) => {
                try { await api("/auth/change-password", "POST", values); message.success("密码已修改，其他设备需要重新登录"); setOpen(false); }
                catch (error) { message.error((error as Error).message); }
            }}>
                <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
                <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 8, max: 128 }]}><Input.Password autoComplete="new-password" /></Form.Item>
                <Button type="primary" htmlType="submit">保存密码</Button>
            </Form>
        </Modal>
    </>;
}
