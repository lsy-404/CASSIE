import { describe, expect, it } from 'vitest';
import { decodeUrlState, encodeUrlState } from '../src/url-state';

function queryWith(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `?data=${encodeURIComponent(btoa(binary))}`;
}

describe('share URL state', () => {
  it('round-trips Unicode text, options, locale, and export format', () => {
    const url = encodeUrlState({
      text: '警報 / a e: /',
      options: { pitch: 1.2, voice: { breathiness: 0.4, tension: -0.2 } },
      locale: 'zh',
      export: 'opus',
    });
    expect(decodeUrlState(url)).toEqual({
      text: '警報 / a e: /',
      options: {
        pitch: 1.2,
        volume: 1,
        gap: 0.24,
        rate: 1,
        voice: { pitchSemitones: 0, breathiness: 0.4, formantSemitones: 0, loudnessDb: 0, tension: -0.2 },
      },
      locale: 'zh',
      export: 'opus',
    });
  });

  it('fills option defaults and permits boundary values', () => {
    const decoded = decodeUrlState(queryWith({
      text: 'Hello',
      options: {
        pitch: 0.65, volume: 0, gap: 0.8, rate: 2,
        voice: { pitchSemitones: -12, breathiness: 1, formantSemitones: 6, loudnessDb: -24, tension: 1 },
      },
    }));
    expect(decoded?.options).toEqual({
      pitch: 0.65, volume: 0, gap: 0.8, rate: 2,
      voice: { pitchSemitones: -12, breathiness: 1, formantSemitones: 6, loudnessDb: -24, tension: 1 },
    });
    expect(decodeUrlState(queryWith({ text: 'Hello' }))?.options).toEqual({
      pitch: 1, volume: 1, gap: 0.24, rate: 1,
      voice: { pitchSemitones: 0, breathiness: 0, formantSemitones: 0, loudnessDb: 0, tension: 0 },
    });
  });

  it('accepts unpadded base64url and padded standard base64', () => {
    expect(decodeUrlState(encodeUrlState({ text: 'A' }))?.text).toBe('A');
    expect(decodeUrlState(queryWith({ text: 'A' }))?.text).toBe('A');
  });

  it('returns null only for an empty query', () => {
    expect(decodeUrlState('')).toBeNull();
    expect(decodeUrlState('?')).toBeNull();
  });

  it.each([
    '?export=wav',
    '?text=hello',
    '?data=abc&data=def',
    '?data=abc&export=mp3',
    '?data=abc&unexpected=1',
    '?data=!!!!',
    '?data=YQ=',
  ])('rejects malformed query %s', (query) => {
    expect(() => decodeUrlState(query)).toThrow();
  });

  it.each([
    { text: 'Hi', extra: true },
    { text: 'Hi', options: { unknown: 1 } },
    { text: 'Hi', options: { voice: { unknown: 1 } } },
    { text: 'Hi', locale: 'fr' },
    { text: 'Hi', options: { pitch: 1.36 } },
    { text: 'Hi', options: { volume: Number.NaN } },
    { text: 'Hi', options: { gap: -0.01 } },
    { text: 'Hi', options: { rate: 2.01 } },
    { text: 'Hi', options: { voice: { loudnessDb: 12.1 } } },
  ])('rejects invalid payload %#', (payload) => {
    expect(() => decodeUrlState(queryWith(payload))).toThrow();
  });

  it('enforces UTF-8 text and decoded payload limits', () => {
    expect(() => encodeUrlState({ text: 'a'.repeat(16 * 1024 + 1) })).toThrow(/16 KiB/u);
    expect(() => decodeUrlState(queryWith({ text: 'a'.repeat(16 * 1024 + 1) }))).toThrow(/16 KiB/u);
    const oversized = 'A'.repeat(90_000);
    expect(() => decodeUrlState(`?data=${oversized}`)).toThrow(/oversized|64 KiB/u);
  });
});
