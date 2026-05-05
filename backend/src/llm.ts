import OpenAI from "openai";
import { OpenRouter } from "@openrouter/sdk";
import type { Message as ORMessage, ToolDefinitionJson, AssistantMessage } from "@openrouter/sdk/models";
import { Secret } from "./secret.ts";
import type { ModelConfig } from "./config.ts";

export type ToolDefinition = {
  schema: OpenAI.Chat.Completions.ChatCompletionTool;
  callback: (argsJson: string) => Promise<string>;
};

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export type StreamItem =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; tool_name: string; args: string };

const openai_client = new OpenAI({ apiKey: Secret.OPENAI_API_KEY });
const openrouter_client = new OpenRouter({ apiKey: Secret.OPENROUTER_API_KEY });

export async function* run_llm(
  messages: Message[],
  modelConfig: ModelConfig,
  tools?: Record<string, ToolDefinition>,
): AsyncGenerator<StreamItem> {
  switch (modelConfig.provider) {
    case "openai":
      yield* run_responses_api(messages, modelConfig, tools);
      break;
    case "openrouter":
      yield* run_chat_completion(messages, modelConfig, tools);
      break;
    default:
      throw new Error(`Unsupported provider: ${(modelConfig as { provider: string }).provider}`);
  }
}

async function* run_responses_api(
  messages: Message[],
  modelConfig: ModelConfig,
  tools?: Record<string, ToolDefinition>,
): AsyncGenerator<StreamItem> {
  const tool_schemas = tools
    ? Object.values(tools).map((t) => convert_tool_to_responses(t.schema))
    : undefined;

  const instructions = messages[0]?.role === "system" ? messages[0].content : "";
  const input: OpenAI.Responses.ResponseInputItem[] = messages.slice(instructions ? 1 : 0).map((m) => ({
    type: "message" as const,
    role: m.role,
    content: m.content,
  }));

  const response = await openai_client.responses.create({
    instructions,
    input,
    model: modelConfig.name,
    store: true,
    ...(tool_schemas ? { parallel_tool_calls: false, tool_choice: "auto", tools: tool_schemas } : {}),
    ...(modelConfig.reasoning_effort
      ? { reasoning: { effort: modelConfig.reasoning_effort, summary: "auto" } }
      : {}),
  });

  for (const part of response.output) {
    if (part.type === "message") {
      for (const msg of part.content) {
        if (msg.type === "output_text" && msg.text) {
          yield { type: "text_delta", delta: msg.text };
        }
      }
    } else if (part.type === "function_call" && tools) {
      yield { type: "tool_call", tool_name: part.name, args: part.arguments };
      const tool = tools[part.name];
      if (tool) await tool.callback(part.arguments);
    }
  }
}

async function* run_chat_completion(
  messages: Message[],
  modelConfig: ModelConfig,
  tools?: Record<string, ToolDefinition>,
): AsyncGenerator<StreamItem> {
  const tool_schemas: ToolDefinitionJson[] | undefined = tools
    ? Object.values(tools).map((t) => ({
        type: "function" as const,
        function: {
          name: t.schema.function.name,
          description: t.schema.function.description,
          parameters: t.schema.function.parameters as Record<string, unknown>,
        },
      }))
    : undefined;

  const chatMessages: ORMessage[] = messages.map((m) => {
    if (m.role === "system") return { role: "system" as const, content: m.content };
    if (m.role === "user") return { role: "user" as const, content: m.content };
    return { role: "assistant" as const, content: m.content };
  });

  while (true) {
    const res = await openrouter_client.chat.send({
      model: modelConfig.name,
      messages: chatMessages,
      reasoning: { effort: modelConfig.reasoning_effort },
      ...(tool_schemas ? { tools: tool_schemas, toolChoice: "auto" } : {}),
      stream: false,
    });

    const choice = res.choices[0];
    if (!choice) break;

    const assistantMsg: AssistantMessage = {
      role: "assistant",
      content: choice.message.content ?? null,
      toolCalls: choice.message.toolCalls,
    };
    chatMessages.push(assistantMsg);

    if (typeof choice.message.content === "string" && choice.message.content) {
      yield { type: "text_delta", delta: choice.message.content };
    }

    if (choice.finishReason !== "tool_calls" || !choice.message.toolCalls?.length) break;

    for (const call of choice.message.toolCalls) {
      yield { type: "tool_call", tool_name: call.function.name, args: call.function.arguments };
      const tool = tools?.[call.function.name];
      const result = tool
        ? await tool.callback(call.function.arguments)
        : `[ERROR] No tool found for ${call.function.name}`;
      chatMessages.push({ role: "tool", content: result, toolCallId: call.id });
    }
  }
}

function convert_tool_to_responses(
  tool: OpenAI.Chat.Completions.ChatCompletionTool,
): OpenAI.Responses.FunctionTool {
  return {
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters ?? null,
    strict: tool.function.strict ?? null,
  };
}
