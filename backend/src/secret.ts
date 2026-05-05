export const Secret = {
  OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY") ?? "",
  OPENROUTER_API_KEY: Deno.env.get("OPENROUTER_API_KEY") ?? "",
  MONGODB_URL: Deno.env.get("MONGODB_URL") ?? "mongodb://localhost:27017/codoc",
};
