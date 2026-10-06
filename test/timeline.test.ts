import { describe, expect, it } from "vitest";
import { segmentKind, syncLanes } from "../src/timeline";

describe("timeline colour mapping", () => {
  it("maps provenance, cues and gaps to one class each", () => {
    expect(segmentKind({ kind: "word", provenance: "recorded" })).toBe("recorded");
    expect(segmentKind({ kind: "word", provenance: "synthesized" })).toBe("synthesized");
    expect(segmentKind({ kind: "cue" })).toBe("cue");
    expect(segmentKind({ kind: "gap" })).toBe("gap");
  });

  it("packs sync tracks into lanes by overlap", () => {
    const span = (track: number, startSeconds: number, endSeconds: number) => ({ track, startSeconds, endSeconds });
    expect(syncLanes([span(0, 0, 9)])).toEqual({ lanes: new Map(), count: 0 });
    const separate = syncLanes([span(1, 0, 1), span(2, 2, 3), span(3, 4, 5)]);
    expect(separate.count).toBe(1);
    const overlapping = syncLanes([span(1, 0, 3), span(2, 1, 2), span(3, 3, 4)]);
    expect([...overlapping.lanes]).toEqual([[1, 1], [2, 2], [3, 1]]);
    expect(overlapping.count).toBe(2);
  });
});
