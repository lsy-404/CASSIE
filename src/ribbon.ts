import type { IconName } from "./icons";
import { FIT_RANGE, type MarkerName, type ScopeName, type SettingId } from "./markup";
import type { SideView, Studio } from "./studio";

export type ActionId =
  | "render" | "cancel" | "toggleLive" | "exportWav" | "exportOpus"
  | "toggleSideBar" | "togglePanel" | "toggleRibbon" | "insertPhonemes" | "scope.fit"
  | `marker.${MarkerName}` | `scope.${ScopeName}` | `view.${SideView}` | `setting.${SettingId}`;

type Predicate = (studio: Studio) => boolean;

interface CommandBase {
  id: string;
  /** i18n key of the visible label */
  label: string;
  icon: IconName;
  /** i18n key of the tooltip */
  tip?: string;
  enabled?: Predicate;
}

export interface ButtonCommand extends CommandBase {
  kind?: "button";
  action: ActionId;
  size?: "large" | "small";
  pressed?: Predicate;
}

export interface NumberCommand extends CommandBase {
  kind: "number";
  model: "fitSeconds";
  min: number;
  max: number;
  step: number;
  default: number;
}

export type RibbonCommand = ButtonCommand | NumberCommand;
export interface RibbonGroup { id: string; label: string; commands: RibbonCommand[] }
export interface RibbonTab { id: string; label: string; groups: RibbonGroup[] }

const canEdit: Predicate = (s) => Boolean(s.bank) && !s.encodingOpus;
const canRender: Predicate = (s) => s.hasText && !s.busy;

function marker(name: MarkerName, label: string, icon: IconName, size: "large" | "small" = "small"): ButtonCommand {
  return { id: `marker.${name}`, label, icon, action: `marker.${name}`, size, enabled: canEdit };
}
function scope(name: ScopeName, label: string, icon: IconName, size: "large" | "small" = "small"): ButtonCommand {
  return { id: `scope.${name}`, label, icon, action: `scope.${name}`, size, enabled: canEdit };
}
function setting(id: SettingId, label: string, icon: IconName, size: "large" | "small" = "small"): ButtonCommand {
  return { id: `setting.${id}`, label, icon, action: `setting.${id}`, size, tip: "tip.setting" };
}

const renderCommand: ButtonCommand = { id: "render", label: "cmd.render", icon: "play", action: "render", size: "large", tip: "tip.render", enabled: canRender };
const cancelCommand: ButtonCommand = { id: "cancel", label: "cancel", icon: "stop", action: "cancel", enabled: (s) => s.busy };
const phonemeCommand: ButtonCommand = { id: "insertPhonemes", label: "insertPhonemes", icon: "phoneme", action: "insertPhonemes", size: "large", tip: "tip.phonemes", enabled: canEdit };

export const RIBBON_TABS: RibbonTab[] = [
  {
    id: "home", label: "ribbon.home",
    groups: [
      { id: "render", label: "group.render", commands: [
        renderCommand, cancelCommand,
        { id: "live", label: "liveRender", icon: "live", action: "toggleLive", pressed: (s) => s.liveRender, tip: "liveHelp" },
      ] },
      { id: "markers", label: "group.markers", commands: [
        marker("start", "start", "flagStart", "large"), marker("end", "end", "flagEnd", "large"),
        marker("pause", "pause", "pause"), scope("stutter", "stutter", "stutter"),
      ] },
      { id: "effects", label: "group.effects", commands: [
        scope("pitch", "pitch", "pitch"), scope("volume", "volume", "volume"), scope("rate", "rate", "rate"),
      ] },
    ],
  },
  {
    id: "insert", label: "ribbon.insert",
    groups: [
      { id: "markers", label: "group.markers", commands: [
        marker("start", "start", "flagStart", "large"), marker("end", "end", "flagEnd", "large"),
        marker("pause", "pause", "pause"), marker("clip", "clip", "clip"),
      ] },
      { id: "effects", label: "group.effects", commands: [
        scope("stutter", "stutter", "stutter"), scope("pitch", "pitch", "pitch"),
        scope("volume", "volume", "volume"), scope("rate", "rate", "rate"),
      ] },
      { id: "timing", label: "group.timing", commands: [
        scope("offset", "offset", "offset"), scope("duration", "duration", "duration"), scope("spacing", "spacing", "spacing"),
      ] },
      { id: "voice", label: "group.voice", commands: [scope("voice", "voice", "voice", "large")] },
      { id: "phonemes", label: "group.phonemes", commands: [phonemeCommand] },
    ],
  },
  {
    id: "voice", label: "ribbon.voice",
    groups: [
      { id: "mix", label: "group.mix", commands: [
        setting("pitch", "pitch", "pitch", "large"), setting("volume", "volume", "volume", "large"),
        setting("gap", "wordGap", "spacing", "large"), setting("rate", "rate", "rate", "large"),
      ] },
      { id: "processing", label: "group.processing", commands: [
        setting("voicePitch", "voicePitch", "pitch"), setting("loudness", "loudness", "volume"), setting("tension", "tension", "tension"),
        setting("breathiness", "breathiness", "breath"), setting("formant", "formant", "formant"),
      ] },
      { id: "voice", label: "group.voice", commands: [scope("voice", "voice", "voice", "large")] },
    ],
  },
  {
    id: "timing", label: "ribbon.timing",
    groups: [
      { id: "pauses", label: "group.pauses", commands: [
        marker("pause", "pause", "pause", "large"),
        scope("offset", "offset", "offset"), scope("duration", "duration", "duration"), scope("spacing", "spacing", "spacing"),
      ] },
      { id: "speed", label: "group.speed", commands: [scope("rate", "rate", "rate", "large"), setting("gap", "wordGap", "spacing", "large")] },
      { id: "reading", label: "group.reading", commands: [
        { id: "fitSeconds", kind: "number", label: "fitSeconds", icon: "fit", model: "fitSeconds", ...FIT_RANGE, tip: "tip.fit" },
        { id: "fit", label: "fit", icon: "fit", action: "scope.fit", size: "large", tip: "tip.fit", enabled: canEdit },
      ] },
    ],
  },
  {
    id: "export", label: "ribbon.export",
    groups: [
      { id: "render", label: "group.render", commands: [renderCommand, cancelCommand] },
      { id: "download", label: "group.download", commands: [
        { id: "wav", label: "wavShort", icon: "download", action: "exportWav", size: "large", enabled: (s) => Boolean(s.downloadUrl) },
        { id: "opus", label: "opusShort", icon: "download", action: "exportOpus", size: "large", enabled: (s) => Boolean(s.rendered) && !s.busy || Boolean(s.opusUrl) },
      ] },
    ],
  },
  {
    id: "view", label: "ribbon.view",
    groups: [
      { id: "layout", label: "group.layout", commands: [
        { id: "sidebar", label: "sideBar", icon: "sidebar", action: "toggleSideBar", size: "large", pressed: (s) => s.sideBarOpen },
        { id: "panel", label: "panel", icon: "panel", action: "togglePanel", size: "large", pressed: (s) => s.panelOpen },
        { id: "ribbon", label: "ribbonToggle", icon: "ribbon", action: "toggleRibbon", size: "large", pressed: (s) => !s.ribbonCollapsed },
      ] },
      { id: "views", label: "group.views", commands: [
        { id: "outline", label: "outline", icon: "outline", action: "view.outline" },
        { id: "phonemes", label: "phonemeList", icon: "phoneme", action: "view.phonemes" },
        { id: "settings", label: "settings", icon: "sliders", action: "view.settings" },
      ] },
      { id: "help", label: "group.help", commands: [{ id: "help", label: "help", icon: "help", action: "view.help", size: "large" }] },
    ],
  },
];
