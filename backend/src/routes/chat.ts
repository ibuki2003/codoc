import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { projects, ObjectId } from "../db.ts";
import type { ConversationEntry, AssistantEntry } from "../db.ts";
import { run_llm } from "../llm.ts";
import type { Message } from "../llm.ts";
import { config, getModel } from "../config.ts";
import { applyPatch, createPatch } from "diff";

const app = new Hono();

function buildMessages(history: ConversationEntry[]): Message[] {
  const msgs: Message[] = [{ role: "system", content: config.system_prompt }];

  let lastWholeIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.role === "system" && e.subtype === "whole") {
      lastWholeIdx = i;
      break;
    }
  }

  for (let i = 0; i < history.length; i++) {
    const e = history[i];
    if (e.role === "user") {
      msgs.push({ role: "user", content: e.content });
    } else if (e.role === "assistant") {
      msgs.push({ role: "assistant", content: e.content });
    } else if (e.role === "system") {
      if (e.subtype === "diff") {
        msgs.push({ role: "system", content: `Document was edited:\n\`\`\`diff\n${e.diff}\n\`\`\`` });
      } else if (e.subtype === "whole") {
        if (i === lastWholeIdx) {
          msgs.push({ role: "system", content: `Current document:\n${e.content}` });
        } else {
          msgs.push({ role: "system", content: "[Document content at this point has been omitted]" });
        }
      } else if (e.subtype === "redacted") {
        msgs.push({ role: "system", content: "[Document content at this point has been omitted]" });
      }
    }
  }

  return msgs;
}

app.post("/:id/chat", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ message: string; model?: string }>();

  const project = await projects.findOne({ _id: new ObjectId(id) });
  if (!project) return c.json({ error: "Not found" }, 404);

  const modelId = body.model ?? config.models[0].id;
  const modelConfig = getModel(modelId);

  // Find content recorded at last LLM call (last whole entry)
  let lastRecordedContent = "";
  for (let i = project.history.length - 1; i >= 0; i--) {
    const e = project.history[i];
    if (e.role === "system" && e.subtype === "whole") {
      lastRecordedContent = e.content;
      break;
    }
  }

  // If user edited since last LLM call, record the change before adding user message
  if (project.content !== lastRecordedContent) {
    const entriesToAdd: ConversationEntry[] = [];
    if (lastRecordedContent !== "") {
      const diff = createPatch("doc", lastRecordedContent, project.content);
      entriesToAdd.push({ role: "system", subtype: "diff", diff });
    }
    entriesToAdd.push({ role: "system", subtype: "whole", content: project.content });

    // deno-lint-ignore no-explicit-any
    await (projects as any).updateOne(
      { _id: new ObjectId(id) },
      { $push: { history: { $each: entriesToAdd } } },
    );
    project.history.push(...entriesToAdd);
  }

  // Add user entry to history
  const userEntry = { role: "user" as const, content: body.message };
  // deno-lint-ignore no-explicit-any
  await (projects as any).updateOne(
    { _id: new ObjectId(id) },
    { $push: { history: userEntry }, $set: { updatedAt: new Date() } },
  );
  project.history.push(userEntry);

  return streamSSE(c, async (stream) => {
    let currentContent = project.content;
    const assistantParts: string[] = [];

    const tools = {
      edit_document: {
        schema: {
          type: "function" as const,
          function: {
            name: "edit_document",
            description: "Apply a unified diff to edit the document",
            parameters: {
              type: "object",
              properties: {
                diff: { type: "string", description: "unified diff形式の差分" },
              },
              required: ["diff"],
            },
          },
        },
        callback: async (argsJson: string): Promise<string> => {
          let diff: string;
          try {
            ({ diff } = JSON.parse(argsJson));
          } catch {
            return "Error: invalid JSON args";
          }

          let patched: string | false;
          try {
            patched = applyPatch(currentContent, diff);
          } catch (e) {
            return `Error: patch parse failed: ${(e as Error).message}`;
          }
          if (patched === false) {
            return "Error: patch did not apply cleanly";
          }

          currentContent = patched;

          const diffEntry = { role: "system" as const, subtype: "diff" as const, diff };
          const wholeEntry = { role: "system" as const, subtype: "whole" as const, content: currentContent };

          // deno-lint-ignore no-explicit-any
          await (projects as any).updateOne(
            { _id: new ObjectId(id) },
            {
              $push: { history: { $each: [diffEntry, wholeEntry] } },
              $set: { content: currentContent, updatedAt: new Date() },
            },
          );

          await stream.writeSSE({
            data: JSON.stringify({ type: "document_updated", diff }),
          });

          return "Patch applied successfully";
        },
      },
    };

    const messages = buildMessages(project.history);

    for await (const item of run_llm(messages, modelConfig, tools)) {
      if (item.type === "text_delta") {
        assistantParts.push(item.delta);
        await stream.writeSSE({
          data: JSON.stringify({ type: "text_delta", delta: item.delta }),
        });
      } else if (item.type === "tool_call") {
        await stream.writeSSE({
          data: JSON.stringify({ type: "tool_call", tool_name: item.tool_name, args: item.args }),
        });
      }
    }

    const assistantContent = assistantParts.join("");
    const assistantEntry: AssistantEntry = { role: "assistant", content: assistantContent };
    // deno-lint-ignore no-explicit-any
    await (projects as any).updateOne(
      { _id: new ObjectId(id) },
      { $push: { history: assistantEntry }, $set: { updatedAt: new Date() } },
    );

    await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
  });
});

export default app;
