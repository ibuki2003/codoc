const BASE = "/api";

export type ProjectSummary = {
  _id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ToolCallRecord = {
  call_id: string;
  tool_name: string;
  args: string;
  result: string;
};

export type ConversationEntry =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls: ToolCallRecord[] }
  | { role: "system"; subtype: "user_diff"; diff: string };

export type Project = {
  _id: string;
  title: string;
  content: string;
  lastSyncedContent: string;
  model?: string;
  localInstruction?: string;
  history: ConversationEntry[];
  createdAt: string;
  updatedAt: string;
};

export type StreamChunk =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; tool_name: string; args: string }
  | { type: "document_updated"; diff: string }
  | { type: "done" };

export type ModelInfo = { id: string; name: string };

export async function listModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${BASE}/models`);
  return res.json();
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await fetch(`${BASE}/projects`);
  return res.json();
}

export async function createProject(title: string): Promise<{ _id: string }> {
  const res = await fetch(`${BASE}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return res.json();
}

export async function getProject(id: string): Promise<Project> {
  const res = await fetch(`${BASE}/projects/${id}`);
  return res.json();
}

export async function patchProject(id: string, patch: {
  content?: string;
  title?: string;
  model?: string;
  localInstruction?: string;
}): Promise<void> {
  await fetch(`${BASE}/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function updateContent(id: string, content: string): Promise<void> {
  await patchProject(id, { content });
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`${BASE}/projects/${id}`, { method: "DELETE" });
}

export async function clearHistory(id: string): Promise<void> {
  await fetch(`${BASE}/projects/${id}/history`, { method: "DELETE" });
}

export async function getSettings(): Promise<{ systemPrompt: string }> {
  const res = await fetch(`${BASE}/settings`);
  return res.json();
}

export async function updateSettings(settings: { systemPrompt: string }): Promise<void> {
  await fetch(`${BASE}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export function chatStream(
  id: string,
  message: string,
  model: string,
  onChunk: (chunk: StreamChunk) => void,
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetch(`${BASE}/projects/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, model }),
      });
      if (!res.body) { resolve(); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data) onChunk(JSON.parse(data) as StreamChunk);
          }
        }
      }
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
