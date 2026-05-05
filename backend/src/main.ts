import { Hono } from "hono";
import { cors } from "hono/cors";
import projectsRouter from "./routes/projects.ts";
import chatRouter from "./routes/chat.ts";

const app = new Hono();

app.use("*", cors());

app.route("/projects", projectsRouter);
app.route("/projects", chatRouter);

Deno.serve({ port: 8000 }, app.fetch);
