import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./db.js";
try { await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname }); }
finally { await pool.end(); }
