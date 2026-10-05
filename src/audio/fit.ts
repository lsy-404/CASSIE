import { nextClipStart } from './dsp';
import type { Bank, ClipKind, WordPlan } from './types';

export const FIT_MIN_RATE = 0.25;
export const FIT_MAX_RATE = 4;
const DEFAULT_GAP = 0.24;

export interface FitItem {
  kind: ClipKind | 'pause';
  /** Seconds of stretchable speech at rate 1. */
  speech: number;
  /** Seconds that keep their duration (cues, pauses, gaps inside phrase recordings). */
  fixed: number;
  /** Rate applied when the item is outside every fit group. */
  rate: number;
  fit?: number;
  sleep?: number;
  spacing?: number;
  joinPrevious?: boolean;
}

export interface FitGroupResult {
  id: number;
  seconds: number;
  rate: number;
  achievable: number;
  clamped: boolean;
}

function layoutSpan(items: FitItem[], first: number, last: number, gap: number, rateOf: (item: FitItem) => number): number {
  let previousEnd = 0;
  let previousStart = 0;
  let previousKind: FitItem['kind'] | undefined;
  let spanStart = 0;
  for (let index = first; index <= last; index += 1) {
    const item = items[index];
    const sleep = item.sleep ?? 0;
    const start = Math.max(0, item.joinPrevious && item.kind !== 'pause'
      ? previousEnd
      : item.spacing !== undefined
        ? previousStart + item.spacing + sleep
        : nextClipStart(previousEnd, previousKind, item.kind, gap, sleep));
    if (index === first) spanStart = start;
    previousEnd = start + item.speech / rateOf(item) + item.fixed;
    previousStart = start;
    previousKind = item.kind;
  }
  return previousEnd - spanStart;
}

/** Solves each group's rate so its layout span, with unstretched parts kept, equals the requested seconds. */
export function solveFitRates(items: FitItem[], groups: ReadonlyMap<number, number>, gap: number): FitGroupResult[] {
  const solved = new Map<number, number>();
  const ranges = [...groups.keys()].flatMap((id) => {
    const owners = items.map((item) => item.fit);
    const first = owners.indexOf(id);
    const last = owners.lastIndexOf(id);
    return first < 0 ? [] : [{ id, first, last }];
  }).sort((left, right) => left.last - left.first - (right.last - right.first) || left.id - right.id);
  const results: FitGroupResult[] = [];
  for (const { id, first, last } of ranges) {
    const seconds = groups.get(id)!;
    const spanAt = (rate: number) => layoutSpan(items, first, last, gap, (item) =>
      item.fit === id ? rate : item.fit !== undefined ? solved.get(item.fit) ?? item.rate : item.rate);
    const fixedSpan = spanAt(Infinity);
    const natural = spanAt(1);
    const stretchable = natural - fixedSpan;
    const noSpeech = stretchable <= 1e-6;
    const wanted = noSpeech ? 1 : seconds > fixedSpan ? stretchable / (seconds - fixedSpan) : Infinity;
    const rate = Math.min(FIT_MAX_RATE, Math.max(FIT_MIN_RATE, wanted));
    solved.set(id, rate);
    results.push({ id, seconds, rate, achievable: noSpeech ? natural : fixedSpan + stretchable / rate, clamped: noSpeech ? Math.abs(natural - seconds) > 0.005 : rate !== wanted });
  }
  return results.sort((left, right) => left.id - right.id);
}

export function fitGroupsOf(plan: WordPlan[]): Map<number, number> {
  const groups = new Map<number, number>();
  for (const word of plan) if (word.fit) groups.set(word.fit.id, word.fit.seconds);
  return groups;
}

export function fitWarning(result: FitGroupResult): string {
  return `Reading duration of ${result.seconds.toFixed(2)} s cannot be met; the closest achievable is ${result.achievable.toFixed(2)} s at ${result.rate}× speech rate.`;
}

/** Approximates the render-time warnings from bank metadata so analysis can report them before rendering. */
export function estimateFitWarnings(plan: WordPlan[], bank: Bank, gap = DEFAULT_GAP, pitch = 1, globalRate = 1): string[] {
  const groups = fitGroupsOf(plan);
  if (!groups.size) return [];
  const clips = new Map(bank.clips.map((clip) => [clip.id, clip]));
  const items = plan.map((word): FitItem => {
    const base = {
      rate: (word.rate ?? 1) * globalRate,
      ...(word.fit ? { fit: word.fit.id } : {}),
      ...(word.sleep !== undefined ? { sleep: word.sleep } : {}),
      ...(word.spacing !== undefined ? { spacing: word.spacing } : {}),
      ...(word.joinPrevious ? { joinPrevious: true } : {}),
    };
    if (word.pauseDuration !== undefined) return { ...base, kind: 'pause', speech: 0, fixed: word.pauseDuration };
    const sourceSeconds = word.phonemeUnits?.length
      ? word.phonemeUnits.reduce((sum, unit) => sum + (unit.endSeconds - unit.startSeconds) * (unit.stretchFactor ?? 1), 0)
      : [...(word.prefixClipIds ?? []), word.clipId, ...(word.suffixClipIds ?? [])].reduce((sum, id) => sum + (clips.get(id)?.duration ?? 0), 0);
    const start = Math.min(sourceSeconds, word.startAt ?? 0);
    const total = Math.min(sourceSeconds - start, word.maxDuration ?? Infinity) / (word.pitch * pitch);
    if (clips.get(word.clipId)?.kind !== 'word') return { ...base, kind: 'effect', speech: 0, fixed: total };
    const timings = [...(word.sourceWordTimings ?? [])].sort((left, right) => left.startSeconds - right.startSeconds);
    const gaps = timings.slice(1).reduce((sum, timing, index) => sum + Math.max(0, timing.startSeconds - timings[index].endSeconds), 0) / (word.pitch * pitch);
    return { ...base, kind: 'word', speech: Math.max(0, total - gaps), fixed: Math.min(total, gaps) };
  });
  return solveFitRates(items, groups, gap).filter((result) => result.clamped).map(fitWarning);
}
