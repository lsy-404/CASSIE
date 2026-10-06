import { describe, expect, it, vi } from "vitest";
import { ICONS } from "../src/icons";
import { FIT_RANGE, SCOPES, fitScope } from "../src/markup";
import { RIBBON_GROUPS } from "../src/ribbon";

const commands = RIBBON_GROUPS.flatMap((group) => group.commands);

describe("ribbon configuration", () => {
  it("is one flat list of groups with unique ids and only known icons", () => {
    expect(new Set(RIBBON_GROUPS.map((group) => group.id)).size).toBe(RIBBON_GROUPS.length);
    expect(new Set(commands.map((command) => command.id)).size).toBe(commands.length);
    for (const group of RIBBON_GROUPS) expect(group.commands.length).toBeGreaterThan(0);
    for (const command of commands) expect(ICONS).toHaveProperty(command.icon);
  });

  it("offers the reading time controls", () => {
    const reading = RIBBON_GROUPS.find((group) => group.id === "reading");
    expect(reading?.commands.map((command) => command.id)).toEqual(["fitSeconds", "fit"]);
    expect(FIT_RANGE).toMatchObject({ min: 0.05, max: 120, default: 2 });
    expect(fitScope(2)).toEqual({ open: '<fit seconds="2">', close: "</fit>" });
  });

  it("has no phonemes or view group and offers sync in the advanced group", () => {
    expect(RIBBON_GROUPS.map((group) => group.id)).not.toContain("phonemes");
    expect(RIBBON_GROUPS.map((group) => group.id)).not.toContain("view");
    expect(RIBBON_GROUPS.find((group) => group.id === "advanced")?.commands).toMatchObject([{ id: "scope.sync", action: "scope.sync" }]);
    expect(SCOPES.sync).toEqual({ open: "<sync>", close: "</sync>" });
  });

  it("hosts the global mix, voice processing, strict toggle and the only export commands", () => {
    const sliders = commands.flatMap((command) => command.kind === "slider" ? [command.model] : []);
    expect(sliders).toEqual(["pitch", "volume", "gap", "rate", "voicePitch", "loudness", "tension", "breathiness", "formant"]);
    expect(commands.find((command) => command.id === "synthesis")).toMatchObject({ action: "toggleSynthesis" });
    expect(RIBBON_GROUPS.find((group) => group.id === "export")?.commands.map((command) => command.id)).toEqual(["wav", "opus"]);
  });

  it("has a label and tip in every locale", async () => {
    vi.stubGlobal("document", { documentElement: {}, title: "", createElement: () => ({}) });
    const { i18n } = await import("../src/i18n");
    const keys = RIBBON_GROUPS.flatMap((group) => [group.label, ...(group.tip ? [group.tip] : []), ...group.commands.flatMap((command) => [command.label, ...(command.tip ? [command.tip] : [])])]);
    for (const locale of ["en", "zh"] as const) {
      const missing = keys.filter((key) => !i18n.global.te(key, locale));
      expect(missing, locale).toEqual([]);
    }
  });
});
