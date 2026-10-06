import { describe, expect, it } from "vitest";
import { segmentKind, syncLaneCount } from "../src/timeline";

describe("timeline colour mapping", () => {
  it("maps provenance, cues and gaps to one class each", () => {
    expect(segmentKind({ kind: "word", provenance: "recorded" })).toBe("recorded");
    expect(segmentKind({ kind: "word", provenance: "synthesized" })).toBe("synthesized");
    expect(segmentKind({ kind: "cue" })).toBe("cue");
    expect(segmentKind({ kind: "gap" })).toBe("gap");
  });

  it("counts the sync lanes below the main track", () => {
    expect(syncLaneCount([])).toBe(0);
    expect(syncLaneCount([{ track: 0 }, { track: 2 }, { track: 1 }])).toBe(2);
  });
});
