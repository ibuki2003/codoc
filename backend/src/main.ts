import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config.ts";
import projectsRouter from "./routes/projects.ts";
import chatRouter from "./routes/chat.ts";

const app = new Hono();

app.use("*", cors());

app.get("/models", (c) => {
  return c.json(config.models.map((m) => ({ id: m.id, name: m.name })));
});

app.route("/projects", projectsRouter);
app.route("/projects", chatRouter);

Deno.serve({ port: 8000 }, app.fetch);
