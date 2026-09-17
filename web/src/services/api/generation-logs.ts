import { api } from "./client";
import { saveEntity } from "./cloud-data";

export function cloudLogStore(kind: "image" | "video") {
    const records = new Map<string, { id: string; revision?: number }>();
    return {
        async setItem<T extends { id: string; revision?: number }>(id: string, value: T) {
            const saved = await saveEntity("generation-logs", { ...value, id, kind, revision: value.revision ?? records.get(id)?.revision });
            records.set(id, saved);
            return saved;
        },
        async removeItem(id: string) {
            const value = records.get(id) || await api<{ id: string; revision: number }>(`/generation-logs/${encodeURIComponent(id)}`);
            await saveEntity("generation-logs", value, true);
            records.delete(id);
        },
        async iterate<T extends { id: string; revision?: number }, R>(callback: (value: T) => R) {
            const values = await api<T[]>(`/generation-logs?kind=${kind}`);
            for (const value of values) { records.set(value.id, value); callback(value); }
        },
    };
}
