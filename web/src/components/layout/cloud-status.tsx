import { useEffect, useRef, useState } from "react";
import { App, Button, Drawer, Space } from "antd";
import { Cloud } from "lucide-react";
import { discardDraft, listDrafts, retryDraft, type CloudDraft } from "@/services/api/cloud-data";
import { pendingUploads, retryUploads, type PendingUpload } from "@/services/api/cloud-files";

export function CloudStatus() {
    const { message, modal } = App.useApp();
    const [drafts, setDrafts] = useState<CloudDraft[]>([]);
    const [uploads, setUploads] = useState<PendingUpload[]>([]);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const acknowledged = useRef(false);
    const [localError, setLocalError] = useState("");
    useEffect(() => {
        const clearing = () => { acknowledged.current = true; };
        window.addEventListener("session-clearing", clearing);
        const onError = (event: Event) => setLocalError((event as CustomEvent<string>).detail);
        window.addEventListener("cloud-error", onError);
        return () => { window.removeEventListener("cloud-error", onError); window.removeEventListener("session-clearing", clearing); };
    }, []);
    const refresh = async () => { setDrafts(await listDrafts()); setUploads(await pendingUploads()); };
    useEffect(() => {
        void refresh();
        window.addEventListener("cloud-changed", refresh);
        const leaving = (event: BeforeUnloadEvent) => { if (!acknowledged.current && (drafts.length || uploads.length)) { event.preventDefault(); event.returnValue = ""; } };
        window.addEventListener("beforeunload", leaving);
        return () => { window.removeEventListener("cloud-changed", refresh); window.removeEventListener("beforeunload", leaving); };
    }, [drafts.length, uploads.length]);
    const act = async (action: () => Promise<void>) => {
        setBusy(true);
        try { await action(); acknowledged.current = true; window.location.reload(); }
        catch (error) { message.error((error as Error).message); await refresh(); }
        finally { setBusy(false); }
    };
    const failed = !!localError || drafts.some((draft) => draft.error) || uploads.some((upload) => upload.error);
    return <>
        <Button type="text" size="small" icon={<Cloud size={14} />} onClick={() => setOpen(true)}>{failed ? "未保存 · 查看草稿" : drafts.length || uploads.length ? "正在保存…" : "已保存到云端"}</Button>
        <Drawer title="云端保存状态" open={open} onClose={() => setOpen(false)}>
            {localError ? <p role="alert">{localError}</p> : null}
            <p className="mb-5 opacity-60">失败内容仅保存在当前账号的这台设备。重试不会重新生成图片或视频；恢复成功后将重新加载页面。</p>
            {uploads.length ? <section className="mb-6 space-y-3"><h3 className="font-medium">待上传素材（{uploads.length}）</h3>{uploads.map((upload) => <div key={upload.id} className="break-all text-sm"><p>{upload.id}</p><p className="opacity-60">{upload.error || "正在上传"}</p><Button type="text" onClick={() => { const url = URL.createObjectURL(upload.blob); const link = document.createElement("a"); link.href = url; link.download = upload.id; link.click(); URL.revokeObjectURL(url); }}>下载本地文件</Button></div>)}<Button loading={busy} onClick={() => void act(async () => { await retryUploads(); if ((await pendingUploads()).length) throw new Error("仍有文件上传失败，请检查配置后重试"); for (const draft of await listDrafts()) await retryDraft(draft); })}>重试上传并保存草稿</Button></section> : null}
            {drafts.map((draft) => <section key={draft.key} className="mb-5 space-y-2 border-b border-current/10 pb-5">
                <h3 className="font-medium">{String(draft.value.title || draft.value.id)}{draft.deleting ? "（待删除）" : ""}</h3>
                <p className="text-sm opacity-60">{draft.error || "等待保存"}</p>
                <Space wrap><Button disabled={busy || uploads.length > 0} onClick={() => void act(() => retryDraft(draft))}>重试</Button>
                    {!draft.deleting ? <Button disabled={busy || uploads.length > 0} onClick={() => void act(() => retryDraft(draft, true))}>另存副本</Button> : null}
                    <Button disabled={busy} onClick={() => modal.confirm({ title: "丢弃这份本地草稿并加载云端内容？", onOk: () => act(() => discardDraft(draft.key)) })}>重新加载</Button></Space>
            </section>)}
            {!localError && !drafts.length && !uploads.length ? <p>全部内容已保存。</p> : null}
        </Drawer>
    </>;
}
