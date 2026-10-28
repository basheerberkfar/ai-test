/** Provider-neutral model interface used by the planner, executor and verifier. */

export type ToolDef = {
  name: string;
  description: string;
  /** JSON Schema (object). */
  parameters: Record<string, unknown>;
};

export type ContentPart = { type: "text"; text: string } | { type: "image"; mediaType: "image/png" | "image/jpeg"; base64: string };

export type ToolCall = { id: string; name: string; input: any };
export type ToolResult = { id: string; parts: ContentPart[]; isError?: boolean };

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export type StepResult = {
  /** Model id reported by the API for this response (records the exact served version). */
  servedModel: string;
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stopReason: string;
};

/** Stateful conversation. History is append-only (required for preserved thinking on newer models). */
export interface Conversation {
  addUser(parts: ContentPart[]): void;
  addToolResults(results: ToolResult[]): void;
  step(): Promise<StepResult>;
}

export interface ModelProvider {
  readonly name: "anthropic" | "openai";
  readonly model: string;
  startConversation(opts: { system: string; tools: ToolDef[] }): Conversation;
  /** Single-shot completion that must return JSON text. */
  completeJson(opts: { system: string; prompt: string; maxTokens?: number }): Promise<{ text: string; usage: Usage; servedModel: string }>;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});
