import { MongoClient, ObjectId } from "mongodb";
import { Secret } from "./secret.ts";

const client = new MongoClient(Secret.MONGODB_URL);
await client.connect();
const db = client.db();

export { ObjectId };

export type UserEntry      = { role: "user"; content: string };
export type AssistantEntry = { role: "assistant"; content: string };
export type DiffEntry      = { role: "system"; subtype: "diff"; diff: string };
export type WholeEntry     = { role: "system"; subtype: "whole"; content: string };
export type RedactedEntry  = { role: "system"; subtype: "redacted" };

export type ConversationEntry =
  | UserEntry
  | AssistantEntry
  | DiffEntry
  | WholeEntry
  | RedactedEntry;

export type Project = {
  _id: ObjectId;
  title: string;
  content: string;
  history: ConversationEntry[];
  createdAt: Date;
  updatedAt: Date;
};

export const projects = db.collection<Project>("projects");
