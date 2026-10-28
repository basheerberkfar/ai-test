import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Field, Input, Select, Textarea } from "@ui/ui";
import { post, put, type Story } from "../lib";

const toLines = (s: string) => s.split("\n").map((l) => l.replace(/^\s*(\d+[.)]|[-*])\s*/, "").trim()).filter(Boolean);
const fromLines = (a: string[]) => a.map((l, i) => `${i + 1}. ${l}`).join("\n");

export function StoryEditor({ story, onSaved }: { story?: Story; onSaved: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    id: story?.id ?? "",
    title: story?.title ?? "",
    priority: story?.priority ?? "Medium",
    appUrl: story?.appUrl ?? "http://localhost:5173",
    role: story?.role ?? "Therapist",
    description: story?.description ?? "",
    acceptanceCriteria: fromLines(story?.acceptanceCriteria ?? []),
    happyPath: fromLines(story?.happyPath ?? []),
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...v, acceptanceCriteria: toLines(v.acceptanceCriteria), happyPath: toLines(v.happyPath) };
      return story ? put(`/stories/${story.id}`, body) : post("/stories", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stories"] });
      qc.invalidateQueries({ queryKey: ["story"] });
      toast.success("Story saved");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Story ID" htmlFor="sid" required>
          <Input id="sid" value={v.id} onChange={set("id")} placeholder="STORY-002" disabled={!!story} />
        </Field>
        <Field label="Priority" htmlFor="prio" required>
          <Select id="prio" value={v.priority} onChange={set("priority")}>
            {["Critical", "High", "Medium", "Low"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </Field>
        <Field label="Primary role" htmlFor="role" required>
          <Input id="role" value={v.role} onChange={set("role")} />
        </Field>
      </div>
      <Field label="Title" htmlFor="title" required>
        <Input id="title" value={v.title} onChange={set("title")} />
      </Field>
      <Field label="Application URL" htmlFor="url" required hint="Must be an authorized environment in config/environments.json.">
        <Input id="url" value={v.appUrl} onChange={set("appUrl")} />
      </Field>
      <Field label="Description" htmlFor="desc" required>
        <Textarea id="desc" value={v.description} onChange={set("description")} placeholder="As a …, I want … so that …" />
      </Field>
      <Field label="Acceptance Criteria" htmlFor="ac" required hint="One per line.">
        <Textarea id="ac" value={v.acceptanceCriteria} onChange={set("acceptanceCriteria")} className="min-h-[110px] font-mono text-[12.5px]" />
      </Field>
      <Field label="Happy Path" htmlFor="hp" required hint="One step per line. Executed in every run.">
        <Textarea id="hp" value={v.happyPath} onChange={set("happyPath")} className="min-h-[150px] font-mono text-[12.5px]" />
      </Field>
      <div className="flex justify-end gap-2 border-t border-hairline pt-4">
        <Button type="submit" loading={save.isPending} disabled={save.isPending}>
          Save Story
        </Button>
      </div>
    </form>
  );
}
