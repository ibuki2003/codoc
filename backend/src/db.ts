import { MongoClient, ObjectId } from "mongodb";
import { Secret } from "./secret.ts";

const client = new MongoClient(Secret.MONGODB_URL);
await client.connect();
const db = client.db();

export { ObjectId };

export type ToolCallRecord = {
  call_id: string;
  tool_name: string;
  args: string;
  result: string;
};

export type UserEntry      = { role: "user"; content: string };
export type AssistantEntry = { role: "assistant"; content: string; tool_calls: ToolCallRecord[] };
export type UserDiffEntry  = { role: "system"; subtype: "user_diff"; diff: string };

export type ConversationEntry =
  | UserEntry
  | AssistantEntry
  | UserDiffEntry;

export type Project = {
  _id: ObjectId;
  title: string;
  content: string;
  lastSyncedContent?: string;
  model?: string;
  history: ConversationEntry[];
  createdAt: Date;
  updatedAt: Date;
};

export const projects = db.collection<Project>("projects");

export type Settings = {
  systemPrompt: string;
};
export const settingsCollection = db.collection<Settings>("settings");
