import type { IconName } from "./icons";
import { FIT_RANGE, type MarkerName, type ScopeName } from "./markup";
import type { Studio } from "./studio";

export type SliderModel = "pitch" | "volume" | "gap" | "rate" | "voicePitch" | "loudness" | "tension" | "breathiness" | "formant";

export type ActionId =
  | "render" | "cancel" | "toggleLive" | "toggleSynthesis" | "exportWav" | "exportOpus"
  | "toggleSideBar" | "togglePanel" | "toggleRibbon" | "showHelp" | "insertPhonemes" | "scope.fit"
  | `marker.${MarkerName}` | `scope.${ScopeName}`;

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

export interface SliderCommand extends CommandBase {
  kind: "slider";
  model: SliderModel;
  min: number;
  max: number;
  step: number;
}

export type RibbonCommand = ButtonCommand | NumberCommand | SliderCommand;
export interface RibbonGroup { id: string; label: string; /** i18n key of the group tooltip */ tip?: string; commands: RibbonCommand[] }

const canEdit: Predicate = (s) => Boolean(s.bank) && !s.encodingOpus;
const canRender: Predicate = (s) => s.hasText && !s.busy;

function marker(name: MarkerName, label: string, icon: IconName, size: "large" | "small" = "small"): ButtonCommand {
  return { id: `marker.${name}`, label, icon, action: `marker.${name}`, size, enabled: canEdit };
}
function scope(name: ScopeName, label: string, icon: IconName, size: "large" | "small" = "small"): ButtonCommand {
  return { id: `scope.${name}`, label, icon, action: `scope.${name}`, size, enabled: canEdit };
}
function slider(model: SliderModel, label: string, icon: IconName, min: number, max: number, step: number): SliderCommand {
  return { id: `slider.${model}`, kind: "slider", label, icon, model, min, max, step };
}

export const RIBBON_GROUPS: RibbonGroup[] = [
  { id: "render", label: "group.render", commands: [
    { id: "render", label: "cmd.render", icon: "play", action: "render", size: "large", tip: "tip.render", enabled: canRender },
    { id: "cancel", label: "cancel", icon: "stop", action: "cancel", enabled: (s) => s.busy },
    { id: "live", label: "liveRender", icon: "live", action: "toggleLive", pressed: (s) => s.liveRender, tip: "liveHelp" },
    { id: "synthesis", label: "unrecordedWords", icon: "phoneme", action: "toggleSynthesis", pressed: (s) => s.synthesizeUnrecorded, tip: "unrecordedHelp" },
  ] },
  { id: "export", label: "group.export", commands: [
    { id: "wav", label: "wavShort", icon: "download", action: "exportWav", size: "large", tip: "tip.wav", enabled: (s) => Boolean(s.downloadUrl) },
    { id: "opus", label: "opusShort", icon: "download", action: "exportOpus", size: "large", tip: "tip.opus", enabled: (s) => Boolean(s.rendered) && !s.busy || Boolean(s.opusUrl) },
  ] },
  { id: "markers", label: "group.markers", commands: [
    marker("start", "start", "flagStart", "large"), marker("end", "end", "flagEnd", "large"),
    marker("pause", "pause", "pause"), marker("clip", "clip", "clip"), scope("stutter", "stutter", "stutter"),
  ] },
  { id: "effects", label: "group.effects", commands: [
    scope("pitch", "pitch", "pitch"), scope("volume", "volume", "volume"), scope("rate", "rate", "rate"),
    scope("voice", "voice", "voice", "large"),
  ] },
  { id: "timing", label: "group.timing", commands: [
    scope("offset", "offset", "offset"), scope("duration", "duration", "duration"), scope("spacing", "spacing", "spacing"),
  ] },
  { id: "reading", label: "group.reading", commands: [
    { id: "fitSeconds", kind: "number", label: "fitSeconds", icon: "fit", model: "fitSeconds", ...FIT_RANGE, tip: "tip.fit" },
    { id: "fit", label: "fit", icon: "fit", action: "scope.fit", size: "large", tip: "tip.fit", enabled: canEdit },
  ] },
  { id: "phonemes", label: "group.phonemes", commands: [
    { id: "insertPhonemes", label: "insertPhonemes", icon: "phoneme", action: "insertPhonemes", size: "large", tip: "tip.phonemes", enabled: canEdit },
  ] },
  { id: "view", label: "group.view", commands: [
    { id: "sidebar", label: "sideBar", icon: "sidebar", action: "toggleSideBar", size: "large", pressed: (s) => s.sideBarOpen },
    { id: "panel", label: "panel", icon: "panel", action: "togglePanel", size: "large", pressed: (s) => s.panelOpen },
    { id: "ribbon", label: "ribbonToggle", icon: "ribbon", action: "toggleRibbon", size: "large", pressed: (s) => !s.ribbonCollapsed },
    { id: "help", label: "help", icon: "help", action: "showHelp", size: "large" },
  ] },
  { id: "mix", label: "group.mix", commands: [
    slider("pitch", "pitch", "pitch", 0.65, 1.35, 0.01),
    slider("volume", "volume", "volume", 0, 1, 0.01),
    slider("gap", "wordGap", "spacing", 0, 0.8, 0.01),
    slider("rate", "rate", "rate", 0.5, 2, 0.01),
  ] },
  { id: "processing", label: "group.processing", tip: "voiceHelp", commands: [
    slider("voicePitch", "voicePitch", "pitch", -12, 12, 0.1),
    slider("loudness", "loudness", "volume", -24, 12, 0.1),
    slider("tension", "tension", "tension", -1, 1, 0.01),
    slider("breathiness", "breathiness", "breath", 0, 1, 0.01),
    slider("formant", "formant", "formant", -6, 6, 0.1),
  ] },
];
