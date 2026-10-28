import OpenAI from "openai";
import { readAiConfig } from "../../config.js";
import type { ContentPart, Conversation, ModelProvider, StepResult, ToolDef, ToolResult, Usage } from "./types.js";

const usageOf = (u: any): Usage => ({
  inputTokens: (u?.prompt_tokens ?? 0) - (u?.prompt_tokens_details?.cached_tokens ?? 0),
  outputTokens: u?.completion_tokens ?? 0,
  cacheReadTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
  cacheWriteTokens: 0,
});

const toUserContent = (parts: ContentPart[]): any[] =>
  parts.map((p) =>
    p.type === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.base64}` } },
  );

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai" as const;
  readonly model: string;
  private client: OpenAI;

  constructor(model: string) {
    this.model = model;
    this.client = new OpenAI({ maxRetries: readAiConfig().limits.apiRetries, timeout: 180_000 });
  }

  startConversation(opts: { system: string; tools: ToolDef[] }): Conversation {
    const tools = opts.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
    const messages: any[] = [{ role: "system", content: opts.system }];
    const client = this.client;
    const model = this.model;
    return {
      addUser(parts) {
        messages.push({ role: "user", content: toUserContent(parts) });
      },
      addToolResults(results: ToolResult[]) {
        // Chat Completions tool messages are text-only; images follow in a user message.
        const images: ContentPart[] = [];
        for (const r of results) {
          const text = r.parts.filter((p) => p.type === "text").map((p: any) => p.text).join("\n");
          messages.push({ role: "tool", tool_call_id: r.id, content: (r.isError ? "ERROR: " : "") + (text || "(see attached image)") });
          images.push(...r.parts.filter((p) => p.type === "image"));
        }
        if (images.length) messages.push({ role: "user", content: [{ type: "text", text: "Screenshot(s) from the tool results above:" }, ...toUserContent(images)] });
      },
      async step(): Promise<StepResult> {
        const res = await client.chat.completions.create({ model, messages, tools });
        const msg = res.choices[0].message;
        messages.push(msg);
        return {
          servedModel: res.model ?? model,
          text: msg.content ?? "",
          toolCalls: (msg.tool_calls ?? [])
            .filter((c: any) => c.type === "function")
            .map((c: any) => {
              let input: any = {};
              try {
                input = JSON.parse(c.function.arguments || "{}");
              } catch {
                input = { __invalid_json: c.function.arguments };
              }
              return { id: c.id, name: c.function.name, input };
            }),
          usage: usageOf(res.usage),
          stopReason: res.choices[0].finish_reason ?? "stop",
        };
      },
    };
  }

  async completeJson(opts: { system: string; prompt: string }) {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
      response_format: { type: "json_object" },
    });
    return { text: res.choices[0].message.content ?? "", usage: usageOf(res.usage), servedModel: res.model ?? this.model };
  }
}
