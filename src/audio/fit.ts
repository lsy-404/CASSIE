import { nextClipStart } from './dsp';
import type { Bank, ClipKind, WordPlan } from './types';

export const FIT_MIN_RATE = 0.25;
export const FIT_MAX_RATE = 4;
export const DEFAULT_GAP = 0.24;

export interface FitItem {
  kind: ClipKind | 'pause';
  /** Seconds of stretchable speech at rate 1. */
  speech: number;
  /** Seconds that keep their duration (cues, pauses, gaps inside phrase recordings). */
  fixed: number;
  /** Rate applied when the item is outside every fit group. */
  rate: number;
  /** Enclosing fit group ids, outermost first; the last one sets the item's rate. */
  fits?: number[];
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

export type FitMeasure = { pause: number } | { kind: ClipKind; total: number; gaps: number };

export function fitItemOf(word: WordPlan, globalRate: number, measure: FitMeasure): FitItem {
  const base = {
    rate: (word.rate ?? 1) * globalRate,
    ...(word.fits ? { fits: word.fits.map((group) => group.id) } : {}),
    ...(word.sleep !== undefined ? { sleep: word.sleep } : {}),
    ...(word.spacing !== undefined ? { spacing: word.spacing } : {}),
    ...(word.joinPrevious ? { joinPrevious: true } : {}),
  };
  if ('pause' in measure) return { ...base, kind: 'pause', speech: 0, fixed: Number.isFinite(measure.pause) ? measure.pause : 0 };
  if (measure.kind !== 'word') return { ...base, kind: 'effect', speech: 0, fixed: measure.total };
  return { ...base, kind: 'word', speech: Math.max(0, measure.total - measure.gaps), fixed: Math.min(measure.total, measure.gaps) };
}

function layoutSpan(items: FitItem[], first: number, last: number, gap: number, rateOf: (item: FitItem) => number): number {
  let previousEnd = 0;
  let previousStart = 0;
  let previousKind: FitItem['kind'] | undefined;
  let spanStart = 0;
  let spanEnd = 0;
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
    spanEnd = Math.max(spanEnd, previousEnd);
  }
  return spanEnd - spanStart;
}

/** Solves each group's rate so its layout span, with unstretched parts kept, equals the requested seconds. */
export function solveFitRates(items: FitItem[], groups: ReadonlyMap<number, number>, gap: number): FitGroupResult[] {
  const solved = new Map<number, number>();
  const ranges = [...groups.keys()].flatMap((id) => {
    const inside = items.flatMap((item, index) => item.fits?.includes(id) ? [index] : []);
    return inside.length ? [{ id, first: inside[0], last: inside[inside.length - 1] }] : [];
  }).sort((left, right) => left.last - left.first - (right.last - right.first) || right.id - left.id);
  const results: FitGroupResult[] = [];
  for (const { id, first, last } of ranges) {
    const seconds = groups.get(id)!;
    const spanAt = (rate: number) => layoutSpan(items, first, last, gap, (item) => {
      const own = item.fits?.at(-1);
      return own === id ? rate : own !== undefined ? solved.get(own) ?? item.rate : item.rate;
    });
    const natural = spanAt(1);
    const noSpeech = natural - spanAt(Infinity) <= 1e-6;
    let rate = 1;
    let achievable = natural;
    let clamped = Math.abs(natural - seconds) > 0.005;
    if (!noSpeech) {
      const fastest = spanAt(FIT_MAX_RATE);
      const slowest = spanAt(FIT_MIN_RATE);
      if (fastest >= seconds) { rate = FIT_MAX_RATE; achievable = fastest; clamped = fastest - seconds > 1e-9; }
      else if (slowest <= seconds) { rate = FIT_MIN_RATE; achievable = slowest; clamped = seconds - slowest > 1e-9; }
      else {
        let low = FIT_MIN_RATE;
        let high = FIT_MAX_RATE;
        for (let step = 0; step < 60; step += 1) {
          const middle = Math.sqrt(low * high);
          if (spanAt(middle) > seconds) low = middle; else high = middle;
        }
        rate = Math.sqrt(low * high);
        achievable = spanAt(rate);
        clamped = false;
      }
    }
    solved.set(id, rate);
    results.push({ id, seconds, rate, achievable, clamped });
  }
  return results.sort((left, right) => left.id - right.id);
}

export function fitGroupsOf(plan: WordPlan[]): Map<number, number> {
  const groups = new Map<number, number>();
  for (const word of plan) for (const group of word.fits ?? []) groups.set(group.id, group.seconds);
  return groups;
}

export function fitWarning(result: FitGroupResult): string {
  return `Reading duration of ${result.seconds.toFixed(2)} s cannot be met; the closest achievable is ${result.achievable.toFixed(2)} s at ${result.rate}× speech rate.`;
}

/** Approximates the render-time warnings from bank metadata so analysis can report them before rendering. */
export function estimateFitWarnings(plan: WordPlan[], bank: Bank, options: { gap: number; pitch: number; rate: number }): string[] {
  const groups = fitGroupsOf(plan);
  if (!groups.size) return [];
  const clips = new Map(bank.clips.map((clip) => [clip.id, clip]));
  const items = plan.map((word): FitItem => {
    if (word.pauseDuration !== undefined) return fitItemOf(word, options.rate, { pause: word.pauseDuration });
    const sourceSeconds = word.phonemeUnits?.length
      ? word.phonemeUnits.reduce((sum, unit) => sum + (unit.endSeconds - unit.startSeconds) * (unit.stretchFactor ?? 1), 0)
      : [...(word.prefixClipIds ?? []), word.clipId, ...(word.suffixClipIds ?? [])].reduce((sum, id) => sum + (clips.get(id)?.duration ?? 0), 0);
    const start = Math.min(sourceSeconds, word.startAt ?? 0);
    const total = Math.min(sourceSeconds - start, word.maxDuration ?? Infinity) / (word.pitch * options.pitch);
    const timings = [...(word.sourceWordTimings ?? [])].sort((left, right) => left.startSeconds - right.startSeconds);
    const gaps = timings.slice(1).reduce((sum, timing, index) => sum + Math.max(0, timing.startSeconds - timings[index].endSeconds), 0) / (word.pitch * options.pitch);
    return fitItemOf(word, options.rate, { kind: clips.get(word.clipId)?.kind ?? 'effect', total, gaps });
  });
  return solveFitRates(items, groups, options.gap).filter((result) => result.clamped).map(fitWarning);
}
