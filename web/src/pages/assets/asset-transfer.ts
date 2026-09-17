import { importPackageFiles } from "@/services/import-files";
import { fileIds } from "@/services/api/cloud-data";
import { saveAs } from "file-saver";

import { createZip, readZip } from "@/lib/zip";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import type { Asset } from "@/stores/use-asset-store";

type AssetExportFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    assets: Asset[];
    files: AssetExportItem[];
};

type AssetExportItem = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export async function exportAssets(assets: Asset[], filename: string) {
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];

    for (const storageKey of fileIds(assets)) {
        const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (!blob) throw new Error("导出文件缺失");
        const path = `files/${safeFileName(storageKey)}.bin`;
        files.push({ storageKey, path, mimeType: blob.type, bytes: blob.size });
        zipFiles.push({ name: path, data: blob });
    }

    const data: AssetExportFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), assets, files };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, filename);
}

export async function readAssetPackage(file: File) {
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("missing assets.json");
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    return importPackageFiles(data.assets, data.files, zip);
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}
