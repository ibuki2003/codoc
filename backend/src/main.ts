import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/deno";
import { config } from "./config.ts";
import projectsRouter from "./routes/projects.ts";
import chatRouter from "./routes/chat.ts";
import settingsRouter from "./routes/settings.ts";

const app = new Hono();

app.use("*", cors());

app.get("/api/models", (c) => {
  return c.json(config.models.map((m) => ({ id: m.id, name: m.name })));
});

app.route("/api/projects", projectsRouter);
app.route("/api/projects", chatRouter);
app.route("/api/settings", settingsRouter);

// Static files (frontend build)
app.use("/*", serveStatic({ root: "./dist" }));
// SPA fallback
app.get("/*", serveStatic({ path: "./dist/index.html" }));

Deno.serve({ port: 8000 }, app.fetch);
