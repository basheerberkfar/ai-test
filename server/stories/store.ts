import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { paths } from "../config.js";

export const StorySchema = z.object({
  id: z.string().regex(/^[A-Z]+-\d+$/, "Use an ID like STORY-002"),
  title: z.string().min(3),
  priority: z.enum(["Critical", "High", "Medium", "Low"]),
  appUrl: z.string().url(),
  role: z.string().min(1),
  description: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  happyPath: z.array(z.string().min(1)).min(1),
  /** Repository path prefixes this story exercises; used by CI to select affected stories. */
  covers: z.array(z.string().min(1)).default([]),
});
export type Story = z.infer<typeof StorySchema> & { file: string };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Stories are plain Markdown files with YAML-like front matter, so they stay reviewable in git. */
export function parseStory(md: string, file: string): Story {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const meta: Record<string, string> = {};
  for (const line of (fm?.[1] ?? "").split(/\r?\n/)) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  const body = fm ? md.slice(fm[0].length) : md;
  const sections: Record<string, string> = {};
  for (const part of body.split(/^## /m).slice(1)) {
    const [heading, ...rest] = part.split(/\r?\n/);
    sections[heading.trim().toLowerCase()] = rest.join("\n").trim();
  }
  const list = (s = "") =>
    s
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*(?:\d+[.)]|[-*])\s+(.*)$/)?.[1]?.trim())
      .filter((l): l is string => !!l);
  return {
    file,
    id: meta.id,
    title: meta.title,
    priority: (meta.priority as Story["priority"]) || "Medium",
    appUrl: meta.appUrl,
    role: meta.role || "Therapist",
    description: sections["description"] ?? "",
    acceptanceCriteria: list(sections["acceptance criteria"]),
    happyPath: list(sections["happy path"]),
    covers: (meta.covers ?? "").split(",").map((c) => c.trim()).filter(Boolean),
  };
}

export function serializeStory(s: Omit<Story, "file">) {
  return [
    "---",
    `id: ${s.id}`,
    `title: ${s.title}`,
    `priority: ${s.priority}`,
    `appUrl: ${s.appUrl}`,
    `role: ${s.role}`,
    ...(s.covers?.length ? [`covers: ${s.covers.join(", ")}`] : []),
    "---",
    "",
    "## Description",
    "",
    s.description.trim(),
    "",
    "## Acceptance Criteria",
    "",
    ...s.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    "",
    "## Happy Path",
    "",
    ...s.happyPath.map((c, i) => `${i + 1}. ${c}`),
    "",
  ].join("\n");
}

export function listStories(): Story[] {
  return fs
    .readdirSync(paths.stories)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseStory(fs.readFileSync(path.join(paths.stories, f), "utf8"), f))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getStory(id: string) {
  return listStories().find((s) => s.id === id) ?? null;
}

export function saveStory(input: unknown, existingId?: string): Story {
  const data = StorySchema.parse(input);
  const existing = existingId ? getStory(existingId) : null;
  if (!existing && getStory(data.id)) throw new Error(`Story ${data.id} already exists.`);
  if (existing && existing.id !== data.id) throw new Error("Story ID cannot be changed.");
  const file = existing?.file ?? `${slug(data.title)}.md`;
  fs.writeFileSync(path.join(paths.stories, file), serializeStory(data));
  return { ...data, file };
}
