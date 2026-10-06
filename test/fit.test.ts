import { describe, expect, it } from 'vitest';
import { analyzeAnnouncement } from '../src/audio/engine';
import { OUTPUT_SAMPLE_RATE, stretchSpeechRate } from '../src/audio/dsp';
import { fitGroupsOf, solveFitRates } from '../src/audio/fit';
import type { FitItem } from '../src/audio/fit';
import { analyzeText, createWordPlan } from '../src/audio/parser';
import type { AnalysisOptions, Bank } from '../src/audio/types';

const bank: Bank = {
  version: '1',
  source: 'test fixture',
  clips: [
    ...['cassie', 'word', 'apple'].map((id) => ({ id, file: `/audio/${id}.opus`, duration: 0.5, kind: 'word' as const })),
    { id: 'chime', file: '/audio/chime.opus', duration: 0.3, kind: 'effect' as const },
  ],
};

const word = (speech = 0.5, extra: Partial<FitItem> = {}): FitItem => ({ kind: 'word', speech, fixed: 0, rate: 1, ...extra });

describe('fit tag parsing', () => {
  it('assigns one group to the enclosed words and restores the parent scope', () => {
    const { plan } = createWordPlan('cassie <fit seconds="2">word apple</fit> cassie', bank);
    expect(plan.map((item) => item.fits?.at(-1)?.seconds)).toEqual([undefined, 2, 2, undefined]);
    expect(plan[1].fit?.id).toBe(plan[2].fit?.id);
  });

  it.each(['0.04', '120.5', '0', '-1', 'abc', ''])('rejects seconds="%s"', (value) => {
    const result = analyzeText(`<fit seconds="${value}">cassie</fit>`, bank);
    expect(result.tokens[0].kind).toBe('error');
    expect(texts(result.notices).join(' ')).toContain('Invalid markup tag');
  });

  it.each(['0.05', '120'])('accepts the boundary seconds="%s"', (value) => {
    expect(createWordPlan(`<fit seconds="${value}">cassie</fit>`, bank).plan[0].fits?.at(-1)?.seconds).toBe(Number(value));
  });

  it('rejects unknown attributes and unclosed tags', () => {
    expect(analyzeText('<fit value="1">cassie</fit>', bank).tokens[0].kind).toBe('error');
    expect(texts(analyzeText('<fit seconds="1">cassie', bank).notices).join(' ')).toContain('Unclosed markup tag');
  });

  it('lets an inner group replace the outer one and keeps the rate tag independent', () => {
    const { plan } = createWordPlan('<fit seconds="3">cassie <fit seconds="1">word</fit> apple</fit>', bank);
    expect(plan.map((item) => item.fits?.at(-1)?.seconds)).toEqual([3, 1, 3]);
    expect(new Set(plan.map((item) => item.fits?.at(-1)?.id)).size).toBe(2);
    expect(createWordPlan('<fit seconds="1"><rate value="2">cassie</rate></fit>', bank).plan[0]).toMatchObject({ rate: 2, fits: [{ seconds: 1 }] });
  });

  it('leaves plans without the tag unchanged', () => {
    expect(createWordPlan('cassie word', bank).plan.every((item) => item.fit === undefined)).toBe(true);
    expect(fitGroupsOf(createWordPlan('cassie word', bank).plan).size).toBe(0);
  });
});

describe('fit rate solver', () => {
  const gap = 0.24;

  it('keeps gaps and finds the rate that lands on the requested span', () => {
    const items = [word(0.5, { fits: [1] }), word(0.5, { fits: [1] }), word(0.5, { fits: [1] })];
    const [result] = solveFitRates(items, new Map([[1, 1]]), gap);
    expect(result.rate).toBeCloseTo(1.5 / (1 - 2 * gap), 6);
    expect(result.clamped).toBe(false);
    expect(result.achievable).toBeCloseTo(1, 6);
  });

  it('excludes content outside the group and counts cues and pauses inside it', () => {
    const items: FitItem[] = [
      word(0.5),
      word(0.5, { fits: [1] }),
      { kind: 'pause', speech: 0, fixed: 0.2, rate: 1, fits: [1] },
      { kind: 'effect', speech: 0, fixed: 0.3, rate: 1, fits: [1] },
      word(0.5, { fits: [1] }),
      word(0.5),
    ];
    const [result] = solveFitRates(items, new Map([[1, 1.5]]), gap);
    // fixed: pause 0.2 + cue 0.3 + word-to-cue gap 0; pause-to-cue 0; cue-to-word 0; first word-to-pause 0
    expect(result.rate).toBeCloseTo(1 / (1.5 - 0.5), 6);
    expect(result.achievable).toBeCloseTo(1.5, 6);
  });

  it('uses spacing relative to the previous start', () => {
    const items = [word(0.5, { fits: [1] }), word(0.5, { fits: [1], spacing: 0.3 })];
    const [result] = solveFitRates(items, new Map([[1, 0.6]]), gap);
    expect(result.rate).toBeCloseTo(0.5 / 0.3, 6);
  });

  it('clamps to the supported range and reports the achievable span', () => {
    const items = [word(1, { fits: [1] })];
    const [fast] = solveFitRates(items, new Map([[1, 0.05]]), gap);
    expect(fast).toMatchObject({ rate: 4, clamped: true });
    expect(fast.achievable).toBeCloseTo(0.25, 6);
    const [slow] = solveFitRates(items, new Map([[1, 120]]), gap);
    expect(slow).toMatchObject({ rate: 0.25, clamped: true });
    expect(slow.achievable).toBeCloseTo(4, 6);
  });

  it('flags groups with nothing to stretch', () => {
    const [result] = solveFitRates([{ kind: 'effect', speech: 0, fixed: 0.3, rate: 1, fits: [1] }], new Map([[1, 1]]), gap);
    expect(result).toMatchObject({ rate: 1, clamped: true });
    expect(result.achievable).toBeCloseTo(0.3, 6);
  });

  it('solves inner groups first so outer groups account for their stretched length', () => {
    const items = [word(0.5, { fits: [1] }), word(0.5, { fits: [1, 2] }), word(0.5, { fits: [1] })];
    const results = solveFitRates(items, new Map([[1, 3], [2, 0.25]]), 0);
    expect(results.find((result) => result.id === 2)?.rate).toBeCloseTo(2, 6);
    expect(results.find((result) => result.id === 1)?.rate).toBeCloseTo(1 / 2.75, 6 - 3);
  });
});

describe('nested fit groups', () => {
  const gap = 0.24;
  const total = (items: FitItem[], results: ReturnType<typeof solveFitRates>) => {
    const rateOf = new Map(results.map((result) => [result.id, result.rate]));
    return items.reduce((sum, item, index) => sum + item.speech / (rateOf.get(item.fits?.at(-1) ?? 0) ?? item.rate) + item.fixed + (index ? gap : 0), 0);
  };

  it('records every enclosing group on each word', () => {
    const { plan } = createWordPlan('<fit seconds="3">cassie <fit seconds="1">word</fit></fit>', bank);
    expect(plan.map((item) => item.fits?.map((group) => group.seconds))).toEqual([[3], [3, 1]]);
  });

  it.each([
    ['at the end', [word(0.5, { fits: [1] }), word(0.5, { fits: [1, 2] })]],
    ['at the start', [word(0.5, { fits: [1, 2] }), word(0.5, { fits: [1] })]],
  ])('keeps the outer group on target with the inner group %s', (_, items) => {
    const results = solveFitRates(items, new Map([[1, 3], [2, 1]]), gap);
    expect(results.every((result) => !result.clamped || result.id === 2)).toBe(true);
    expect(total(items, results)).toBeCloseTo(3, 6);
  });

  it('solves an outer group that holds only inner groups without dropping it', () => {
    const items = [word(0.5, { fits: [1, 2] }), word(0.5, { fits: [1, 3] })];
    const results = solveFitRates(items, new Map([[1, 5], [2, 1], [3, 1]]), gap);
    expect(results.map((result) => result.id)).toEqual([1, 2, 3]);
    expect(results[0].clamped).toBe(true);
    expect(results[0].achievable).toBeCloseTo(2 + gap, 6);
  });

  it('solves a nested group covering the whole outer group inner first', () => {
    const items = [word(0.5, { fits: [1, 2] }), word(0.5, { fits: [1, 2] })];
    const results = solveFitRates(items, new Map([[1, 2], [2, 1]]), gap);
    expect(results.find((result) => result.id === 2)?.clamped).toBe(false);
    expect(results.find((result) => result.id === 1)?.clamped).toBe(true);
  });
});

describe('fit with spacing', () => {
  it('measures the span by the latest end, not the last word', () => {
    const items = [word(1, { fits: [1], spacing: 0.3 }), word(0.2, { fits: [1], spacing: 0.3 })];
    const [result] = solveFitRates(items, new Map([[1, 1]]), 0.24);
    // the first word sets the span: starts at 0, so 1 / rate = 1
    expect(result.rate).toBeCloseTo(1, 4);
    expect(result.clamped).toBe(false);
    expect(result.achievable).toBeCloseTo(1, 4);
  });
});

describe('fit output length', () => {
  const tone = (seconds: number) => Float32Array.from({ length: Math.round(seconds * OUTPUT_SAMPLE_RATE) }, (_, index) => 0.4 * Math.sin(index * 0.12));

  it.each([0.9, 1.2, 2.5])('renders three words in %s s within 50 ms', (target) => {
    const items = [word(0.5, { fits: [1] }), word(0.5, { fits: [1] }), word(0.5, { fits: [1] })];
    const [result] = solveFitRates(items, new Map([[1, target]]), 0.24);
    expect(result.clamped).toBe(false);
    const lengths = items.map(() => stretchSpeechRate(tone(0.5), OUTPUT_SAMPLE_RATE, result.rate).length / OUTPUT_SAMPLE_RATE);
    const total = lengths.reduce((sum, length) => sum + length, 0) + 2 * 0.24;
    expect(Math.abs(total - target)).toBeLessThan(0.05);
  });
});

const analysis = (text: string, extra: Partial<AnalysisOptions> = {}) => analyzeAnnouncement(text, bank, { phonemes: false, gap: 0.24, pitch: 1, rate: 1, ...extra });
const texts = (notices: Array<{ text: string }>) => notices.map((notice) => notice.text);

describe('fit warnings in analysis', () => {
  it('uses the supplied gap and pitch instead of the defaults', async () => {
    const text = '<fit seconds="0.3">cassie word</fit>';
    expect((await analysis(text)).notices).toHaveLength(1);
    expect((await analysis(text, { gap: 0 })).notices).toEqual([]);
    const pitched = await analysis('<fit seconds="0.1">cassie word</fit>', { pitch: 2 });
    expect(pitched.notices[0].text).toContain('0.36 s');
  });

  it('reports the requested and achievable duration when the rate is clamped', async () => {
    const result = await analysis('<fit seconds="0.1">cassie word</fit>');
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatchObject({ severity: 'warning' });
    expect(result.notices[0].text).toContain('0.10 s');
    expect(result.notices[0].text).toContain('4×');
  });

  it('counts stutter audio toward the estimate', async () => {
    expect((await analysis('<fit seconds="1"><stutter repeats="32" length="0.5">cassie</stutter></fit>')).notices).toHaveLength(1);
    expect((await analysis('<fit seconds="10"><stutter repeats="20" length="0.1">cassie</stutter></fit>')).notices).toEqual([]);
  });

  it('stays silent when the duration is reachable', async () => {
    expect((await analysis('<fit seconds="1">cassie word</fit>')).notices).toEqual([]);
  });

  it('treats cues as fixed time', async () => {
    expect((await analysis('<fit seconds="0.2"><clip id="chime"/> cassie</fit>')).notices).toHaveLength(1);
  });
});
