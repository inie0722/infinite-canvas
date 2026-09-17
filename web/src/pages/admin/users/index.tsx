import { useState } from "react";
import { App, Button, Form, Input, Modal, Space, Table, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { getSessionUser } from "@/lib/session-context";
import { api } from "@/services/api/client";

type User = { id: string; name: string; email: string; role: string; banned: boolean };
export default function UsersPage() {
    const allowed = getSessionUser()?.role === "admin";
    const { message, modal } = App.useApp();
    const [editing, setEditing] = useState<User | "new" | null>(null);
    const [page, setPage] = useState(1);
    const query = useQuery({ queryKey: ["users", page], enabled: allowed, queryFn: () => api<{ users: User[]; total: number }>(`/auth/admin/list-users?limit=10&offset=${(page - 1) * 10}`) });
    const mutate = async (path: string, values: unknown) => {
        try { await api(`/auth/admin/${path}`, "POST", values); await query.refetch(); message.success("操作成功"); setEditing(null); }
        catch (error) { message.error((error as Error).message); }
    };
    if (!allowed) return <Navigate to="/" replace />;
    return <main className="mx-auto w-full max-w-5xl overflow-auto px-6 py-10">
        <header className="mb-8 flex items-center justify-between"><div><h1 className="text-2xl font-semibold">用户管理</h1><p className="mt-2 opacity-60">管理账号访问权限，用户作品保持私有。</p></div><Button type="primary" onClick={() => setEditing("new")}>创建用户</Button></header>
        {query.error ? <Button onClick={() => void query.refetch()}>加载失败，点击重试</Button> : null}
        <Table rowKey="id" loading={query.isLoading} dataSource={query.data?.users} pagination={{ current: page, pageSize: 10, total: query.data?.total, onChange: setPage }} columns={[
            { title: "名称", dataIndex: "name" }, { title: "邮箱", dataIndex: "email" },
            { title: "状态", render: (_, user: User) => <Tag>{user.banned ? "已停用" : user.role === "admin" ? "管理员" : "正常"}</Tag> },
            { title: "操作", render: (_, user: User) => user.role === "admin" ? null : <Space><Button type="text" onClick={() => setEditing(user)}>重置密码</Button><Button type="text" danger={!user.banned} onClick={() => modal.confirm({ title: user.banned ? "恢复此账号？" : "停用此账号并撤销登录？", onOk: () => mutate(user.banned ? "unban-user" : "ban-user", { userId: user.id }) })}>{user.banned ? "恢复" : "停用"}</Button></Space> },
        ]} />
        <Modal open={!!editing} title={editing === "new" ? "创建用户" : "重置密码"} footer={null} onCancel={() => setEditing(null)} destroyOnHidden>
            <Form layout="vertical" onFinish={(values) => editing === "new" ? mutate("create-user", { ...values, role: "user" }) : mutate("set-user-password", { userId: (editing as User).id, newPassword: values.password })}>
                {editing === "new" ? <><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email" }]}><Input /></Form.Item></> : null}
                <Form.Item name="password" label="密码" rules={[{ required: true, min: 8, max: 128 }]}><Input.Password autoComplete="new-password" /></Form.Item>
                <Button type="primary" htmlType="submit">确认</Button>
            </Form>
        </Modal>
    </main>;
}
