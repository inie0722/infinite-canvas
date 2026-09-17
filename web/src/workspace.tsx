import { useAgentStore } from "@/stores/use-agent-store";
import { RouterProvider } from "react-router-dom";
import { AppProviders } from "@/components/layout/app-providers";
import { router } from "@/router";
import { useEffect, useState } from "react";
import { Button } from "antd";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";

function WorkspaceContent() {
    const [ready, setReady] = useState(false);
    const [error, setError] = useState("");
    const load = async () => {
        setError("");
        try { await Promise.all([useCanvasStore.getState().loadProjects(), useAssetStore.getState().loadAssets()]); setReady(true); }
        catch (reason) { setError((reason as Error).message); }
    };
    useEffect(() => {
        void load();
        const disconnect = () => useAgentStore.getState().disconnectAgent();
        window.addEventListener("session-clearing", disconnect);
        return () => { window.removeEventListener("session-clearing", disconnect); disconnect(); };
    }, []);
    return ready ? <RouterProvider router={router} /> : <div className="flex h-dvh flex-col items-center justify-center gap-4"><p>{error || "正在加载云端工作空间…"}</p>{error ? <Button onClick={() => void load()}>重试</Button> : null}</div>;
}

export default function Workspace() {
    return <AppProviders><WorkspaceContent /></AppProviders>;
}
