import yaml from "js-yaml";

export type ModelConfig = {
  id: string;
  provider: "openai" | "openrouter";
  name: string;
  reasoning_effort?: "low" | "medium" | "high";
};

type AppConfig = {
  models: ModelConfig[];
  system_prompt: string;
};

const raw = Deno.readTextFileSync(new URL("../config.yml", import.meta.url));
export const config: AppConfig = yaml.load(raw) as AppConfig;

export function getModel(id: string): ModelConfig {
  const m = config.models.find((m) => m.id === id);
  if (!m) throw new Error(`Unknown model: ${id}`);
  return m;
}
