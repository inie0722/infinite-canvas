import { z } from "zod";
import { auth } from "./auth.js";
import { pool } from "./db.js";

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error("请通过 ADMIN_EMAIL、ADMIN_PASSWORD 环境变量提供管理员账号");
try {
    z.string().min(8).max(128).parse(password);
    await auth.api.createUser({ body: { email, password, name: process.env.ADMIN_NAME || "管理员", role: "admin" } });
    console.log("管理员已创建");
} finally { await pool.end(); }
