import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { projects, settingsCollection, ObjectId } from "../db.ts";
import type { ConversationEntry, AssistantEntry } from "../db.ts";
import { run_llm } from "../llm.ts";
import type { Message, ToolDefinition } from "../llm.ts";
import { config, getModel } from "../config.ts";
import { createPatch } from "diff";
import { applyDiff } from "@openai/agents-core";

const app = new Hono();

function buildMessages(
  history: ConversationEntry[],
  currentContent: string,
  userMessage: string,
  systemPrompt: string,
  localInstruction?: string,
): Message[] {
  const fullPrompt = localInstruction
    ? `${systemPrompt}\n\n${localInstruction}`
    : systemPrompt;
  const msgs: Message[] = [{ role: "system", content: fullPrompt }];

  // Insert current document right after the last edit so its position stays
  // stable as the conversation grows (good for prefix cache).
  let lastEditIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (
      (e.role === "system" && e.subtype === "user_diff") ||
      (e.role === "assistant" && e.tool_calls.length > 0)
    ) {
      lastEditIdx = i;
      break;
    }
  }
  const insertAt = lastEditIdx + 1; // 0 when no edit yet

  for (let i = 0; i < history.length; i++) {
    if (i === insertAt) {
      msgs.push({ role: "system", content: `Current document:\n${currentContent}` });
    }
    const e = history[i];
    if (e.role === "user") {
      msgs.push({ role: "user", content: e.content });
    } else if (e.role === "assistant") {
      msgs.push({ role: "assistant", content: e.content, tool_calls: e.tool_calls });
    } else if (e.role === "system" && e.subtype === "user_diff") {
      msgs.push({ role: "system", content: `User edited the document:\n\`\`\`diff\n${e.diff}\n\`\`\`` });
    }
  }

  // If the last edit was the final history entry (or history is empty), append here
  if (insertAt >= history.length) {
    msgs.push({ role: "system", content: `Current document:\n${currentContent}` });
  }

  msgs.push({ role: "user", content: userMessage });
  return msgs;
}

app.post("/:id/chat", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ message: string; model?: string }>();

  const project = await projects.findOne({ _id: new ObjectId(id) });
  if (!project) return c.json({ error: "Not found" }, 404);

  const settingsDoc = await settingsCollection.findOne({});
  const systemPrompt = settingsDoc?.systemPrompt ?? config.system_prompt;

  const modelId = body.model ?? project.model ?? config.models[0].id;
  const modelConfig = getModel(modelId);

  // If user edited since last LLM call, record the diff before adding user message
  // Skip if history is empty — no prior LLM context to diff against
  const lastSyncedContent = project.lastSyncedContent ?? project.content;
  if (project.history.length > 0 && project.content !== lastSyncedContent) {
    const diff = createPatch("doc", lastSyncedContent, project.content);
    const userDiffEntry: ConversationEntry = { role: "system", subtype: "user_diff", diff };
    // deno-lint-ignore no-explicit-any
    await (projects as any).updateOne(
      { _id: new ObjectId(id) },
      { $push: { history: userDiffEntry } },
    );
    project.history.push(userDiffEntry);
  }

  // Save user message to DB (not to local history — buildMessages takes it separately)
  const userEntry = { role: "user" as const, content: body.message };
  // deno-lint-ignore no-explicit-any
  await (projects as any).updateOne(
    { _id: new ObjectId(id) },
    { $push: { history: userEntry }, $set: { updatedAt: new Date() } },
  );

  return streamSSE(c, async (stream) => {
    let currentContent = project.content;

    const tools: Record<string, ToolDefinition> = {
      edit_document: {
        schema: {
          type: "function" as const,
          function: {
            name: "edit_document",
            description: (
              "Apply a patch to edit the document.\n" +
              "Patch should be in V4A format.\n" +
              "No headers like --- a.txt or +++ b.txt, just the diff hunks.\n" +
              "Example:\n" +
              "```diff\n" +
              "@@ export function validateToken(\n" +
              " export function validateToken(token: string): boolean {\n" +
              "-  const decoded = jwt.verify(token, SECRET);\n" +
              "-  return !!decoded;\n" +
              "+  try {\n" +
              "+    const decoded = jwt.verify(token, SECRET);\n" +
              "+    return !!decoded;\n" +
              "+  } catch {\n" +
              "+    logger.warn('Token validation failed');\n" +
              "+    return false;\n" +
              "+  }\n" +
              " }\n" +
              "```\n"
            ),
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

          console.log("[edit_document] diff:\n", diff);
          console.log("[edit_document] currentContent length:", currentContent.length, "preview:", currentContent.slice(0, 100));

          let patched: string | false;
          try {
            patched = applyDiff(currentContent, diff);
          } catch (e) {
            console.log("[edit_document] patch parse error:", (e as Error).message);
            return `Error: patch parse failed: ${(e as Error).message}`;
          }
          console.log("[edit_document] applyPatch result:", patched === false ? "FAILED" : `ok, length: ${patched.length}`);
          if (patched === false) {
            return "Error: patch did not apply cleanly";
          }

          currentContent = patched;

          // deno-lint-ignore no-explicit-any
          await (projects as any).updateOne(
            { _id: new ObjectId(id) },
            { $set: { content: currentContent, updatedAt: new Date() } },
          );

          await stream.writeSSE({
            data: JSON.stringify({ type: "document_updated", diff }),
          });

          return "Patch applied successfully";
        },
      },
    };

    const messages = buildMessages(project.history, project.content, body.message, systemPrompt, project.localInstruction);

    console.log("[chat] starting LLM, model:", modelConfig.name, "messages:", messages.length);
    for await (const item of run_llm(messages, modelConfig, tools)) {
      if (item.type === "text_delta") {
        await stream.writeSSE({
          data: JSON.stringify({ type: "text_delta", delta: item.delta }),
        });
      } else if (item.type === "tool_call") {
        await stream.writeSSE({
          data: JSON.stringify({ type: "tool_call", tool_name: item.tool_name, args: item.args }),
        });
      } else if (item.type === "turn_end") {
        const entry: AssistantEntry = { role: "assistant", content: item.text, tool_calls: item.tool_calls };
        // deno-lint-ignore no-explicit-any
        await (projects as any).updateOne(
          { _id: new ObjectId(id) },
          { $push: { history: entry }, $set: { updatedAt: new Date() } },
        );
      }
    }

    // Record the document state after this LLM turn as the new baseline for user-edit detection
    // deno-lint-ignore no-explicit-any
    await (projects as any).updateOne(
      { _id: new ObjectId(id) },
      { $set: { lastSyncedContent: currentContent, updatedAt: new Date() } },
    );

    await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
  });
});

export default app;
