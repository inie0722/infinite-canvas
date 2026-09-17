import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { pool } from "./db.js";

const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port: 3001 });
process.on("SIGTERM", () => server.close(() => { void pool.end(); }));
