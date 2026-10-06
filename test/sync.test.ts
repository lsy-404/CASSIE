import { beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeText, createWordPlan } from '../src/audio/parser';
import { fitOwnersOf, solveFitRates } from '../src/audio/fit';
import type { FitItem } from '../src/audio/fit';
import type { PhonemeCatalog } from '../src/audio/phonemes';
import type { Bank, RenderOptions, TimelineEntry } from '../src/audio/types';

vi.mock('ogg-opus-decoder', () => ({
  OggOpusDecoder: class {
    ready = Promise.resolve();
    async decodeFile(bytes: Uint8Array) {
      const samples = Math.round(Number(new TextDecoder().decode(bytes)) * 48_000);
      return { errors: [], channelData: [Float32Array.from({ length: samples }, (_, index) => 0.2 * Math.sin(index / 20))] };
    }
    async reset() {}
    free() {}
  },
}));
vi.mock('../src/audio/world', () => ({ createWorldVocoder: vi.fn() }));

const bank: Bank = {
  version: '1',
  source: 'test fixture',
  clips: [
    ...['cassie', 'word', 'apple'].map((id) => ({ id, file: `/audio/${id}.opus`, duration: 0.5, kind: 'word' as const })),
    { id: 'chime', file: '/audio/chime.opus', duration: 0.3, kind: 'effect' as const },
    { id: 'phone-j', file: '/audio/phone-j.opus', duration: 0.1, kind: 'word', sha256: 'c'.repeat(64) },
  ],
};

const catalog: PhonemeCatalog = {
  schemaVersion: 2,
  sourceBank: { version: bank.version, sha256: 'e'.repeat(64) },
  phones: {
    j: [{ clipId: 'phone-j', ipa: 'j', startSeconds: 0.01, endSeconds: 0.09, sourceDurationSeconds: 0.1, sourceSha256: 'c'.repeat(64), position: 'single', previousIpa: null, nextIpa: null }],
  },
};

const options: RenderOptions = {
  pitch: 1, volume: 1, gap: 0.24, rate: 1, phonemes: true,
  voice: { pitchSemitones: 0, breathiness: 0, formantSemitones: 0, loudnessDb: 0, tension: 0 },
};
const phonemized = new Map([['newword', 'j']]);
const GAP = 0.24;

type Message = { type: string; duration?: number; samples?: Float32Array; timeline?: TimelineEntry[]; message?: string };
const scope = { location: { origin: 'http://localhost' }, postMessage: (_message: Message) => {}, onmessage: null as null | ((event: { data: unknown }) => Promise<void>) };

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  vi.stubGlobal('fetch', async (url: URL) => {
    const clip = bank.clips.find((candidate) => candidate.file === url.pathname)!;
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(String(clip.duration)).buffer };
  });
  await import('../src/audio/render.worker');
});

async function render(text: string, extra: Partial<RenderOptions> = {}) {
  const plan = createWordPlan(text, bank, undefined, catalog, phonemized, true).plan;
  const sent: Message[] = [];
  scope.postMessage = (message) => { sent.push(message); };
  await scope.onmessage!({ data: { type: 'render', bank, plan, options: { ...options, ...extra } } });
  const done = sent.find((message) => message.type === 'done');
  if (!done) throw new Error(sent.find((message) => message.type === 'error')?.message ?? 'no result');
  return { duration: done.duration!, samples: done.samples!, timeline: done.timeline!, previews: sent.filter((message) => message.type === 'preview') };
}

const words = (timeline: TimelineEntry[], track?: number) => timeline.filter((entry) => entry.kind === 'word' && (track === undefined || entry.track === track));
const starts = (timeline: TimelineEntry[], track: number) => words(timeline, track).map((entry) => Number(entry.startSeconds.toFixed(3)));
const texts = (notices: Array<{ text: string }>) => notices.map((notice) => notice.text);

describe('sync tag parsing', () => {
  it('puts enclosed items on a numbered track and restores the main track after the closing tag', () => {
    const { plan } = createWordPlan('cassie <sync>word</sync> apple', bank);
    expect(plan.map((item) => item.track ?? 0)).toEqual([0, 1, 0]);
    expect(plan[1].parentTrack).toBe(0);
    expect(createWordPlan('cassie word', bank).plan.every((item) => item.track === undefined)).toBe(true);
  });

  it('numbers sibling and nested blocks and anchors each to its parent track', () => {
    const { plan } = createWordPlan('<sync>cassie <sync>word</sync></sync> <sync>apple</sync> cassie', bank);
    expect(plan.map((item) => [item.track ?? 0, item.parentTrack])).toEqual([[1, 0], [2, 1], [3, 0], [0, undefined]]);
  });

  it('anchors a nested block past a parent track that plays nothing', () => {
    const { plan } = createWordPlan('<sync><sync>word</sync></sync>', bank);
    expect(plan[0]).toMatchObject({ track: 2, parentTrack: 0 });
  });

  it('inherits enclosing pitch, volume, rate and voice', () => {
    const { plan } = createWordPlan('<pitch value="1.2"><volume value="0.5"><rate value="1.5"><voice pitch="3">cassie <sync>word</sync></voice></rate></volume></pitch>', bank);
    expect(plan[1]).toMatchObject({ track: 1, pitch: 1.2, volume: 0.5, rate: 1.5, voice: { pitchSemitones: 3 } });
  });

  it('lets scoped tags inside the block override without leaking out', () => {
    const { plan } = createWordPlan('<sync><voice formant="-2"><pitch value="0.8">cassie</pitch></voice> word</sync> apple', bank);
    expect(plan.map((item) => [item.pitch, item.voice?.formantSemitones])).toEqual([[0.8, -2], [1, undefined], [1, undefined]]);
  });

  it('marks the tags as markers and rejects attributes and self-closing', () => {
    const ok = analyzeText('cassie <sync>word</sync>', bank);
    expect(ok.tokens.map((token) => token.kind)).toEqual(['recorded', 'marker', 'recorded', 'marker']);
    expect(ok.notices).toEqual([]);
    for (const text of ['<sync value="1">word</sync>', '<sync/>word']) {
      const result = analyzeText(text, bank);
      expect(result.tokens[0].kind).toBe('error');
      expect(texts(result.notices).join(' ')).toContain('Invalid markup tag');
    }
  });

  it('reports an unclosed block with a fix that removes the opening tag', () => {
    const result = analyzeText('cassie <sync>word', bank);
    expect(texts(result.notices).join(' ')).toContain('Unclosed markup tag: <sync>');
    expect(result.tokens[1]).toMatchObject({ kind: 'error', fix: { replacement: '' } });
    expect(analyzeText('cassie word', bank).notices).toEqual([]);
  });

  it('fixes a stray closing tag the same way as other pairs', () => {
    const result = analyzeText('cassie </sync>', bank);
    expect(result.tokens[1]).toMatchObject({ kind: 'error', fix: { replacement: '' } });
    expect(analyzeText('<sync>cassie</pitch>', bank).tokens[2].fix).toEqual({ replacement: '</sync>' });
  });

  it('accepts nesting up to the shared depth limit', () => {
    const deep = (levels: number) => `${'<sync>'.repeat(levels)}cassie${'</sync>'.repeat(levels)}`;
    expect(analyzeText(deep(32), bank).notices).toEqual([]);
    expect(texts(analyzeText(deep(33), bank).notices).join(' ')).toContain('nesting exceeds');
  });

  it('blocks unrecorded words in a sync block when synthesis is off', () => {
    const strict = createWordPlan('cassie <sync>newword</sync>', bank, undefined, catalog, phonemized, true, true);
    expect(strict.plan.map((item) => item.display)).toEqual(['cassie']);
    expect(strict.tokens[2]).toMatchObject({ kind: 'synthesized', blocked: true });
    const open = createWordPlan('cassie <sync>newword</sync>', bank, undefined, catalog, phonemized, true);
    expect(open.plan[1]).toMatchObject({ track: 1 });
    expect(open.plan[1].phonemeUnits).toHaveLength(1);
  });
});

describe('sync fit ownership', () => {
  it('records the track a fit group opened on', () => {
    const { plan } = createWordPlan('<fit seconds="2">cassie <sync>word <fit seconds="1">apple</fit></sync></fit>', bank);
    expect(plan[1].fits).toEqual([{ id: 1, seconds: 2, track: 0 }]);
    expect(plan[2].fits?.map((group) => group.track)).toEqual([0, 1]);
    expect([...fitOwnersOf(plan)]).toEqual([[1, 0], [2, 1]]);
  });

  it('measures only the owning track', () => {
    const items: FitItem[] = [
      { kind: 'word', speech: 0.5, fixed: 0, rate: 1, fits: [1] },
      { kind: 'word', speech: 3, fixed: 0, rate: 1, fits: [1], track: 1 },
      { kind: 'word', speech: 0.5, fixed: 0, rate: 1, fits: [1] },
    ];
    const [result] = solveFitRates(items, new Map([[1, 2]]), GAP, new Map([[1, 0]]));
    expect(result.achievable).toBeCloseTo(2, 3);
    expect(result.rate).toBeCloseTo(1 / (2 - GAP), 2);
  });
});

describe('sync rendering', () => {
  it('starts the block where the next main item starts and leaves the main cursor alone', async () => {
    const plain = await render('cassie apple');
    const synced = await render('cassie <sync>word</sync> apple');
    expect(starts(synced.timeline, 1)).toEqual([0.5 + GAP]);
    expect(starts(synced.timeline, 0)).toEqual(starts(plain.timeline, 0));
    expect(starts(synced.timeline, 1)[0]).toBe(starts(synced.timeline, 0)[1]);
    expect(synced.duration).toBeCloseTo(plain.duration, 3);
  });

  it('starts at zero when the block opens the text', async () => {
    const { timeline } = await render('<sync>word</sync> cassie');
    expect(starts(timeline, 1)).toEqual([0]);
    expect(starts(timeline, 0)).toEqual([0]);
  });

  it('runs the block at its own pace and lets the longest track set the total', async () => {
    const { timeline, duration } = await render('cassie <sync>word apple word</sync> cassie');
    expect(starts(timeline, 1)).toEqual([0.74, 1.48, 2.22]);
    expect(starts(timeline, 0)).toEqual([0, 0.74]);
    expect(duration).toBeCloseTo(0.74 + 0.5 * 3 + GAP * 2, 3);
    const trailing = await render('cassie <sync>word</sync>');
    expect(trailing.duration).toBeCloseTo(0.5 + GAP + 0.5, 3);
  });

  it('anchors nested blocks at their parent track position', async () => {
    const { timeline } = await render('cassie <sync>word <sync>apple</sync> cassie</sync> apple');
    expect(starts(timeline, 1)).toEqual([0.74, 1.48]);
    expect(starts(timeline, 2)).toEqual([1.48]);
    expect(starts(timeline, 0)).toEqual([0, 0.74]);
  });

  it('applies spacing from the start of the item the block follows', async () => {
    const { timeline } = await render('cassie <sync><spacing seconds="0.1">word apple</spacing></sync> apple');
    expect(starts(timeline, 1)).toEqual([0.1, 0.2]);
  });

  it('orders entries by start time across tracks and carries the track in previews', async () => {
    const { timeline, previews } = await render('cassie <sync>word</sync> apple');
    expect(timeline.map((entry) => entry.startSeconds)).toEqual([...timeline.map((entry) => entry.startSeconds)].sort((left, right) => left - right));
    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) expect(preview.timeline!.every((entry) => typeof entry.track === 'number')).toBe(true);
    expect(timeline.some((entry) => entry.track === 1 && entry.startSeconds < timeline.find((other) => other.track === 0 && other.startSeconds > 0.7)!.endSeconds)).toBe(true);
  });

  it('flags recorded and synthesized word entries per track', async () => {
    const { timeline } = await render('cassie <sync>newword</sync> word');
    expect(words(timeline, 0).map((entry) => entry.provenance)).toEqual(['recorded', 'recorded']);
    expect(words(timeline, 1).map((entry) => entry.provenance)).toEqual(['synthesized']);
    expect(timeline.filter((entry) => entry.kind !== 'word').every((entry) => entry.provenance === undefined)).toBe(true);
  });

  it('counts only main-track time in a fit group while the block follows its rate', async () => {
    const { timeline } = await render('<fit seconds="2">word <sync>apple apple</sync> cassie</fit>');
    const main = words(timeline, 0);
    expect(main.at(-1)!.endSeconds - main[0].startSeconds).toBeCloseTo(2, 1);
    const sync = words(timeline, 1);
    expect(sync[0].endSeconds - sync[0].startSeconds).toBeGreaterThan(0.5);
  });

  it('repeats a stutter inside the block on its own track only', async () => {
    const { timeline } = await render('cassie <sync><stutter repeats="2">word</stutter></sync> apple');
    expect(words(timeline, 1)).toHaveLength(3);
    expect(words(timeline, 0)).toHaveLength(2);
    expect(starts(timeline, 0)).toEqual([0, 0.74]);
  });

  it('repeats a block together with the main track when the stutter encloses it', async () => {
    const { timeline } = await render('<stutter repeats="1">cassie <sync>word</sync> apple</stutter>');
    expect(words(timeline, 0)).toHaveLength(4);
    expect(words(timeline, 1)).toHaveLength(2);
  });

  it('mixes tracks additively', async () => {
    const solo = await render('cassie');
    const doubled = await render('<sync>cassie</sync> cassie');
    expect(doubled.duration).toBeCloseTo(solo.duration, 3);
    const peak = (samples: Float32Array) => samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
    expect(peak(doubled.samples) / peak(solo.samples)).toBeCloseTo(2, 2);
  });

  it('does not add silence when a nested stutter sits inside a stutter holding a longer sync block', async () => {
    const plain = await render('<stutter repeats="1">cassie <sync>word apple word</sync> apple</stutter>');
    const nested = await render('<stutter repeats="1">cassie <sync>word apple word</sync> <stutter repeats="1">apple</stutter></stutter>');
    expect(plain.duration).toBeCloseTo(5.44, 2);
    expect(nested.duration).toBeCloseTo(5.44, 2);
    expect(starts(nested.timeline, 0).find((start) => start > 2)).toBeCloseTo(2.72, 2);
  });

  it('repeats earlier main-track items when a sync block opens the stutter', async () => {
    const { timeline } = await render('cassie <stutter repeats="1"><sync>word</sync> <clip id="chime"></stutter>');
    expect(timeline.filter((entry) => entry.kind === 'cue')).toHaveLength(2);
  });

  it('soft limits overlapping near-full-scale tracks instead of hard clamping', async () => {
    const { samples } = await render('<sync>cassie</sync> cassie', { volume: 2.5 });
    const peak = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThan(1);
  });

  it('does not join word halves across a sync boundary', () => {
    const { plan } = createWordPlan('<sync>new</sync>word', bank, undefined, catalog, phonemized, true);
    expect(plan.some((item) => item.joinPrevious)).toBe(false);
  });
});
