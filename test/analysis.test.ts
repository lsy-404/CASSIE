import { describe, expect, it, vi } from 'vitest';
import { analyzeText, createWordPlan } from '../src/audio/parser';
import { analyzeAnnouncement, renderAnnouncement } from '../src/audio/engine';
import type { PhonemeCatalog } from '../src/audio/phonemes';
import type { Bank } from '../src/audio/types';

const bank: Bank = {
  version: '1',
  source: 'test fixture',
  clips: [
    ...['cassie', 'word', 'apple', 'apply', 'phone-a', 'phone-e', 'phone-j'].map((id) => ({ id, file: `/audio/${id}.opus`, duration: 0.5, kind: 'word' as const, sha256: 'a'.repeat(64) })),
    { id: 'chime', file: '/audio/chime.opus', duration: 0.3, kind: 'effect' as const },
  ],
};

const window = (clipId: string, ipa: string) => [{ clipId, ipa, startSeconds: 0.01, endSeconds: 0.09, sourceDurationSeconds: 0.5, sourceSha256: 'a'.repeat(64), position: 'single' as const, previousIpa: null, nextIpa: null }];
const catalog: PhonemeCatalog = {
  schemaVersion: 2,
  sourceBank: { version: bank.version, sha256: 'e'.repeat(64) },
  phones: { 'ɑː': window('phone-a', 'ɑː'), 'ɛ': window('phone-e', 'ɛ'), j: window('phone-j', 'j') },
};

const pronunciations = new Map([['newword', 'j'], ['badword', 'ʒ'], ['letter:A', 'ɑː'], ['letter:B', 'ɛ']]);

vi.mock('../src/audio/phonemes', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/audio/phonemes')>(),
  loadPhonemeCatalog: async () => catalog,
  phonemizeWords: async (words: string[], _signal: unknown, letters: string[]) => new Map([...words, ...letters.map((letter) => `letter:${letter}`)].flatMap((key) => pronunciations.has(key) ? [[key, pronunciations.get(key)!] as const] : [])),
}));

const plan = (text: string, strict = false) => createWordPlan(text, bank, undefined, catalog, pronunciations, true, strict);
const options = { phonemes: true, gap: 0.24, pitch: 1, rate: 1 };
const infos = (notices: Array<{ severity: string; text: string }>) => notices.filter((notice) => notice.severity === 'info');

describe('strict mode planning', () => {
  it('synthesizes unrecorded words and reports an info notice with the source range', () => {
    const result = plan('newword');
    expect(result.plan).toHaveLength(1);
    expect(result.tokens[0]).toMatchObject({ kind: 'synthesized' });
    expect(result.tokens[0].blocked).toBeUndefined();
    expect(result.notices).toEqual([{ severity: 'info', text: 'newword → /j/ synthesized from 1 phonemes', sourceStart: 0, sourceEnd: 7 }]);
  });

  it('skips synthesizable words and flags them as blocked when strict', () => {
    const result = plan('cassie newword', true);
    expect(result.plan.map((item) => item.display)).toEqual(['cassie']);
    expect(result.tokens.map((token) => [token.kind, token.blocked])).toEqual([['recorded', undefined], ['synthesized', true]]);
    expect(result.notices).toEqual([{ severity: 'warning', text: "'newword' can be synthesized from phonemes, but unrecorded-word synthesis is off", sourceStart: 7, sourceEnd: 14 }]);
  });

  it('reports letter-name spelling as one synthesized segment, or one blocked word', () => {
    const on = plan('AB');
    expect(on.plan).toHaveLength(2);
    expect(infos(on.notices)).toEqual([{ severity: 'info', text: 'AB → /ɑːɛ/ synthesized from 2 phonemes', sourceStart: 0, sourceEnd: 2 }]);
    const strict = plan('AB', true);
    expect(strict.plan).toHaveLength(0);
    expect(strict.tokens[0]).toMatchObject({ kind: 'synthesized', blocked: true });
    expect(strict.notices).toHaveLength(1);
  });

  it('keeps explicit IPA rendering in strict mode', () => {
    const result = plan('/ɛ/', true);
    expect(result.plan).toHaveLength(1);
    expect(result.tokens[0].blocked).toBeUndefined();
  });

  it('classifies words that cannot be synthesized as errors, not blocked', () => {
    for (const strict of [false, true]) {
      const impossible = plan('badword', strict);
      expect(impossible.tokens[0]).toMatchObject({ kind: 'error' });
      expect(impossible.tokens[0].blocked).toBeUndefined();
      expect(impossible.notices.every((notice) => notice.severity === 'error')).toBe(true);
      const unknown = plan('mystery', strict);
      expect(unknown.tokens[0].kind).toBe('error');
      expect(unknown.notices[0]).toMatchObject({ severity: 'error', text: 'No audio clip for “mystery”.', sourceStart: 0, sourceEnd: 7 });
    }
  });

  it('treats approximate phoneme use as a warning on a synthesized token', () => {
    const result = createWordPlan('/ e: /', bank, undefined, catalog);
    expect(result.tokens[0].kind).toBe('synthesized');
    expect(result.notices.map((notice) => notice.severity)).toEqual(['warning', 'info']);
  });
});

describe('automatic fix suggestions', () => {
  const fixOf = (text: string) => analyzeText(text, bank).tokens[0].fix;

  it.each([
    ['<pitch value="20">word</pitch>', '<pitch value="15">'],
    ['<volume value="-1">word</volume>', '<volume value="0">'],
    ['<rate value="9">word</rate>', '<rate value="2">'],
    ['<fit seconds="500">word</fit>', '<fit seconds="120">'],
    ['<stutter repeats="2.5">word</stutter>', '<stutter repeats="3">'],
    ['<stutter repeats="0">word</stutter>', '<stutter repeats="1">'],
    ['<stutter repeats="2" length="5">word</stutter>', '<stutter repeats="2" length="1">'],
    ['<stutter repeats="2" length="0.001">word</stutter>', '<stutter repeats="2" length="0.02">'],
    ['<stutter repeats="2" position="-1">word</stutter>', '<stutter repeats="2" position="0">'],
    ['<stutter repeats="40" length="2">word</stutter>', '<stutter repeats="32" length="1">'],
    ['<voice pitch="13" tension="0.5">word</voice>', '<voice pitch="12" tension="0.5">'],
    ['<pause seconds="999"/>', '<pause seconds="120"/>'],
  ])('clamps %s', (text, replacement) => {
    expect(fixOf(text)).toEqual({ replacement });
    expect(analyzeText(text, bank).tokens[0].kind).toBe('error');
  });

  it('offers no fix when the value is not a number or the shape is wrong', () => {
    expect(fixOf('<pitch value="abc">word</pitch>')).toBeUndefined();
    expect(fixOf('<pitch>word</pitch>')).toBeUndefined();
    expect(fixOf('<voice gain="1">word</voice>')).toBeUndefined();
    expect(fixOf('<stutter length="0.1">word</stutter>')).toBeUndefined();
    expect(fixOf('<stutter repeats="2" speed="1">word</stutter>')).toBeUndefined();
    expect(fixOf('<stutter repeats="2" length="abc">word</stutter>')).toBeUndefined();
  });

  it('repairs a closing tag only when exactly one scope is open or none', () => {
    const mismatched = analyzeText('<pitch value="1.2">word</volume>', bank);
    expect(mismatched.tokens.at(-1)).toMatchObject({ kind: 'error', fix: { replacement: '</pitch>' } });
    expect(analyzeText('word</pitch>', bank).tokens[1].fix).toEqual({ replacement: '' });
    expect(analyzeText('<pitch value="1"><volume value="1">word</pitch>', bank).tokens.at(-1)?.fix).toBeUndefined();
  });

  const applyFixes = (text: string) => analyzeText(text, bank).tokens
    .filter((token) => token.fix)
    .sort((left, right) => right.sourceStart - left.sourceStart)
    .reduce((current, token) => current.slice(0, token.sourceStart) + token.fix!.replacement + current.slice(token.sourceEnd), text);

  it.each([
    '<pitch value="20">word</pitch>',
    '<pitch value="1.2"><volume value="20">word</volume></pitch>',
  ])('pairs the closing tag of an out-of-range opener in %s', (text) => {
    const result = analyzeText(text, bank);
    expect(result.tokens.filter((token) => token.text.startsWith('</')).map((token) => token.fix)).toEqual(result.tokens.filter((token) => token.text.startsWith('</')).map(() => undefined));
    expect(result.notices.some((notice) => notice.text.startsWith('Mismatched closing tag'))).toBe(false);
    expect(analyzeText(applyFixes(text), bank).notices.filter((notice) => notice.severity === 'error')).toEqual([]);
  });

  it('keeps pairing closing tags past the nesting limit without offering fixes', () => {
    const result = analyzeText(`${'<pitch value="1">'.repeat(33)}word${'</pitch>'.repeat(33)}`, bank);
    expect(result.notices.map((notice) => notice.text)).toEqual(['Markup nesting exceeds the 32-level limit.']);
    expect(result.tokens.filter((token) => token.fix)).toEqual([]);
  });

  it('suggests a clip id only for a single close match', () => {
    expect(fixOf('<clip id="cassy"/>')).toEqual({ replacement: '<clip id="cassie"/>' });
    expect(fixOf('<clip id="applx"/>')).toBeUndefined();
    expect(fixOf('<clip id="zzzzzz"/>')).toBeUndefined();
    expect(fixOf('<clip id="cas"/>')).toBeUndefined();
  });

  it('gives every notice about a bad tag the tag source range', () => {
    const result = analyzeText('word <pitch value="20">', bank);
    expect(result.notices[0]).toMatchObject({ severity: 'error', sourceStart: 5, sourceEnd: 23 });
  });
});

describe('multi-part and inline-fragment words', () => {
  const numberBank: Bank = { ...bank, clips: [...bank.clips, { id: 'two', file: '/audio/two.opus', duration: 0.5, kind: 'word' as const, sha256: 'a'.repeat(64) }] };
  const spoken = new Map([['forty', 'j'], ['four', 'ʒ']]);
  const number = (text: string, strict = false) => createWordPlan(text, numberBank, undefined, catalog, spoken, true, strict);

  it('classifies a number token from all of its parts', () => {
    const mixed = number('42');
    expect(mixed.plan.map((item) => item.display)).toEqual(['forty', 'two']);
    expect(mixed.tokens[0]).toMatchObject({ kind: 'synthesized' });
    expect(mixed.tokens[0].blocked).toBeUndefined();
  });

  it('skips the whole number in strict mode instead of playing a partial number', () => {
    const strict = number('42', true);
    expect(strict.plan).toHaveLength(0);
    expect(strict.tokens[0]).toMatchObject({ kind: 'synthesized', blocked: true });
  });

  it('marks a number with an unsynthesizable part as an error and plays nothing of it', () => {
    for (const strict of [false, true]) {
      const result = number('44', strict);
      expect(result.plan).toHaveLength(0);
      expect(result.tokens[0]).toMatchObject({ kind: 'error' });
      expect(result.tokens[0].blocked).toBeUndefined();
    }
  });

  it('reports a synthesized info notice for inline fragments only when all of them render', () => {
    const failing = createWordPlan('new<pitch value="1.2">word</pitch>', bank, undefined, catalog, pronunciations, true);
    expect(failing.tokens[0].kind).toBe('error');
    expect(infos(failing.notices)).toEqual([]);
  });
});

describe('analysis through the engine', () => {
  it('reports synthesis as info when on and blocked words as warnings when strict', async () => {
    const on = await analyzeAnnouncement('cassie newword', bank, options);
    expect(on.words).toEqual(['cassie', 'newword']);
    expect(on.notices.map((notice) => notice.severity)).toEqual(['info']);
    expect(on.ipa).toEqual(['j']);

    const strict = await analyzeAnnouncement('cassie newword', bank, { ...options, phonemes: false });
    expect(strict.words).toEqual(['cassie']);
    expect(strict.tokens[1]).toMatchObject({ kind: 'synthesized', blocked: true });
    expect(strict.notices).toEqual([{ severity: 'warning', text: "'newword' can be synthesized from phonemes, but unrecorded-word synthesis is off", sourceStart: 7, sourceEnd: 14 }]);
  });

  it('flows fit estimates into the notices as warnings', async () => {
    const result = await analyzeAnnouncement('<fit seconds="0.1">cassie word</fit>', bank, { ...options, phonemes: false });
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0].severity).toBe('warning');
  });

  it('refuses to render when strict mode leaves nothing to play', async () => {
    await expect(renderAnnouncement('newword', bank, { pitch: 1, volume: 1, gap: 0.24, phonemes: false })).rejects.toThrow(/unrecorded-word synthesis is off/);
  });
});
