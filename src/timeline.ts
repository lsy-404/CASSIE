import type { TimelineEntry } from "./audio/types";

export type SegmentKind = "recorded" | "synthesized" | "cue" | "gap";

export function segmentKind(entry: Pick<TimelineEntry, "kind" | "provenance">): SegmentKind {
  if (entry.kind === "word") return entry.provenance === "synthesized" ? "synthesized" : "recorded";
  return entry.kind;
}

export function syncLanes(entries: readonly Pick<TimelineEntry, "track" | "startSeconds" | "endSeconds">[]): { lanes: Map<number, number>; count: number } {
  const spans = new Map<number, { start: number; end: number }>();
  for (const entry of entries) {
    if (entry.track <= 0) continue;
    const span = spans.get(entry.track);
    if (span) { span.start = Math.min(span.start, entry.startSeconds); span.end = Math.max(span.end, entry.endSeconds); }
    else spans.set(entry.track, { start: entry.startSeconds, end: entry.endSeconds });
  }
  const laneEnds: number[] = [];
  const lanes = new Map<number, number>();
  for (const [track, span] of [...spans].sort((left, right) => left[1].start - right[1].start)) {
    let lane = laneEnds.findIndex((end) => end <= span.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = span.end;
    lanes.set(track, lane + 1);
  }
  return { lanes, count: laneEnds.length };
}
