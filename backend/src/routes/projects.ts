import { Hono } from "hono";
import { projects, ObjectId } from "../db.ts";

const app = new Hono();

app.get("/", async (c) => {
  const list = await projects
    .find({}, { projection: { _id: 1, title: 1, createdAt: 1, updatedAt: 1 } })
    .sort({ updatedAt: -1 })
    .toArray();
  return c.json(list.map((p) => ({ ...p, _id: p._id.toString() })));
});

app.post("/", async (c) => {
  const body = await c.req.json<{ title: string }>();
  const now = new Date();
  const result = await projects.insertOne({
    _id: new ObjectId(),
    title: body.title,
    content: "",
    history: [],
    createdAt: now,
    updatedAt: now,
  });
  return c.json({ _id: result.insertedId.toString() }, 201);
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const project = await projects.findOne({ _id: new ObjectId(id) });
  if (!project) return c.json({ error: "Not found" }, 404);
  return c.json({ ...project, _id: project._id.toString() });
});

app.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ content: string }>();
  const result = await projects.updateOne(
    { _id: new ObjectId(id) },
    { $set: { content: body.content, updatedAt: new Date() } },
  );
  if (result.matchedCount === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

app.delete("/:id/history", async (c) => {
  const id = c.req.param("id");
  const result = await projects.updateOne(
    { _id: new ObjectId(id) },
    { $set: { history: [], updatedAt: new Date() } },
  );
  if (result.matchedCount === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const result = await projects.deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

export default app;
