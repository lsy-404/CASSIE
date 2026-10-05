import { describe, expect, it } from "vitest";
import { boundedNumber, phonemeInsertion } from "../src/editor";

describe("phoneme insertion", () => {
  it("adds only the phone inside a valid phoneme block and preserves token spacing", () => {
    const source = "say / a e: / now";
    expect(phonemeInsertion(source, 8, 8, "ɪ")).toEqual({ value: "ɪ ", selectionStart: 2, selectionEnd: 2 });
  });

  it("creates delimiters outside a phoneme block", () => {
    expect(phonemeInsertion("say this", 4, 8, "e:").value).toBe("/ e: /");
  });

  it("ignores slash characters in closing tags and quoted attributes", () => {
    const source = '<span data-example="/ not a block /">word</span>';
    const result = phonemeInsertion(source, source.indexOf("word"), source.indexOf("word"), "æ");
    expect(result.value).toBe("/ æ /");
  });
});

describe("fine number controls", () => {
  it("ignores cleared and non-finite edits, and bounds committed values", () => {
    expect(boundedNumber(null, -24, 12)).toBeUndefined();
    expect(boundedNumber(Number.NaN, -24, 12)).toBeUndefined();
    expect(boundedNumber(-1.3, -24, 12)).toBe(-1.3);
    expect(boundedNumber(-30, -24, 12)).toBe(-24);
    expect(boundedNumber(20, -24, 12)).toBe(12);
  });
});
