import { Badge } from "@ui/ui";

const tones = { Active: "green", Inactive: "neutral", "On Hold": "orange", Discharged: "blue" } as const;

export const StatusBadge = ({ status }: { status: string }) => (
  <Badge tone={tones[status as keyof typeof tones] ?? "neutral"} dot>
    {status}
  </Badge>
);
