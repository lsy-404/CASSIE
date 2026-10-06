import type { TimelineEntry } from "./audio/types";

export type SegmentKind = "recorded" | "synthesized" | "cue" | "gap";

export function segmentKind(entry: Pick<TimelineEntry, "kind" | "provenance">): SegmentKind {
  if (entry.kind === "word") return entry.provenance === "synthesized" ? "synthesized" : "recorded";
  return entry.kind;
}

export function syncLaneCount(entries: readonly Pick<TimelineEntry, "track">[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.track), 0);
}
