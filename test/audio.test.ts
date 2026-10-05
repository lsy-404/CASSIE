import { reactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { analyzeText, createWordPlan } from '../src/audio/parser';
import { renderAnnouncement } from '../src/audio/engine';
import { applyStutter, encodeWav, mixLayers, monoFromChannels, transformWord } from '../src/audio/dsp';
import type { Bank } from '../src/audio/types';

const bank: Bank = {
  version: '1',
  source: 'test fixture',
  clips: ['negative', 'zero', 'one', 'two', 'three', 'point', 'five', 'hundred', 'thousand', 'run', 'city', 'box', 'walk', 'good', 'cassie', 'word', 'apple', 'facility', 'the_vowel', 'the_consonant', 'all-remaining-personnel']
    .map((id) => ({ id, file: `/audio/${id}.opus`, duration: 0.5, kind: 'word' as const })),
};

function word(id: string, extra: Partial<Parameters<typeof transformWord>[2]> = {}) {
  return { clipId: id, display: id, pitch: 1, volume: 1, ...extra };
}

describe('CASSIE announcement parser', () => {
  it('expands signed decimal numbers into bank words', () => {
    expect(analyzeText('-103.25', bank).words).toEqual(['negative', 'one', 'hundred', 'three', 'point', 'two', 'five']);
  });

  it('spells oversized integer digits once and preserves the decimal part', () => {
    const words = analyzeText('1000000000000.5', bank).words;
    expect(words).toEqual(['one', ...Array(12).fill('zero'), 'point', 'five']);
  });

  it('maps spoken number names to the numeric clip ids in the source bank', () => {
    const digitIds = ['0', '1', '2', '5', '11'];
    const numericBank = {
      ...bank,
      clips: [
        ...bank.clips.filter((clip) => !['zero', 'one', 'two', 'five'].includes(clip.id)),
        ...digitIds.map((id) => ({ id, file: `/audio/${id}.opus`, duration: 0.4, kind: 'word' as const })),
      ],
    };
    expect(createWordPlan('11.02', numericBank).plan.map((item) => item.clipId)).toEqual(['11', 'point', '0', '2']);
    expect(createWordPlan('1000000000000.5', numericBank).plan.map((item) => item.clipId)).toEqual([
      '1', ...Array(12).fill('0'), 'point', '5',
    ]);
  });

  it('selects the vowel or consonant form of the article from the following word', () => {
    expect(createWordPlan('the apple', bank).plan.map((item) => item.clipId)).toEqual(['the_vowel', 'apple']);
    expect(createWordPlan('the facility', bank).plan.map((item) => item.clipId)).toEqual(['the_consonant', 'facility']);
  });

  it('prefers an exact recorded multiword phrase when it is present in the bank', () => {
    const result = createWordPlan('All remaining personnel', bank);
    expect(result.plan).toHaveLength(1);
    expect(result.plan[0]).toMatchObject({ clipId: 'all-remaining-personnel', display: 'all remaining personnel' });
  });

  it('applies persistent and one-word modifiers to the following bank clips', () => {
    const result = createWordPlan('$PITCH_1.25 $VOL_0.4 cassie $SLEEP_0.6 $MAXDUR_0.2 word', bank);
    expect(result.plan[0]).toMatchObject({ pitch: 1.25, volume: 0.4 });
    expect(result.plan[1]).toMatchObject({ pitch: 1.25, volume: 0.4, sleep: 0.6, maxDuration: 0.2 });
  });

  it('composes generated inflections from the root word and a real suffix clip', () => {
    const suffixes = ['_suffix_ing', '_suffix_plural_regular', '_suffix_plural_syllabic', '_suffix_past_t'];
    const suffixBank = {
      ...bank,
      clips: [...bank.clips, ...suffixes.map((id) => ({ id, file: `/audio/${id}.opus`, duration: 0.1, kind: 'word' as const }))],
    };
    const result = createWordPlan('running cities boxes walked unknown', suffixBank);
    expect(result.plan.map((item) => [item.clipId, item.suffixClipIds])).toEqual([
      ['run', ['_suffix_ing']],
      ['city', ['_suffix_plural_regular']],
      ['box', ['_suffix_plural_syllabic']],
      ['walk', ['_suffix_past_t']],
    ]);
    expect(result.warnings).toEqual(['No audio clip for “unknown”.']);
  });

  it('does not claim inflections when the sound bank lacks suffix audio', () => {
    expect(analyzeText('running cities', bank)).toMatchObject({
      words: [],
      warnings: ['No audio clip for “running”.', 'No audio clip for “cities”.'],
    });
  });

  it('keeps bank ids with underscores intact and makes preview tolerant', () => {
    const suffixBank = { ...bank, clips: [...bank.clips, { id: '_suffix_plural_regular', file: '/audio/_suffix_plural_regular.opus', duration: 0.1, kind: 'word' as const }] };
    expect(analyzeText('_suffix_plural_regular', suffixBank).words).toEqual(['_suffix_plural_regular']);
    expect(analyzeText(' '.repeat(600), bank)).toEqual({ words: [], warnings: [] });
    expect(analyzeText('cassie '.repeat(513), bank).words).toEqual([]);
  });

  it('rejects announcements without a playable word and bounds token count', () => {
    expect(analyzeText('not-in-bank', bank)).toMatchObject({ words: [] });
    expect(() => createWordPlan('not-in-bank', bank)).toThrow(/No playable words/);
    expect(analyzeText('cassie '.repeat(513), bank).words).toEqual([]);
    expect(() => createWordPlan('cassie '.repeat(513), bank)).toThrow(/512-token limit/);
  });

  it('ignores out-of-range modifiers with a warning', () => {
    expect(analyzeText('$PITCH_99 cassie', bank).warnings).toContain('Invalid PITCH modifier: $PITCH_99');
  });
});

describe('audio DSP', () => {
  it('converts stereo PCM to mono and changes clip length with pitch', () => {
    expect([...monoFromChannels([new Float32Array([1, -1]), new Float32Array([-1, 1])])]).toEqual([0, 0]);
    const samples = new Float32Array([0, 0.5, 1, 0.5]);
    expect(transformWord(samples, 4, word('x'), 2)).toHaveLength(2);
    expect(transformWord(samples, 4, word('x'), 0.5)).toHaveLength(8);
    expect([...transformWord(samples, 4, word('x', { volume: 0.5 }), 1, 0.5)]).toEqual([0, 0.125, 0.25, 0.125]);
  });

  it('inserts bounded stutter segments and mixes overlap with peak clamping', () => {
    expect([...applyStutter(new Float32Array([1, 2, 3, 4]), 4, { position: 0.5, length: 0.25, repeats: 2 })]).toEqual([1, 2, 3, 3, 3, 4]);
    const mixed = mixLayers([{ samples: new Float32Array([0.8, 0.1]), start: 0 }, { samples: new Float32Array([0.8]), start: 0 }]);
    expect(mixed[0]).toBe(1);
    expect(mixed[1]).toBeCloseTo(0.1);
  });

  it('writes a valid mono 16-bit PCM WAV header and samples', async () => {
    const wav = encodeWav(new Float32Array([-1, 1]), 48_000);
    const bytes = new DataView(await wav.arrayBuffer());
    expect(wav.type).toBe('audio/wav');
    expect(bytes.getUint32(24, true)).toBe(48_000);
    expect(bytes.getUint32(40, true)).toBe(4);
    expect(bytes.getInt16(44, true)).toBe(-32768);
    expect(bytes.getInt16(46, true)).toBe(32767);
  });
});

describe('audio worker handoff', () => {
  it('copies Vue reactive bank data into a structured-cloneable worker request', async () => {
    class MockWorker {
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage(message: unknown) {
        expect(() => structuredClone(message)).not.toThrow();
        queueMicrotask(() => this.onmessage?.({ data: {
          type: 'done',
          samples: new Float32Array([0.25]),
          sampleRate: 48_000,
          duration: 1 / 48_000,
          words: ['cassie'],
          warnings: [],
        } } as MessageEvent));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', MockWorker);
    try {
      const result = await renderAnnouncement('cassie', reactive(bank), { pitch: 1, volume: 1, gap: 0.24, background: false });
      expect(result.words).toEqual(['cassie']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
