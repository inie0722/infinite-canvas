import { create } from "zustand";
import { nanoid } from "nanoid";
import { ensureImagePreview, previewUrlFor, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { api } from "@/services/api/client";
import { saveEntity } from "@/services/api/cloud-data";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    revision?: number;
    cover?: { storageKey: string };
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    loadAssets: () => Promise<void>;
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => Promise<string>;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};
export function assetCoverUrl(asset: Asset) {
    const own = asset.kind === "image" ? asset.data.dataUrl : "";
    const cover = asset.coverUrl || own;
    return asset.kind === "image" && cover === own ? previewUrlFor(asset.data.storageKey) || cover : cover;
}
async function hydrateAsset(asset: Asset): Promise<Asset> {
    if (asset.cover?.storageKey) asset = { ...asset, coverUrl: await resolveImageUrl(asset.cover.storageKey) };
    if (asset.kind === "video") return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
    if (asset.kind !== "image") return asset;
    const url = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
    void ensureImagePreview(asset.data.storageKey);
    return { ...asset, coverUrl: asset.coverUrl || url, data: { ...asset.data, dataUrl: url } };
}
async function prepareCover(asset: Asset): Promise<Asset> {
    if (asset.coverUrl.startsWith("data:")) {
        const image = await uploadImage(asset.coverUrl);
        return { ...asset, cover: { storageKey: image.storageKey! }, coverUrl: "" };
    }
    return asset;
}
export const useAssetStore = create<AssetStore>((set, get) => ({
    hydrated: false, assets: [],
    loadAssets: async () => set({ assets: await Promise.all((await api<Asset[]>("/assets")).map(hydrateAsset)), hydrated: true }),
    addAsset: async (input) => {
        const now = new Date().toISOString();
        const asset = await prepareCover({ ...input, id: nanoid(), revision: undefined, createdAt: now, updatedAt: now } as Asset);
        const saved = await hydrateAsset(await saveEntity("assets", asset));
        set((state) => ({ assets: [saved, ...state.assets] }));
        return saved.id;
    },
    updateAsset: async (id, patch) => {
        const previous = get().assets.find((item) => item.id === id);
        if (!previous) return;
        const asset = await prepareCover({ ...previous, ...patch, ...(patch.coverUrl !== undefined && patch.coverUrl !== previous.coverUrl ? { cover: undefined } : {}), id, updatedAt: new Date().toISOString() } as Asset);
        const saved = await hydrateAsset(await saveEntity("assets", asset));
        set((state) => ({ assets: state.assets.map((item) => item.id === id ? saved : item) }));
    },
    removeAsset: async (id) => {
        const asset = get().assets.find((item) => item.id === id);
        if (asset) await saveEntity("assets", asset, true);
        set((state) => ({ assets: state.assets.filter((item) => item.id !== id) }));
    },
    replaceAssets: (assets) => set({ assets }),
    // Cloud references span devices. Physical cleanup is an explicit server maintenance command.
    cleanupImages: () => {},
}));
