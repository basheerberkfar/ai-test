import type { z } from "zod";
import type { ModelProvider, Usage } from "./providers/types.js";
import { addUsage, emptyUsage } from "./providers/types.js";

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON object in model output.");
  return JSON.parse(body.slice(start, end + 1));
}

/** Ask for JSON, validate with zod, and give the model one chance to repair invalid output. */
export async function structuredCall<T extends z.ZodTypeAny>(
  provider: ModelProvider,
  system: string,
  prompt: string,
  schema: T,
): Promise<{ data: z.infer<T>; usage: Usage }> {
  let usage = emptyUsage();
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = attempt === 0 ? prompt : `${prompt}\n\nYour previous answer was invalid: ${lastError}\nReturn ONLY a valid JSON object matching the schema.`;
    const res = await provider.completeJson({ system, prompt: p });
    usage = addUsage(usage, res.usage);
    try {
      return { data: schema.parse(extractJson(res.text)), usage };
    } catch (e: any) {
      lastError = String(e?.message ?? e).slice(0, 800);
    }
  }
  throw new Error(`Model returned invalid structured output: ${lastError}`);
}
