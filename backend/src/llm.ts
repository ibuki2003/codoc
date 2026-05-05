import OpenAI from "openai";
import { OpenRouter } from "@openrouter/sdk";
import type { AssistantMessage } from "@openrouter/sdk/models";
import { Secret } from "./secret.ts";
import type { ModelConfig } from "./config.ts";
import type { ToolCallRecord } from "./db.ts";

export type ToolDefinition = {
  schema: OpenAI.Chat.Completions.ChatCompletionTool;
  callback: (argsJson: string) => Promise<string>;
};

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCallRecord[] };

export type StreamItem =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; tool_name: string; args: string }
  | { type: "turn_end"; text: string; tool_calls: ToolCallRecord[] };

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

  const firstInput: OpenAI.Responses.ResponseInputItem[] = [];
  for (const m of messages.slice(instructions ? 1 : 0)) {
    if (m.role === "assistant") {
      if (m.content) {
        firstInput.push({ type: "message", role: "assistant", content: m.content });
      }
      for (const tc of m.tool_calls ?? []) {
        firstInput.push({ type: "function_call", name: tc.tool_name, arguments: tc.args, call_id: tc.call_id });
        firstInput.push({ type: "function_call_output", call_id: tc.call_id, output: tc.result });
      }
    } else {
      firstInput.push({ type: "message", role: m.role, content: m.content });
    }
  }

  let currentInput: OpenAI.Responses.ResponseInputItem[] = firstInput;
  let previousResponseId: string | undefined;

  while (true) {
    const response = await openai_client.responses.create({
      instructions,
      input: currentInput,
      model: modelConfig.name,
      store: true,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      ...(tool_schemas ? { parallel_tool_calls: false, tool_choice: "auto", tools: tool_schemas } : {}),
      ...(modelConfig.reasoning_effort
        ? { reasoning: { effort: modelConfig.reasoning_effort, summary: "auto" } }
        : {}),
    });

    console.log("[responses_api] response.id:", response.id, "parts:", JSON.stringify(response.output.map(p => ({ type: p.type, ...(p.type === "function_call" ? { name: p.name } : {}) }))));
    previousResponseId = response.id;

    let roundText = "";
    const roundToolCalls: ToolCallRecord[] = [];
    const toolResults: OpenAI.Responses.ResponseInputItem[] = [];

    for (const part of response.output) {
      if (part.type === "message") {
        for (const msg of part.content) {
          if (msg.type === "output_text" && msg.text) {
            roundText += msg.text;
            yield { type: "text_delta", delta: msg.text };
          }
        }
      } else if (part.type === "function_call" && tools) {
        console.log("[responses_api] tool_call:", part.name, "args:", part.arguments);
        yield { type: "tool_call", tool_name: part.name, args: part.arguments };
        const tool = tools[part.name];
        const result = tool
          ? await tool.callback(part.arguments)
          : `[ERROR] No tool found for ${part.name}`;
        console.log("[responses_api] tool result:", result);
        roundToolCalls.push({ call_id: part.call_id, tool_name: part.name, args: part.arguments, result });
        toolResults.push({ type: "function_call_output", call_id: part.call_id, output: result });
      }
    }

    yield { type: "turn_end", text: roundText, tool_calls: roundToolCalls };

    if (toolResults.length === 0) break;
    currentInput = toolResults;
  }
}

async function* run_chat_completion(
  messages: Message[],
  modelConfig: ModelConfig,
  tools?: Record<string, ToolDefinition>,
): AsyncGenerator<StreamItem> {
  const tool_schemas = tools
    ? Object.values(tools).map((t) => ({
        type: "function" as const,
        function: {
          name: t.schema.function.name,
          description: t.schema.function.description,
          parameters: t.schema.function.parameters as Record<string, unknown>,
        },
      }))
    : undefined;

  // deno-lint-ignore no-explicit-any
  const chatMessages: any[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls?.length) {
      chatMessages.push({
        role: "assistant",
        content: m.content || null,
        toolCalls: m.tool_calls.map((tc) => ({
          id: tc.call_id,
          type: "function",
          function: { name: tc.tool_name, arguments: tc.args },
        })),
      } as AssistantMessage);
      for (const tc of m.tool_calls) {
        chatMessages.push({ role: "tool", content: tc.result, toolCallId: tc.call_id });
      }
    } else {
      chatMessages.push({ role: m.role, content: m.content });
    }
  }

  while (true) {
    console.log("[chat_completion] sending", chatMessages.length, "messages, last role:", chatMessages.at(-1)?.role);
    const res = await openrouter_client.chat.send({
      model: modelConfig.name,
      messages: chatMessages,
      reasoning: { effort: modelConfig.reasoning_effort },
      ...(tool_schemas ? { tools: tool_schemas, toolChoice: "auto" } : {}),
      stream: false,
    });

    const choice = res.choices[0];
    console.log("[chat_completion] finishReason:", choice?.finishReason, "toolCalls:", choice?.message?.toolCalls?.length ?? 0);
    if (!choice) break;

    let roundText = "";
    const roundToolCalls: ToolCallRecord[] = [];

    if (typeof choice.message.content === "string" && choice.message.content) {
      roundText = choice.message.content;
      yield { type: "text_delta", delta: roundText };
    }

    if (choice.finishReason !== "tool_calls" || !choice.message.toolCalls?.length) {
      chatMessages.push({ role: "assistant", content: roundText || null });
      yield { type: "turn_end", text: roundText, tool_calls: [] };
      break;
    }

    const assistantMsg: AssistantMessage = {
      role: "assistant",
      content: choice.message.content ?? null,
      toolCalls: choice.message.toolCalls,
    };
    chatMessages.push(assistantMsg);

    for (const call of choice.message.toolCalls) {
      console.log("[chat_completion] tool_call:", call.function.name);
      yield { type: "tool_call", tool_name: call.function.name, args: call.function.arguments };
      const tool = tools?.[call.function.name];
      const result = tool
        ? await tool.callback(call.function.arguments)
        : `[ERROR] No tool found for ${call.function.name}`;
      console.log("[chat_completion] tool result:", result);
      roundToolCalls.push({ call_id: call.id, tool_name: call.function.name, args: call.function.arguments, result });
      chatMessages.push({ role: "tool", content: result, toolCallId: call.id });
    }

    yield { type: "turn_end", text: roundText, tool_calls: roundToolCalls };
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
