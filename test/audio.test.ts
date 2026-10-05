import { reactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { analyzeText, createWordPlan } from '../src/audio/parser';
import { getClipUsage } from '../src/audio/catalog';
import { analyzeAnnouncement, renderAnnouncement } from '../src/audio/engine';
import { advancePlaybackCursorAfterRepeat, appendTimelineEntry, applyStutter, clipTimelineToDuration, encodeWav, mapSourceTimeline, mixLayers, monoFromChannels, nextClipStart, splicePhonemeWindows, stretchSpeechPreservingGaps, stretchSpeechRate, stretchVowelLoop, transformWord } from '../src/audio/dsp';
import type { Bank } from '../src/audio/types';
import type { PhonemeCatalog } from '../src/audio/phonemes';
import { parseGeneratedPhones, resolvePhoneUnits } from '../src/audio/phonemes';

const bank: Bank = {
  version: '1',
  source: 'test fixture',
  clips: ['negative', 'zero', 'one', 'two', 'three', 'point', 'five', 'hundred', 'thousand', 'run', 'city', 'box', 'walk', 'good', 'cassie', 'word', 'apple', 'facility', 'the_vowel', 'the_consonant', 'all-remaining-personnel', 'green', 'human', 'personnel', 'safe']
    .map((id) => ({ id, file: `/audio/${id}.opus`, duration: 0.5, kind: 'word' as const })),
};

const phoneBank: Bank = {
  ...bank,
  clips: [...bank.clips,
    { id: 'phone-a', file: '/audio/phone-a.opus', duration: 0.1, kind: 'word', sha256: 'a'.repeat(64) },
    { id: 'phone-e', file: '/audio/phone-e.opus', duration: 0.1, kind: 'word', sha256: 'b'.repeat(64) },
    { id: 'phone-j', file: '/audio/phone-j.opus', duration: 0.1, kind: 'word', sha256: 'c'.repeat(64) },
    { id: 'phone-th', file: '/audio/phone-th.opus', duration: 0.1, kind: 'word', sha256: 'd'.repeat(64) },
  ],
};

const phoneCatalog: PhonemeCatalog = {
  schemaVersion: 2,
  sourceBank: { version: bank.version, sha256: 'e'.repeat(64) },
  phones: {
    'ɑː': [{ clipId: 'phone-a', ipa: 'ˈɑː', startSeconds: 0.01, endSeconds: 0.09, sourceDurationSeconds: 0.1, sourceSha256: 'a'.repeat(64), position: 'single', previousIpa: null, nextIpa: null }],
    'ɛ': [{ clipId: 'phone-e', ipa: 'ˈɛ', startSeconds: 0.01, endSeconds: 0.09, sourceDurationSeconds: 0.1, sourceSha256: 'b'.repeat(64), position: 'single', previousIpa: null, nextIpa: null }],
    'j': [{ clipId: 'phone-j', ipa: 'j', startSeconds: 0.01, endSeconds: 0.09, sourceDurationSeconds: 0.1, sourceSha256: 'c'.repeat(64), position: 'single', previousIpa: null, nextIpa: null }],
    'θ': [{ clipId: 'phone-th', ipa: 'θ', startSeconds: 0.01, endSeconds: 0.101, sourceDurationSeconds: 0.1, sourceSha256: 'd'.repeat(64), position: 'single', previousIpa: null, nextIpa: null }],
    'dʒ': [],
  },
};

function word(id: string, extra: Partial<Parameters<typeof transformWord>[2]> = {}) {
  return { clipId: id, display: id, pitch: 1, volume: 1, ...extra };
}

describe('CASSIE announcement parser', () => {
  it('uses markup clip tags for explicit fragments and single-letter clips', () => {
    const usage = (id: string) => getClipUsage({ id, file: `/audio/${id}.opus`, duration: 0.2, kind: 'word' });
    expect(usage('_a')).toMatchObject({ insertText: '<clip id="_a"/>' });
    expect(usage('a')).toMatchObject({ insertText: '<clip id="a"/>' });
    expect(usage('the_vowel')).toMatchObject({ insertText: '<clip id="the_vowel"/>' });
    expect(usage('hello')).toMatchObject({ insertText: 'hello' });
    expect(usage('a').description).toContain('<clip id="a"/>');
  });

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

  it('maps measured phrase word timings to their original UTF-16 spans', () => {
    const catalog = {
      ...phoneCatalog,
      wordTimings: {
        'all-remaining-personnel': [
          { text: 'all', startSeconds: 0.02, endSeconds: 0.12 },
          { text: 'remaining', startSeconds: 0.14, endSeconds: 0.31 },
          { text: 'personnel', startSeconds: 0.33, endSeconds: 0.49 },
        ],
      },
    } satisfies PhonemeCatalog;
    const phrase = createWordPlan('All remaining personnel', bank, undefined, catalog).plan[0];
    expect(phrase.sourceWordTimings?.map(({ sourceStart, sourceEnd }) => [sourceStart, sourceEnd])).toEqual([[0, 3], [4, 13], [14, 23]]);
  });

  it('applies paired scoped pitch, volume, pause, and stutter modifiers', () => {
    const result = createWordPlan('<pitch value="1.25"><volume value="0.4">cassie</volume></pitch><pause seconds="0.6"/><stutter repeats="3">word</stutter>', bank);
    expect(result.plan[0]).toMatchObject({ pitch: 1.25, volume: 0.4 });
    expect(result.plan[1]).toMatchObject({ pauseDuration: 0.6 });
    expect(result.plan[2]).toMatchObject({ stutterScopes: [{ id: expect.any(Number), repeats: 3 }], stutterScopeEnds: [expect.any(Number)] });
    expect(result.warnings).toEqual([]);
  });

  it('retains the game timing and clip-selection modifiers', () => {
    const result = createWordPlan('<offset seconds="0.1"><duration seconds="0.3">cassie</duration></offset> <spacing seconds="0.8">word</spacing>', bank);
    expect(result.plan[0]).toMatchObject({ startAt: 0.1, maxDuration: 0.3 });
    expect(result.plan[1]).toMatchObject({ spacing: 0.8 });
    expect(result.warnings).toEqual([]);
  });

  it('splices direct IPA, applies ASCII vowel aliases, and carries scoped modifiers onto the segment', () => {
    const result = createWordPlan('<pitch value="1.2"><volume value="0.6">/ a e: /</volume></pitch>', phoneBank, undefined, phoneCatalog);
    expect(result.plan[0]).toMatchObject({
      pitch: 1.2,
      volume: 0.6,
      phonemeUnits: [
        { clipId: 'phone-a', ipa: 'ɑː' },
        { clipId: 'phone-e', ipa: 'ɛ', stretchFactor: 1.7 },
      ],
    });
    expect(result.warnings).toEqual(['Approximate phoneme match: /ɛː/ was stretched from /ɛ/.']);
  });

  it('skips a direct IPA segment when any phone lacks a verified source window', () => {
    const result = createWordPlan('cassie / θ /', phoneBank, undefined, phoneCatalog);
    expect(result.plan.map((item) => item.clipId)).toEqual(['cassie']);
    expect(result.warnings).toEqual(['No verified audio window for /θ/; the complete segment was skipped.']);
  });

  it('keeps generated IPA /j/ distinct from the direct ASCII affricate alias /jh/', () => {
    const glide = createWordPlan('unknown', phoneBank, undefined, phoneCatalog, new Map([['unknown', 'j']]), true);
    const affricate = createWordPlan('/ jh /', phoneBank, undefined, phoneCatalog, new Map(), true);
    expect(glide.plan[0].phonemeUnits?.[0]).toMatchObject({ clipId: 'phone-j', ipa: 'j' });
    expect(affricate.warnings).toEqual(['No verified audio window for /dʒ/; the complete segment was skipped.']);
  });

  it('segments known generated allophone variants without discarding their exact pronunciation', () => {
    const inventory: PhonemeCatalog = {
      ...phoneCatalog,
      phones: {
        ...phoneCatalog.phones,
        'aɪ': [], 'ə': [], 'ɛ': [], 'ɜː': [], 'iː': [], 'ʌ': [], 'ɔː': [], 'ɔːɹ': [],
        w: [], k: [], s: [], p: [], l: [], n: [], ʃ: [], t: [],
      },
    };
    expect(parseGeneratedPhones('ɛksploːɹ', inventory)).toMatchObject({ phones: ['ɛ', 'k', 's', 'p', 'l', 'oːɹ'], warnings: [] });
    expect(parseGeneratedPhones('wˈɜːkʃiːt', inventory)).toMatchObject({ phones: ['w', 'ɜː', 'k', 'ʃ', 'iː', 't'], warnings: [] });
    expect(parseGeneratedPhones('ʌnsəpˈoːɹt', inventory)).toMatchObject({ phones: ['ʌ', 'n', 's', 'ə', 'p', 'oːɹ', 't'], warnings: [] });
    expect(parseGeneratedPhones('ˈaɪ', inventory)).toMatchObject({ phones: ['aɪ'], warnings: [] });
    expect(parseGeneratedPhones('ə', inventory)).toMatchObject({ phones: ['ə'], warnings: [] });
  });

  it('keeps exact rhotic vowels ahead of aliases and marks audible vowel stretch as approximate', () => {
    const exactBank: Bank = {
      ...phoneBank,
      clips: [...phoneBank.clips,
        { id: 'phone-exact-r', file: '/audio/phone-exact-r.opus', duration: 0.2, kind: 'word', sha256: 'f'.repeat(64) },
        { id: 'phone-approx-r', file: '/audio/phone-approx-r.opus', duration: 0.2, kind: 'word', sha256: 'e'.repeat(64) },
      ],
    };
    const window = (clipId: string, sha: string) => ({
      clipId, ipa: 'oːɹ', startSeconds: 0.01, endSeconds: 0.18, sourceDurationSeconds: 0.2, sourceSha256: sha, position: 'final' as const, previousIpa: null, nextIpa: null,
    });
    const catalog: PhonemeCatalog = {
      ...phoneCatalog,
      phones: {
        ...phoneCatalog.phones,
        'ɔːɹ': [window('phone-approx-r', 'e'.repeat(64))],
        'oːɹ': [window('phone-exact-r', 'f'.repeat(64))],
      },
    };
    const exact = resolvePhoneUnits(['oːɹ'], catalog, exactBank);
    expect(exact.units[0]).toMatchObject({ clipId: 'phone-exact-r', ipa: 'oːɹ' });
    expect(exact.warnings).toEqual([]);

    const approximateCatalog = { ...catalog, phones: { ...catalog.phones, 'oːɹ': [] } };
    const approximate = resolvePhoneUnits(['oːɹ'], approximateCatalog, exactBank);
    expect(approximate.units[0]).toMatchObject({ clipId: 'phone-approx-r', ipa: 'ɔːɹ', approximate: true });
    expect(approximate.warnings).toHaveLength(1);

    const stretched = createWordPlan('/ e: /', phoneBank, undefined, phoneCatalog);
    expect(stretched.plan[0].phonemeUnits?.[0]).toMatchObject({ ipa: 'ɛ', stretchFactor: 1.7, approximate: true });
    expect(stretched.tokens[0].kind).toBe('error');
    expect(stretched.warnings[0]).toMatch(/stretched from/);

    const generatedCatalog: PhonemeCatalog = {
      ...phoneCatalog,
      phones: {
        ...phoneCatalog.phones,
        t: [{ clipId: 'phone-th', ipa: 't', startSeconds: 0.01, endSeconds: 0.09, sourceDurationSeconds: 0.1,
          sourceSha256: 'd'.repeat(64), position: 'final', previousIpa: 'ɛː', nextIpa: null }],
      },
    };
    expect(parseGeneratedPhones('ɛːt', generatedCatalog).phones).toEqual(['ɛː', 't']);
    const generated = createWordPlan('longword', phoneBank, undefined, generatedCatalog, new Map([['longword', 'ɛːt']]), true);
    expect(generated.plan[0].phonemeUnits).toHaveLength(2);
    expect(generated.plan[0].phonemeUnits?.[0]).toMatchObject({ stretchFactor: 1.7, approximate: true });
    expect(generated.tokens[0].kind).toBe('error');
  });

  it('phonemizes explore, worksheet, and unsupport against measured inventory without silent plans', () => {
    const pronunciations = {
      explore: 'ɛksploːɹ',
      worksheet: 'wˈɜːkʃiːt',
      unsupport: 'ʌnsəpˈoːɹt',
    };
    const inventory = [...new Set(['ɛ', 'k', 's', 'p', 'l', 'ɔːɹ', 'w', 'ɜː', 'ʃ', 'iː', 't', 'ʌ', 'n', 'ə'])];
    const clips = inventory.map((_, index) => ({
      id: `phone-${index}`,
      file: `/audio/phone-${index}.opus`,
      duration: 0.2,
      kind: 'word' as const,
      sha256: index.toString(16).padStart(64, '0'),
    }));
    const catalog: PhonemeCatalog = {
      schemaVersion: 2,
      sourceBank: { version: bank.version, sha256: 'e'.repeat(64) },
      phones: Object.fromEntries(inventory.map((phone, index) => [phone, [{
        clipId: `phone-${index}`, ipa: phone, startSeconds: 0.01, endSeconds: 0.18, sourceDurationSeconds: 0.2,
        sourceSha256: index.toString(16).padStart(64, '0'), position: 'single', previousIpa: null, nextIpa: null,
      }]])),
    };
    const result = createWordPlan(Object.keys(pronunciations).join(' '), { ...bank, clips: [...bank.clips, ...clips] }, undefined, catalog, new Map(Object.entries(pronunciations)), true);
    expect(result.plan).toHaveLength(3);
    expect(result.plan.every((item) => item.phonemeUnits?.length)).toBe(true);
    expect(result.tokens.map((token) => token.kind)).toEqual(['error', 'synthesized', 'error']);
    expect(result.warnings.filter((warning) => warning.includes('Approximate phoneme match'))).toHaveLength(2);
  });

  it('selects source-position and neighboring-phone matches, then merges adjacent windows', () => {
    const clips = ['initial', 'medial', 'final', 'context', 'adjacent'].map((id, index) => ({
      id,
      file: `/audio/${id}.opus`,
      duration: 0.5,
      kind: 'word' as const,
      sha256: String(index + 1).repeat(64),
    }));
    const source = (clipId: string, index: number, start: number, end: number, position: 'initial' | 'medial' | 'final' | 'single', previousIpa: string | null, nextIpa: string | null) => ({
      clipId,
      ipa: 'b',
      startSeconds: start,
      endSeconds: end,
      sourceDurationSeconds: 0.5,
      sourceSha256: String(index + 1).repeat(64),
      position,
      previousIpa,
      nextIpa,
    });
    const selectionBank = { ...bank, clips: [...bank.clips, ...clips] };
    const catalog: PhonemeCatalog = {
      schemaVersion: 2,
      sourceBank: { version: bank.version, sha256: 'e'.repeat(64) },
      phones: {
        b: [source('medial', 1, 0.01, 0.11, 'medial', 'ɛ', 't'), source('initial', 0, 0.01, 0.21, 'initial', null, 'ɛ')],
        ɛ: [source('adjacent', 4, 0.11, 0.2, 'final', 'b', null)],
        t: [
          { ...source('final', 2, 0.01, 0.09, 'medial', 'b', 'ɛ'), ipa: 't' },
          { ...source('context', 3, 0.01, 0.17, 'medial', 'ɛ', 'b'), ipa: 't' },
        ],
      },
    };
    const initial = resolvePhoneUnits(['b', 'ɛ'], catalog, selectionBank);
    expect(initial.units[0].clipId).toBe('initial');
    const context = resolvePhoneUnits(['b', 't', 'ɛ'], catalog, selectionBank);
    expect(context.units[1].clipId).toBe('final');
    const adjacentCatalog: PhonemeCatalog = {
      ...catalog,
      phones: {
        b: [source('adjacent', 4, 0.11, 0.15, 'initial', null, 'ɛ')],
        ɛ: [source('adjacent', 4, 0.15, 0.2, 'final', 'b', null)],
      },
    };
    const contiguous = resolvePhoneUnits(['b', 'ɛ'], adjacentCatalog, selectionBank);
    expect(contiguous.units).toHaveLength(1);
    expect(contiguous.units[0]).toMatchObject({ clipId: 'adjacent', startSeconds: 0.11, endSeconds: 0.2, ipa: 'b ɛ' });
  });

  it.each(['constructor', '__proto__'])('treats inherited catalog key %s as an unsupported phone', (phone) => {
    const inherited = Object.create(null) as Record<string, unknown>;
    inherited.constructor = phoneCatalog.phones['ɑː'];
    Object.defineProperty(inherited, '__proto__', { value: phoneCatalog.phones['ɑː'], enumerable: true });
    const unsafeCatalog = {
      ...phoneCatalog,
      phones: Object.assign(Object.create(inherited), phoneCatalog.phones),
    } as PhonemeCatalog;
    const result = createWordPlan(`cassie / ${phone} /`, phoneBank, undefined, unsafeCatalog);
    expect(result.plan.map((item) => item.clipId)).toEqual(['cassie']);
    expect(result.warnings).toEqual([`Unsupported phoneme: ${phone}.`]);
  });

  it('inserts verified start/end cues at their text positions and direct bank clips', () => {
    const cueBank = {
      ...bank,
      clips: [...bank.clips,
        { id: 'start_beep', file: '/audio/start_beep.opus', duration: 0.2, kind: 'effect' as const },
        { id: 'end_beep', file: '/audio/end_beep.opus', duration: 0.2, kind: 'effect' as const },
      ],
    };
    const result = createWordPlan('<start/> cassie <clip id="the_vowel"/> <end/>', cueBank, { start: 'start_beep', end: 'end_beep' });
    expect(result.plan.map(({ clipId, display }) => [clipId, display])).toEqual([
      ['start_beep', 'start cue'],
      ['cassie', 'cassie'],
      ['the_vowel', 'the_vowel'],
      ['end_beep', 'end cue'],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('recognizes br tags next to spaced IPA blocks and resumes after an unclosed block', () => {
    const direct = createWordPlan('<br/> / a e: /', phoneBank, undefined, phoneCatalog);
    expect(direct.plan.map((item) => item.timelineKind)).toEqual(['gap', 'word']);
    expect(direct.plan[1].phonemeUnits).toHaveLength(2);
    const incomplete = analyzeText('/ a cassie', bank);
    expect(incomplete.words).toEqual(['cassie']);
    expect(incomplete.warnings).toContain('Unclosed IPA segment; text after the slash was parsed normally.');
  });

  it('classifies markup markers and spoken source spans, including only actual text spaces as gaps', () => {
    const source = 'cassie <pitch value="1.1">word</pitch>';
    const plan = createWordPlan(source, bank).plan;
    expect(plan[1]).toMatchObject({ sourceStart: source.indexOf('word'), sourceEnd: source.length - '</pitch>'.length, gapSourceStart: 6, gapSourceEnd: 7, pitch: 1.1 });
    expect(analyzeText(source, bank).tokens.map(({ kind }) => kind)).toEqual(['recorded', 'marker', 'recorded', 'marker']);
    expect(createWordPlan('newword', phoneBank, undefined, phoneCatalog, new Map([['newword', 'j']]), true).tokens[0].kind).toBe('synthesized');
  });

  it('phonemizes an inline-tagged word once and assigns its measured phones to source fragments', () => {
    const phoneClips = [
      ['m', 'phone-j', 'c'], ['t', 'phone-th', 'd'], ['ɹ', 'phone-a', 'a'], ['ɪ', 'phone-e', 'b'], ['k', 'phone-j', 'c'], ['s', 'phone-a', 'a'],
    ] as const;
    const clips = phoneClips.map(([, id, hash]) => phoneBank.clips.find((clip) => clip.id === id)!);
    const catalog = {
      ...phoneCatalog,
      phones: {
        ...phoneCatalog.phones,
        ...Object.fromEntries(phoneClips.map(([phone, clipId, hash]) => [phone, [{
          clipId, ipa: phone, startSeconds: 0.01, endSeconds: 0.09, sourceDurationSeconds: 0.1,
          sourceSha256: `${hash}`.repeat(64), position: 'single' as const, previousIpa: null, nextIpa: null,
        }]])),
        'ɛ': [
          { ...phoneCatalog.phones['ɛ'][0], position: 'medial' as const, previousIpa: 'm', nextIpa: 't', startSeconds: 0.01, endSeconds: 0.09 },
          { ...phoneCatalog.phones['ɛ'][0], position: 'final' as const, previousIpa: 'm', nextIpa: 't', startSeconds: 0.02, endSeconds: 0.1 },
        ],
        t: [
          { clipId: 'phone-th', ipa: 't', position: 'medial' as const, previousIpa: 'ɛ', nextIpa: 'ɹ', startSeconds: 0.01, endSeconds: 0.09, sourceDurationSeconds: 0.1, sourceSha256: 'd'.repeat(64) },
          { clipId: 'phone-th', ipa: 't', position: 'initial' as const, previousIpa: 'ɛ', nextIpa: 'ɹ', startSeconds: 0.02, endSeconds: 0.1, sourceDurationSeconds: 0.1, sourceSha256: 'd'.repeat(64) },
        ],
      },
    } satisfies PhonemeCatalog;
    const source = 'me<pitch value="1.2">tri</pitch>cs';
    const result = createWordPlan(source, { ...phoneBank, clips: [...phoneBank.clips, ...clips] }, undefined, catalog,
      new Map([['metrics', 'mɛtɹɪks'], ['me', 'mɛ'], ['metri', 'mɛtɹɪ']]), true);
    expect(result.plan.map((item) => item.phonemeUnits?.map((unit) => unit.ipa))).toEqual([['m', 'ɛ'], ['t', 'ɹ', 'ɪ'], ['k', 's']]);
    expect(result.plan[0].phonemeUnits?.[1].startSeconds).toBe(0.01);
    expect(result.plan[1].phonemeUnits?.[0].startSeconds).toBe(0.01);
    expect(result.plan.map((item) => item.pitch)).toEqual([1, 1.2, 1]);
    expect(result.plan.slice(1).every((item) => item.joinPrevious)).toBe(true);
    expect(result.tokens.filter((token) => token.kind !== 'marker').map((token) => token.spellingWord)).toEqual(['metrics', 'metrics', 'metrics']);
    expect(result.warnings).toContain('Scoped pronunciation boundaries in “metrics” use nearest IPA-phone alignment.');
  });

  it('uses English letter-name G2P for unrecorded uppercase acronyms while keeping A, I, lowercase a, and explicit clips distinct', () => {
    const letterPhones = new Map(['N', 'A', 'S'].map((letter) => [`letter:${letter}`, 'j']));
    const acronym = createWordPlan('NASA', phoneBank, undefined, phoneCatalog, letterPhones, true);
    expect(acronym.plan.map((item) => item.display)).toEqual(['N', 'A', 'S', 'A']);
    expect(acronym.plan.map((item) => [item.sourceStart, item.sourceEnd])).toEqual([[0, 1], [1, 2], [2, 3], [3, 4]]);
    expect(createWordPlan('A', phoneBank, undefined, phoneCatalog, new Map([['letter:A', 'j']]), true).plan[0].display).toBe('A');
    expect(createWordPlan('a I', phoneBank, undefined, phoneCatalog, new Map([['a', 'j'], ['i', 'j']]), true).plan.map((item) => item.display)).toEqual(['a', 'I']);
    expect(createWordPlan('B', phoneBank, undefined, phoneCatalog, new Map([['letter:B', 'j']]), true).plan[0].display).toBe('B');
    expect(createWordPlan('<clip id="a"/>', { ...phoneBank, clips: [...phoneBank.clips, { id: 'a', file: '/audio/a.opus', duration: 0.5, kind: 'word' }] }).plan[0].clipId).toBe('a');
  });

  it('accepts br and broadcast boundaries as void tags and rejects executable or mismatched markup', () => {
    const cueBank = { ...bank, clips: [...bank.clips,
      { id: 'start_beep', file: '/audio/start_beep.opus', duration: 0.2, kind: 'effect' as const },
      { id: 'end_beep', file: '/audio/end_beep.opus', duration: 0.2, kind: 'effect' as const },
    ] };
    const cues = createWordPlan('<start>cassie<br/>word<end/>', cueBank, { start: 'start_beep', end: 'end_beep' });
    expect(cues.plan.map((item) => item.clipId || item.pauseDuration)).toEqual(['start_beep', 'cassie', 0.5, 'word', 'end_beep']);
    const invalid = analyzeText('cassie <img src="x"> <pitch value="1.2">word</volume>', bank);
    expect(invalid.tokens.filter((token) => token.text.startsWith('<') || token.text.startsWith('</')).map((token) => token.kind)).toEqual(['error', 'error', 'error']);
    expect(invalid.words).toContain('cassie');
    expect(invalid.warnings.some((warning) => /Invalid markup|Mismatched closing|Unclosed markup/u.test(warning))).toBe(true);
  });

  it('keeps NATO letter recordings out of normal English while preserving explicit clip selection', () => {
    const letterBank = {
      ...bank,
      clips: [...bank.clips,
        { id: 'a', file: '/audio/a.opus', duration: 0.5, kind: 'word' as const },
        { id: 'i', file: '/audio/i.opus', duration: 0.5, kind: 'word' as const },
      ],
    };
    expect(createWordPlan('a I', letterBank, undefined, undefined, new Map(), true).unresolvedWords).toEqual(['a', 'I']);
    expect(createWordPlan('<clip id="a"/>', letterBank).plan[0].clipId).toBe('a');
  });

  it('allows direct effect clips and warns for unknown or unavailable cue assets', () => {
    const effectBank = {
      ...bank,
      clips: [...bank.clips, { id: 'cassie-background-std', file: '/audio/cassie-background-std.opus', duration: 39.43, kind: 'effect' as const }],
    };
    const result = analyzeText('<start/><clip id="cassie-background-std"/><clip id="not-in-bank"/><end/> cassie', effectBank);
    expect(result.words).toEqual(['cassie-background-std', 'cassie']);
    expect(result.warnings).toEqual([
      'The START cue is unavailable in this audio bank.',
      'Unknown audio clip ID: not-in-bank.',
      'The END cue is unavailable in this audio bank.',
    ]);
  });

  it('keeps bank ids with underscores intact and makes preview tolerant', () => {
    const suffixBank = { ...bank, clips: [...bank.clips, { id: '_suffix_plural_regular', file: '/audio/_suffix_plural_regular.opus', duration: 0.1, kind: 'word' as const }] };
    expect(analyzeText('_suffix_plural_regular', suffixBank).words).toEqual(['_suffix_plural_regular']);
    expect(analyzeText(' '.repeat(600), bank)).toEqual({ words: [], warnings: [], tokens: [] });
    expect(analyzeText('cassie '.repeat(513), bank).words).toEqual([]);
  });

  it('applies bounded scoped speech rate and restores the parent rate after the closing tag', () => {
    const result = createWordPlan('cassie <rate value="1.4">word</rate> apple', bank);
    expect(result.plan.map((item) => item.rate)).toEqual([1, 1.4, 1]);
    expect(analyzeText('<rate value="0.49">cassie</rate>', bank).tokens[0].kind).toBe('error');
  });

  it('rejects announcements without a playable word and bounds token count', () => {
    expect(analyzeText('not-in-bank', bank)).toMatchObject({ words: [] });
    expect(() => createWordPlan('not-in-bank', bank)).toThrow(/No playable words/);
    expect(analyzeText('cassie '.repeat(513), bank).words).toEqual([]);
    expect(() => createWordPlan('cassie '.repeat(513), bank)).toThrow(/512-token limit/);
  });

  it('marks invalid scoped values red and continues parsing speech', () => {
    const result = analyzeText('<pitch value="99">cassie</pitch> word', bank);
    expect(result.warnings.some((warning) => warning.includes('Invalid markup tag'))).toBe(true);
    expect(result.tokens[0].kind).toBe('error');
    expect(result.words).toContain('word');
  });

  it('rejects legacy dollar modifiers without treating them as spoken words', () => {
    const result = analyzeText('$PITCH_1.2 cassie', bank);
    expect(result.words).toEqual(['cassie']);
    expect(result.warnings).toContain('Dollar-prefixed syntax is unsupported: $PITCH_1.2');
    expect(result.tokens[0].kind).toBe('error');
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

  it('changes speech duration without changing its fundamental frequency', () => {
    const sampleRate = 48_000;
    const frequency = 440;
    const input = Float32Array.from({ length: sampleRate * 2 }, (_, index) => Math.sin(2 * Math.PI * frequency * index / sampleRate));
    const output = stretchSpeechRate(input, sampleRate, 1.25);
    expect(output.length).toBe(Math.ceil(input.length / 1.25));
    let crossings = 0;
    const start = Math.floor(sampleRate * 0.2);
    const end = output.length - start;
    for (let index = start; index < end - 1; index += 1) if (output[index] <= 0 && output[index + 1] > 0) crossings += 1;
    expect(crossings / ((end - start) / sampleRate)).toBeCloseTo(frequency, -1);
  });

  it('preserves annotated phrase gaps while stretching each speech span', () => {
    const sampleRate = 48_000;
    const input = Float32Array.from({ length: sampleRate }, (_, index) => Math.sin(2 * Math.PI * 220 * index / sampleRate));
    const result = stretchSpeechPreservingGaps(input, sampleRate, 1.25, [
      { startSeconds: 0.1, endSeconds: 0.4, sourceStart: 0, sourceEnd: 3, kind: 'word' },
      { startSeconds: 0.4, endSeconds: 0.6, sourceStart: 3, sourceEnd: 4, kind: 'gap' },
      { startSeconds: 0.6, endSeconds: 0.9, sourceStart: 5, sourceEnd: 8, kind: 'word' },
    ]);
    expect(result.samples.length).toBe(40_320);
    expect(result.timeline).toEqual([
      { startSeconds: 0.08, endSeconds: 0.32, sourceStart: 0, sourceEnd: 3, kind: 'word' },
      { startSeconds: 0.32, endSeconds: 0.52, sourceStart: 3, sourceEnd: 4, kind: 'gap' },
      { startSeconds: 0.52, endSeconds: 0.76, sourceStart: 5, sourceEnd: 8, kind: 'word' },
    ]);
  });

  it.each([0.5, 2])('keeps a short speech fragment audible at rate %s', (rate) => {
    const sampleRate = 48_000;
    const input = Float32Array.from({ length: 1_440 }, (_, index) => Math.sin(2 * Math.PI * 440 * index / sampleRate));
    const output = stretchSpeechRate(input, sampleRate, rate);
    const rms = Math.sqrt(output.reduce((sum, sample) => sum + sample * sample, 0) / output.length);
    expect(output.length).toBe(Math.ceil(input.length / rate));
    expect(rms).toBeGreaterThan(0.2);
  });

  it('inserts bounded stutter segments and mixes overlap with peak clamping', () => {
    expect([...applyStutter(new Float32Array([1, 2, 3, 4]), 4, { position: 0.5, length: 0.25, repeats: 2 })]).toEqual([1, 2, 3, 3, 3, 4]);
    const mixed = mixLayers([{ samples: new Float32Array([0.8, 0.1]), start: 0 }, { samples: new Float32Array([0.8]), start: 0 }]);
    expect(mixed[0]).toBe(1);
    expect(mixed[1]).toBeCloseTo(0.1);
  });

  it('uses speech gaps only between adjacent words, not around effect cues', () => {
    expect(nextClipStart(1, 'word', 'word', 0.24)).toBeCloseTo(1.24);
    expect(nextClipStart(1, 'word', 'effect', 0.24)).toBe(1);
    expect(nextClipStart(1.2, 'effect', 'word', 0.24)).toBe(1.2);
    expect(nextClipStart(0, undefined, 'effect', 0.24, 0.5)).toBe(0.5);
  });

  it('keeps following audio after the full repeated group when overlapping words shorten the cursor', () => {
    expect(advancePlaybackCursorAfterRepeat(0.96, 0.01, 17.53)).toEqual({ previousEnd: 17.53, previousStart: 17.53 });
  });

  it('maps phrase word and whitespace spans through crop, noninteger stutter points, repeats, and pitch', () => {
    const timeline = mapSourceTimeline([
      { startSample: 10, endSample: 25, sourceStart: 0, sourceEnd: 3, kind: 'word' },
      { startSample: 25, endSample: 35, sourceStart: 3, sourceEnd: 4, kind: 'gap' },
      { startSample: 35, endSample: 90, sourceStart: 5, sourceEnd: 11, kind: 'word' },
    ], 100, {
      startAt: 0.1,
      maxDuration: 0.8,
      pitch: 1,
      stutter: { position: 0.257, length: 0.1, repeats: 2 },
    }, 1.25, 100, 2, 80);
    const repeatedWord = timeline.filter((entry) => entry.kind === 'word' && entry.sourceStart === 5);
    const repeatedGap = timeline.filter((entry) => entry.kind === 'gap' && entry.sourceStart === 3);
    expect(repeatedWord).toHaveLength(3);
    expect(repeatedGap).toHaveLength(4);
    expect(timeline.every((entry) => entry.startSeconds >= 2 && entry.endSeconds <= 2.8 && entry.endSeconds > entry.startSeconds)).toBe(true);
  });

  it('maps speech highlighting through rate changes while leaving source gaps outside the word span', () => {
    const entries = mapSourceTimeline(
      [{ startSample: 0, endSample: 48_000, sourceStart: 0, sourceEnd: 4, kind: 'word' }],
      48_000,
      { pitch: 1, rate: 2 },
      1,
      48_000,
      2,
      24_000,
    );
    expect(entries).toEqual([{ startSeconds: 2, endSeconds: 2.5, sourceStart: 0, sourceEnd: 4, kind: 'word' }]);
  });

  it('omits zero-length pause and fully cropped audio spans from the timeline', () => {
    const timeline: ReturnType<typeof mapSourceTimeline> = [];
    expect(appendTimelineEntry(timeline, { startSeconds: 1, endSeconds: 1, sourceStart: 0, sourceEnd: 8, kind: 'gap' })).toBe(false);
    expect(appendTimelineEntry(timeline, { startSeconds: 2.5, endSeconds: 2.5, sourceStart: 9, sourceEnd: 13, kind: 'word' })).toBe(false);
    expect(appendTimelineEntry(timeline, { startSeconds: 1, endSeconds: 1.25, sourceStart: 0, sourceEnd: 8, kind: 'gap' })).toBe(true);
    expect(timeline).toEqual([{ startSeconds: 1, endSeconds: 1.25, sourceStart: 0, sourceEnd: 8, kind: 'gap' }]);
  });

  it('keeps timeline entries inside the final rendered PCM duration', () => {
    const timeline = [
      { startSeconds: 0, endSeconds: 0.5, sourceStart: 0, sourceEnd: 4, kind: 'word' as const },
      { startSeconds: 0.5, endSeconds: 0.75, sourceStart: 4, sourceEnd: 8, kind: 'gap' as const },
      { startSeconds: 0.75, endSeconds: 1, sourceStart: 8, sourceEnd: 13, kind: 'cue' as const },
    ];
    expect(clipTimelineToDuration(timeline, 0.6)).toEqual([
      timeline[0],
      { ...timeline[1], endSeconds: 0.6 },
    ]);
    expect(clipTimelineToDuration(timeline, 0.5)).toEqual([timeline[0]]);
  });

  it('lengthens vowel centers without changing pitch and fades phone sequence boundaries', () => {
    const sampleRate = 48_000;
    const vowel = Float32Array.from({ length: 4_800 }, (_, index) => Math.sin((index * Math.PI * 2 * 220) / sampleRate));
    const stretched = stretchVowelLoop(vowel, sampleRate, 1.7);
    const spliced = splicePhonemeWindows([vowel, vowel], sampleRate);
    expect(stretched.length).toBeGreaterThan(vowel.length * 1.65);
    expect(stretched.length).toBeLessThan(vowel.length * 1.75);
    expect(spliced.length).toBeLessThan(vowel.length * 2);
    expect(spliced[0]).toBeCloseTo(0, 2);
    expect(spliced.at(-1)).toBeCloseTo(0, 2);
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
  it('keeps unknown-only analysis tolerant and avoids launching an empty audio render', async () => {
    await expect(analyzeAnnouncement('cassie', bank)).resolves.toMatchObject({ words: ['cassie'], ipa: [] });
    await expect(analyzeAnnouncement('unrecordedword', bank)).resolves.toMatchObject({
      words: [],
      warnings: expect.arrayContaining(['No audio clip for “unrecordedword”.']),
      ipa: [],
    });
    await expect(analyzeAnnouncement('   ', bank)).resolves.toEqual({ words: [], warnings: [], ipa: [], tokens: [] });
    await expect(renderAnnouncement('unrecordedword', bank, { pitch: 1, volume: 1, gap: 0.24 }))
      .rejects.toThrow(/No audio clip|phoneme catalog is unavailable/i);
  });

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
          timeline: [{ startSeconds: 0, endSeconds: 1 / 48_000, sourceStart: 0, sourceEnd: 6, kind: 'word' }],
        } } as MessageEvent));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', MockWorker);
    try {
      const result = await renderAnnouncement('cassie', reactive(bank), { pitch: 1, volume: 1, gap: 0.24, phonemes: false });
      expect(result.words).toEqual(['cassie']);
      expect(result.timeline).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ignores queued progress and preview events after cancellation', async () => {
    let captured: MockWorker | undefined;
    class MockWorker {
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage() {}
      terminate() {}
      constructor() { captured = this; }
    }
    vi.stubGlobal('Worker', MockWorker);
    const controller = new AbortController();
    const onProgress = vi.fn();
    const onPreview = vi.fn();
    try {
      const rendering = renderAnnouncement('cassie', bank, { pitch: 1, volume: 1, gap: 0.24, phonemes: false }, onProgress, controller.signal, onPreview);
      await vi.waitFor(() => expect(captured).toBeDefined());
      controller.abort();
      await expect(rendering).rejects.toMatchObject({ name: 'AbortError' });
      captured?.onmessage?.({ data: { type: 'progress', value: 0.8 } } as MessageEvent);
      captured?.onmessage?.({ data: {
        type: 'preview', samples: new Float32Array([0.25]), sampleRate: 48_000, duration: 1 / 48_000,
        words: ['cassie'], warnings: [], timeline: [],
      } } as MessageEvent);
      expect(onProgress).not.toHaveBeenCalled();
      expect(onPreview).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
