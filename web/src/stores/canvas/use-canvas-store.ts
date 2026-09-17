import { create } from "zustand";
import { nanoid } from "nanoid";
import i18n from "@/i18n";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { api } from "@/services/api/client";
import { listDrafts, persistentData, saveEntity, writeDraft } from "@/services/api/cloud-data";

export type CanvasProject = {
    id: string;
    revision?: number;
    loaded?: boolean;
    nodeCount?: number;
    connectionCount?: number;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasDeletedProject = {
    id: string;
    deletedAt: string;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    loadProjects: () => Promise<void>;
    createProject: (title?: string) => Promise<string>;
    importProject: (source: Partial<CanvasProject>) => Promise<string>;
    openProject: (id: string) => Promise<CanvasProject | null>;
    renameProject: (id: string, title: string) => Promise<void>;
    deleteProjects: (ids: string[]) => Promise<void>;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const queues = new Map<string, Promise<void>>();
const failed = new Map<string, string>();
const baseline = new Map<string, string>();
const empty = { nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines" as const, showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } };
function snapshot(project: CanvasProject) {
    const { revision, updatedAt, loaded, nodeCount, connectionCount, ...data } = project;
    return JSON.stringify(persistentData(data));
}
async function flush(id: string) {
    const prior = queues.get(id) || Promise.resolve();
    const task = prior.then(async () => {
        const project = useCanvasStore.getState().projects.find((item) => item.id === id);
        if (!project?.loaded) return;
        if (failed.has(id)) return;
        const before = snapshot(project);
        if (baseline.get(id) === before) return;
        try {
            const saved = await saveEntity("projects", project);
            baseline.set(id, before);
            useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => item.id === id ? { ...item, revision: saved.revision } : item) }));
        } catch (error) { failed.set(id, (error as Error).message); }
    });
    queues.set(id, task);
    await task;
    if (queues.get(id) === task) queues.delete(id);
}
export const useCanvasStore = create<CanvasStore>((set, get) => ({
    hydrated: false, projects: [], deletedProjects: [],
    loadProjects: async () => {
        const projects = await api<CanvasProject[]>("/projects");
        set({ projects: projects.map((project) => ({ ...empty, ...project, loaded: false })), hydrated: true });
    },
    createProject: async (title = i18n.t("canvas.project.untitled")) => get().importProject({ title }),
    importProject: async (source) => {
        const now = new Date().toISOString();
        const project: CanvasProject = { ...empty, ...source, id: nanoid(), revision: undefined, title: source.title || i18n.t("canvas.project.imported"), createdAt: now, updatedAt: now };
        const saved = await saveEntity("projects", project);
        baseline.set(saved.id, snapshot(saved));
        set((state) => ({ projects: [{ ...saved, loaded: true }, ...state.projects] }));
        return saved.id;
    },
    openProject: async (id) => {
        const cached = get().projects.find((project) => project.id === id);
        if (cached?.loaded && (failed.has(id) || snapshot(cached) !== baseline.get(id))) return cached;
        const remote = await api<CanvasProject>(`/projects/${encodeURIComponent(id)}`);
        const draft = (await listDrafts()).find((item) => item.resource === "projects" && item.value.id === id && !item.deleting);
        baseline.set(id, snapshot(remote));
        const project = { ...(draft?.value as CanvasProject | undefined || remote), loaded: true };
        if (draft) failed.set(id, draft.error || "有未保存的本地草稿，请手动重试");
        set((state) => ({ projects: state.projects.map((item) => item.id === id ? project : item) }));
        return project;
    },
    renameProject: async (id, title) => {
        clearTimeout(timers.get(id));
        await get().openProject(id);
        await flush(id);
        if (failed.has(id)) throw new Error("请先处理未保存的画布草稿");
        const project = get().projects.find((item) => item.id === id);
        if (!project) return;
        const saved = await saveEntity("projects", { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() });
        baseline.set(id, snapshot(saved));
        set((state) => ({ projects: state.projects.map((item) => item.id === id ? { ...saved, loaded: true } : item) }));
    },
    deleteProjects: async (ids) => {
        for (const id of ids) {
            clearTimeout(timers.get(id));
            await queues.get(id);
            const project = get().projects.find((item) => item.id === id);
            if (project) await saveEntity("projects", project, true);
            set((state) => ({ projects: state.projects.filter((item) => item.id !== id) }));
        }
    },
    replaceProjects: (projects, deletedProjects = []) => set({ projects, deletedProjects }),
    updateProject: (id, patch) => {
        set((state) => ({ projects: state.projects.map((project) => project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project) }));
        const project = get().projects.find((item) => item.id === id);
        if (!project || snapshot(project) === baseline.get(id)) return;
        void writeDraft("projects", project, false, failed.get(id)).catch((error) => failed.set(id, (error as Error).message));
        clearTimeout(timers.get(id));
        timers.set(id, setTimeout(() => { timers.delete(id); void flush(id); }, 400));
    },
}));
