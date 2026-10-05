import { describe, expect, it } from "vitest";
import { ICONS } from "../src/icons";
import { FIT_RANGE, fitScope } from "../src/markup";
import { RIBBON_TABS } from "../src/ribbon";

describe("ribbon configuration", () => {
  it("has unique tab and group ids and only known icons", () => {
    expect(new Set(RIBBON_TABS.map((tab) => tab.id)).size).toBe(RIBBON_TABS.length);
    for (const tab of RIBBON_TABS) {
      expect(new Set(tab.groups.map((group) => group.id)).size).toBe(tab.groups.length);
      for (const group of tab.groups) {
        expect(group.commands.length).toBeGreaterThan(0);
        expect(new Set(group.commands.map((command) => command.id)).size).toBe(group.commands.length);
        for (const command of group.commands) expect(ICONS).toHaveProperty(command.icon);
      }
    }
  });

  it("offers the reading time controls in the timing tab", () => {
    const reading = RIBBON_TABS.find((tab) => tab.id === "timing")?.groups.find((group) => group.id === "reading");
    expect(reading?.commands.map((command) => command.id)).toEqual(["fitSeconds", "fit"]);
    expect(FIT_RANGE).toMatchObject({ min: 0.05, max: 120, default: 2 });
    expect(fitScope(2)).toEqual({ open: '<fit seconds="2">', close: "</fit>" });
  });
});
