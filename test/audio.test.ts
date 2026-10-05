import { describe, expect, it } from 'vitest';
import { analyzeText, createWordPlan } from '../src/audio/parser';
import { applyStutter, encodeWav, mixLayers, monoFromChannels, transformWord } from '../src/audio/dsp';
import type { Bank } from '../src/audio/types';

const bank: Bank = {
  version: '1',
  source: 'test fixture',
  clips: ['negative', 'zero', 'one', 'two', 'three', 'point', 'five', 'hundred', 'thousand', 'run', 'city', 'good', 'cassie', 'word']
    .map((id) => ({ id, file: `/audio/${id}.opus`, duration: 0.5, kind: 'word' as const })),
};

function word(id: string, extra: Partial<Parameters<typeof transformWord>[2]> = {}) {
  return { clipId: id, display: id, pitch: 1, volume: 1, ...extra };
}

describe('CASSIE announcement parser', () => {
  it('expands signed decimal numbers into bank words', () => {
    expect(analyzeText('-103.25', bank).words).toEqual(['negative', 'one', 'hundred', 'three', 'point', 'two', 'five']);
  });

  it('applies persistent and one-word modifiers to the following bank clips', () => {
    const result = createWordPlan('$PITCH_1.25 $VOL_0.4 cassie $SLEEP_0.6 $MAXDUR_0.2 word', bank);
    expect(result.plan[0]).toMatchObject({ pitch: 1.25, volume: 0.4 });
    expect(result.plan[1]).toMatchObject({ pitch: 1.25, volume: 0.4, sleep: 0.6, maxDuration: 0.2 });
  });

  it('supports generated regular inflections and reports unknown clips', () => {
    const result = createWordPlan('running cities unknown', bank);
    expect(result.plan.map((item) => item.display)).toEqual(['running', 'cities']);
    expect(result.plan.map((item) => item.clipId)).toEqual(['run', 'city']);
    expect(result.warnings).toContain('No audio clip for “unknown”.');
  });

  it('rejects announcements without a playable word and bounds token count', () => {
    expect(() => analyzeText('not-in-bank', bank)).toThrow(/No playable words/);
    expect(() => analyzeText('cassie '.repeat(513), bank)).toThrow(/512-token limit/);
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
