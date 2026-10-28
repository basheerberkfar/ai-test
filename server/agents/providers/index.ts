import { modelFor, readAiConfig, settings } from "../../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import type { ModelProvider } from "./types.js";

export function providerConfigured(name: "anthropic" | "openai" = settings.provider) {
  return name === "openai" ? !!process.env.OPENAI_API_KEY : !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function createProvider(name: "anthropic" | "openai", model: string): ModelProvider {
  if (!providerConfigured(name)) throw new Error(`${name === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} is not set (see .env.example).`);
  return name === "openai" ? new OpenAIProvider(model) : new AnthropicProvider(model);
}

export function providerStatus() {
  const routing = readAiConfig().routing;
  return {
    provider: settings.provider,
    model: modelFor(settings.provider, "executor"),
    models: routing[settings.provider],
    roles: routing.roles,
    configured: providerConfigured(),
  };
}
