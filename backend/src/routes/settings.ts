import { Hono } from "hono";
import { settingsCollection } from "../db.ts";
import { config } from "../config.ts";

const app = new Hono();

app.get("/", async (c) => {
  const s = await settingsCollection.findOne({});
  return c.json({ systemPrompt: s?.systemPrompt ?? config.system_prompt });
});

app.patch("/", async (c) => {
  const { systemPrompt } = await c.req.json<{ systemPrompt: string }>();
  await settingsCollection.updateOne({}, { $set: { systemPrompt } }, { upsert: true });
  return c.json({ ok: true });
});

export default app;
