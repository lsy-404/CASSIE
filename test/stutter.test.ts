import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyStutter } from '../src/audio/dsp';
import { analyzeText, createWordPlan } from '../src/audio/parser';
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
const phonemized = new Map([['newword', 'jj'], ['new', 'j'], ['solo', 'j']]);

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

async function render(text: string) {
  const plan = createWordPlan(text, bank, undefined, catalog, phonemized, true).plan;
  const sent: Message[] = [];
  scope.postMessage = (message) => { sent.push(message); };
  await scope.onmessage!({ data: { type: 'render', bank, plan, options } });
  const done = sent.find((message) => message.type === 'done');
  if (!done) throw new Error(sent.find((message) => message.type === 'error')?.message ?? 'no result');
  return { duration: done.duration!, samples: done.samples!, timeline: done.timeline! };
}

const words = (timeline: TimelineEntry[]) => timeline.filter((entry) => entry.kind === 'word');
const lengths = (timeline: TimelineEntry[]) => words(timeline).map((entry) => Number((entry.endSeconds - entry.startSeconds).toFixed(3)));

describe('applyStutter slice loop', () => {
  const rate = 1000;
  const ramp = Float32Array.from({ length: 1000 }, (_, index) => index / 1000);

  it('lengthens the clip by slice length times repeats and keeps the audio around the loop', () => {
    const output = applyStutter(ramp, rate, { position: 0.2, length: 0.1, repeats: 3 });
    expect(output.length).toBe(1000 + 100 * 3);
    expect([...output.subarray(0, 200)]).toEqual([...ramp.subarray(0, 200)]);
    expect([...output.subarray(504)]).toEqual([...ramp.subarray(204)]);
  });

  it('repeats the slice seamlessly outside the join blends', () => {
    const output = applyStutter(ramp, rate, { position: 0.2, length: 0.1, repeats: 3 });
    for (let join = 1; join <= 3; join += 1) {
      const base = 200 + join * 100;
      for (let index = 4; index < 100; index += 1) expect(output[base + index]).toBe(ramp[200 + index]);
    }
  });

  it('has no sample jump at the joins and no non-finite samples', () => {
    const tone = Float32Array.from({ length: 24_000 }, (_, index) => Math.sin(2 * Math.PI * 130 * index / 48_000));
    const output = applyStutter(tone, 48_000, { position: 0.25, length: 0.1, repeats: 3 });
    let largestStep = 0;
    for (let index = 1; index < output.length; index += 1) largestStep = Math.max(largestStep, Math.abs(output[index] - output[index - 1]));
    expect(largestStep).toBeLessThan(0.05);
    expect(output.every(Number.isFinite)).toBe(true);
  });

  it('crossfades with equal-power gains', () => {
    const fadeIn = Float32Array.from({ length: 300 }, (_, index) => (index >= 100 && index < 200 ? 1 : 0));
    const fadeOut = Float32Array.from({ length: 300 }, (_, index) => (index >= 100 && index < 200 ? 0 : 1));
    const entering = applyStutter(fadeIn, rate, { position: 100 / 300, length: 0.1, repeats: 1 });
    const leaving = applyStutter(fadeOut, rate, { position: 100 / 300, length: 0.1, repeats: 1 });
    for (let index = 0; index < 4; index += 1) {
      expect(entering[200 + index] ** 2 + leaving[200 + index] ** 2).toBeCloseTo(1, 5);
      expect(entering[200 + index]).toBeCloseTo(Math.sin(Math.PI / 2 * (index + 1) / 5), 5);
    }
    expect(entering[204]).toBe(1);
  });

  it('has no hard splice when the slice reaches the end of loud audio', () => {
    const loud = Float32Array.from({ length: 4800 }, (_, index) => 0.5 + 0.3 * Math.sin(index / 7));
    const output = applyStutter(loud, 48_000, { position: 0.5, length: 1, repeats: 3 });
    let largestStep = 0;
    for (let index = 1; index < output.length; index += 1) largestStep = Math.max(largestStep, Math.abs(output[index] - output[index - 1]));
    expect(largestStep).toBeLessThan(0.1);
  });

  it('clamps the slice to the audio that remains and ignores a slice past the end', () => {
    const tail = applyStutter(new Float32Array(100).fill(0.5), 100, { position: 0.5, length: 10, repeats: 2 });
    expect(tail.length).toBe(100 + 50 * 2);
    expect(applyStutter(new Float32Array(100), 100, { position: 1, length: 0.5, repeats: 3 }).length).toBe(100);
    expect(applyStutter(new Float32Array(0), 100, { position: 0, length: 0.5, repeats: 3 }).length).toBe(0);
  });

  it('refuses output beyond the clip limit', () => {
    expect(() => applyStutter(new Float32Array(48_000 * 100), 48_000, { position: 0, length: 1, repeats: 32 })).toThrow('120-second');
  });
});

describe('stutter tag parsing', () => {
  const plan = (text: string) => createWordPlan(text, bank, undefined, catalog, phonemized, true).plan;

  it('fills defaults and keeps explicit attributes', () => {
    expect(plan('<stutter repeats="2">word</stutter>')[0].stutter).toEqual({ repeats: 2, length: 0.08, position: 0 });
    expect(plan('<stutter repeats="2" length="0.1" position="0.5">word</stutter>')[0].stutter).toEqual({ repeats: 2, length: 0.1, position: 0.5 });
  });

  it('applies to every word in scope but not to pauses or cues, and the innermost tag wins', () => {
    const items = plan('<stutter repeats="1">cassie <pause seconds="0.1"/><clip id="chime"/> <stutter repeats="3">word</stutter> apple</stutter> cassie');
    expect(items.map((item) => item.stutter?.repeats)).toEqual([1, undefined, undefined, 3, 1, undefined]);
  });

  it.each([
    '<stutter>word</stutter>',
    '<stutter length="0.1">word</stutter>',
    '<stutter repeats="2" speed="1">word</stutter>',
    '<stutter repeats="2" length="0.01">word</stutter>',
    '<stutter repeats="2" length="1.5">word</stutter>',
    '<stutter repeats="2" position="1.1">word</stutter>',
    '<stutter repeats="2.5">word</stutter>',
    '<stutter repeats="33">word</stutter>',
    '<stutter repeats="2" length="">word</stutter>',
  ])('rejects %s', (text) => {
    const result = analyzeText(text, bank);
    expect(result.tokens[0].kind).toBe('error');
    expect(result.notices.map((notice) => notice.text).join(' ')).toContain('Invalid markup tag');
  });

  it('accepts the boundary values', () => {
    expect(plan('<stutter repeats="32" length="1" position="1">word</stutter>')[0].stutter).toEqual({ repeats: 32, length: 1, position: 1 });
    expect(plan('<stutter repeats="1" length="0.02" position="0">word</stutter>')[0].stutter).toEqual({ repeats: 1, length: 0.02, position: 0 });
  });
});

describe('stutter rendering', () => {
  it('adds slice length times repeats to a recorded word and its timeline entry', async () => {
    const { duration, timeline } = await render('<stutter repeats="2" length="0.1">word</stutter>');
    expect(duration).toBeCloseTo(0.7, 3);
    expect(lengths(timeline)).toEqual([0.7]);
    expect(words(timeline)[0].startSeconds).toBe(0);
  });

  it('uses the default slice length and clamps a slice longer than what the clip has left', async () => {
    expect((await render('<stutter repeats="3">word</stutter>')).duration).toBeCloseTo(0.5 + 0.08 * 3, 3);
    expect((await render('<stutter repeats="1" position="0.5" length="1">word</stutter>')).duration).toBeCloseTo(0.75, 3);
  });

  it('stutters every word inside the scope but not cues or pauses', async () => {
    const { duration, timeline } = await render('<stutter repeats="2" length="0.1">cassie <pause seconds="0.1"/><clip id="chime"/></stutter>');
    expect(lengths(timeline)).toEqual([0.7]);
    expect(timeline.find((entry) => entry.kind === 'cue')!.endSeconds - timeline.find((entry) => entry.kind === 'cue')!.startSeconds).toBeCloseTo(0.3, 3);
    expect(duration).toBeCloseTo(0.7 + 0.1 + 0.3, 3);
  });

  it('applies the slice loop after the offset and duration crop and before rate stretching', async () => {
    expect((await render('<rate value="2"><stutter repeats="2" length="0.1">word</stutter></rate>')).duration).toBeCloseTo(0.35, 2);
    expect((await render('<offset seconds="0.1"><stutter repeats="2" length="0.1">word</stutter></offset>')).duration).toBeCloseTo(0.6, 3);
    expect((await render('<duration seconds="0.3"><stutter repeats="2" length="0.1">word</stutter></duration>')).duration).toBeCloseTo(0.5, 3);
  });

  it('stutters a synthesized word', async () => {
    const plain = await render('solo');
    const stuttered = await render('<stutter repeats="2" length="0.02">solo</stutter>');
    expect(stuttered.duration - plain.duration).toBeCloseTo(0.04, 3);
    expect(words(stuttered.timeline)[0].provenance).toBe('synthesized');
  });

  it('loops a slice from the enclosed fragment of an inline-split word only', async () => {
    const text = 'new<stutter repeats="1" length="0.02">word</stutter>';
    const items = createWordPlan(text, bank, undefined, catalog, phonemized, true).plan;
    expect(items.map((item) => item.stutter?.repeats)).toEqual([undefined, 1]);
    const plain = await render('new<volume value="1">word</volume>');
    expect((await render(text)).duration - plain.duration).toBeCloseTo(0.02, 3);
  });

  it('counts the added audio toward a fit group', async () => {
    const { timeline } = await render('<fit seconds="2"><stutter repeats="2" length="0.1">word</stutter> apple</fit>');
    const entries = words(timeline);
    expect(entries.at(-1)!.endSeconds - entries[0].startSeconds).toBeCloseTo(2, 1);
    expect(Math.abs(entries.at(-1)!.endSeconds - entries[0].startSeconds - 2)).toBeLessThan(0.05);
  });

  it('keeps the rest of the line after a stuttered word', async () => {
    const { timeline } = await render('<stutter repeats="2" length="0.1">word</stutter> apple');
    expect(words(timeline)[1].startSeconds).toBeCloseTo(0.7 + 0.24, 3);
  });
});
