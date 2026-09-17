import { and, eq } from "drizzle-orm";
import { db, pool } from "./db.js";
import { files, fileReferences, user } from "./schema.js";
import { storage } from "./storage.js";

const execute = process.argv.includes("--execute");
try {
    for (const owner of await db.select({ id: user.id }).from(user)) {
        for (const candidate of await db.select().from(files).where(eq(files.ownerId, owner.id))) {
            const removable = await db.transaction(async (tx) => {
                await tx.select().from(user).where(eq(user.id, owner.id)).for("update");
                const [file] = await tx.select().from(files).where(eq(files.id, candidate.id));
                if (!file || file.uploadExpiresAt.getTime() > Date.now()) return false;
                const [reference] = await tx.select().from(fileReferences).where(eq(fileReferences.fileId, file.id));
                if (reference) return false;
                console.log(`${execute ? "删除" : "待清理"} ${file.id} (${file.bytes} bytes)`);
                if (execute) await tx.update(files).set({ status: "deleting" }).where(eq(files.id, file.id));
                return true;
            });
            // Commit the tombstone first: an S3 failure must never revive a partly deleted file.
            if (removable && execute) {
                await storage.remove(candidate.stagingKey);
                await storage.remove(candidate.objectKey);
                await db.delete(files).where(and(eq(files.id, candidate.id), eq(files.status, "deleting")));
            } else if (execute && candidate.status === "ready" && candidate.uploadExpiresAt.getTime() <= Date.now()) {
                await storage.remove(candidate.stagingKey);
            }
        }
    }
    if (!execute) console.log("仅预览。确认无未保存草稿需要这些文件后，添加 --execute 执行。");
} finally { await pool.end(); }
