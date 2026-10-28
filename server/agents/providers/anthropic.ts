import Anthropic from "@anthropic-ai/sdk";
import { readAiConfig, settings } from "../../config.js";
import type { ContentPart, Conversation, ModelProvider, StepResult, ToolDef, ToolResult, Usage } from "./types.js";

const toBlocks = (parts: ContentPart[]): any[] =>
  parts.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } },
  );

const usageOf = (u: any): Usage => ({
  inputTokens: u?.input_tokens ?? 0,
  outputTokens: u?.output_tokens ?? 0,
  cacheReadTokens: u?.cache_read_input_tokens ?? 0,
  cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
});

export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private client: Anthropic;
  private useFallbacks = settings.anthropicFallbacks;

  constructor(model: string) {
    this.model = model;
    this.client = new Anthropic({ maxRetries: readAiConfig().limits.apiRetries, timeout: 180_000 });
  }

  async create(params: Record<string, unknown>): Promise<any> {
    const base = {
      model: this.model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: settings.effort },
      // Top-level automatic prompt caching: the growing conversation prefix is reused each step.
      cache_control: { type: "ephemeral" },
      ...params,
    };
    if (this.useFallbacks) {
      try {
        return await this.client.beta.messages.create({
          ...base,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        } as any);
      } catch (err) {
        // Degrade gracefully if the account/model does not accept the fallback beta.
        if (err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) this.useFallbacks = false;
        else throw err;
      }
    }
    return this.client.messages.create(base as any);
  }

  startConversation(opts: { system: string; tools: ToolDef[] }): Conversation {
    const tools = opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    const messages: any[] = [];
    const provider = this;
    return {
      addUser(parts) {
        messages.push({ role: "user", content: toBlocks(parts) });
      },
      addToolResults(results: ToolResult[]) {
        messages.push({
          role: "user",
          content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, is_error: r.isError || undefined, content: toBlocks(r.parts) })),
        });
      },
      async step(): Promise<StepResult> {
        const res = await provider.create({ system: opts.system, tools, messages });
        // Append the full content (including thinking blocks) unchanged: history stays append-only.
        messages.push({ role: "assistant", content: res.content });
        if (res.stop_reason === "refusal") {
          return { servedModel: res.model ?? provider.model, text: "[model declined this request]", toolCalls: [], usage: usageOf(res.usage), stopReason: "refusal" };
        }
        const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
        const toolCalls = res.content.filter((b: any) => b.type === "tool_use").map((b: any) => ({ id: b.id, name: b.name, input: b.input }));
        return { servedModel: res.model ?? provider.model, text, toolCalls, usage: usageOf(res.usage), stopReason: res.stop_reason };
      },
    };
  }

  async completeJson(opts: { system: string; prompt: string; maxTokens?: number }) {
    const res = await this.create({
      system: opts.system,
      max_tokens: opts.maxTokens ?? 16000,
      messages: [{ role: "user", content: opts.prompt }],
    });
    if (res.stop_reason === "refusal") throw new Error("Model declined the request.");
    const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    return { text, usage: usageOf(res.usage), servedModel: res.model ?? this.model };
  }
}
