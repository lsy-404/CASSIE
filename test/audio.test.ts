import { reactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { analyzeText, createWordPlan } from '../src/audio/parser';
import { analyzeAnnouncement, renderAnnouncement } from '../src/audio/engine';
import { applyStutter, encodeWav, mixLayers, monoFromChannels, nextClipStart, splicePhonemeWindows, stretchVowelLoop, transformWord } from '../src/audio/dsp';
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
  schemaVersion: 1,
  sourceBank: { version: bank.version, sha256: 'e'.repeat(64) },
  phones: {
    'ɑː': [{ clipId: 'phone-a', ipa: 'ˈɑː', startSeconds: 0.01, endSeconds: 0.09, sourceDurationSeconds: 0.1, sourceSha256: 'a'.repeat(64) }],
    'ɛ': [{ clipId: 'phone-e', ipa: 'ˈɛ', startSeconds: 0.01, endSeconds: 0.09, sourceDurationSeconds: 0.1, sourceSha256: 'b'.repeat(64) }],
    'j': [{ clipId: 'phone-j', ipa: 'j', startSeconds: 0.01, endSeconds: 0.09, sourceDurationSeconds: 0.1, sourceSha256: 'c'.repeat(64) }],
    'θ': [{ clipId: 'phone-th', ipa: 'θ', startSeconds: 0.01, endSeconds: 0.101, sourceDurationSeconds: 0.1, sourceSha256: 'd'.repeat(64) }],
    'dʒ': [],
  },
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

  it('applies persistent pitch/volume, explicit pauses, and one-word stutter modifiers', () => {
    const result = createWordPlan('/pitch:1.25 /volume:0.4 /pause:0.6 /stutter:0.1:0.1:3 cassie word', bank);
    expect(result.plan[0]).toMatchObject({ pitch: 1.25, volume: 0.4 });
    expect(result.plan[0]).toMatchObject({ pauseDuration: 0.6 });
    expect(result.plan[1]).toMatchObject({ pitch: 1.25, volume: 0.4, stutter: { position: 0.1, length: 0.1, repeats: 3 } });
    expect(result.warnings).toEqual([]);
  });

  it('retains the game timing and clip-selection modifiers', () => {
    const result = createWordPlan('/offset:0.1 /duration:0.3 cassie /spacing:0.8 word', bank);
    expect(result.plan[0]).toMatchObject({ startAt: 0.1, maxDuration: 0.3 });
    expect(result.plan[1]).toMatchObject({ spacing: 0.8 });
    expect(result.warnings).toEqual([]);
  });

  it('splices direct IPA, applies ASCII vowel aliases, and carries modifiers onto the segment', () => {
    const result = createWordPlan('/pitch:1.2 /volume:0.6 / a e: /', phoneBank, undefined, phoneCatalog);
    expect(result.plan[0]).toMatchObject({
      pitch: 1.2,
      volume: 0.6,
      phonemeUnits: [
        { clipId: 'phone-a', ipa: 'ɑː' },
        { clipId: 'phone-e', ipa: 'ɛ', stretchFactor: 1.7 },
      ],
    });
    expect(result.warnings).toEqual([]);
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

  it('canonicalizes measured-inventory variants in generated English IPA', () => {
    const inventory: PhonemeCatalog = {
      ...phoneCatalog,
      phones: {
        ...phoneCatalog.phones,
        'aɪ': [], 'ə': [], 'ɛ': [], 'ɜː': [], 'iː': [], 'ʌ': [], 'ɔː': [], 'ɔːɹ': [],
        w: [], k: [], s: [], p: [], l: [], n: [], ʃ: [], t: [],
      },
    };
    expect(parseGeneratedPhones('ɛksploːɹ', inventory)).toMatchObject({ phones: ['ɛ', 'k', 's', 'p', 'l', 'ɔːɹ'], warnings: [] });
    expect(parseGeneratedPhones('wˈɜːkʃiːt', inventory)).toMatchObject({ phones: ['w', 'ɜː', 'k', 'ʃ', 'iː', 't'], warnings: [] });
    expect(parseGeneratedPhones('ʌnsəpˈoːɹt', inventory)).toMatchObject({ phones: ['ʌ', 'n', 's', 'ə', 'p', 'ɔːɹ', 't'], warnings: [] });
    expect(parseGeneratedPhones('ˈaɪ', inventory)).toMatchObject({ phones: ['aɪ'], warnings: [] });
    expect(parseGeneratedPhones('ə', inventory)).toMatchObject({ phones: ['ə'], warnings: [] });
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
        b: [source('medial', 1, 0.01, 0.11, 'medial', 'ɛ', 't'), source('initial', 0, 0.01, 0.16, 'initial', null, 'ɛ')],
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
    expect(contiguous.units[0]).toMatchObject({ clipId: 'adjacent', startSeconds: 0.11, endSeconds: 0.2, ipa: 'bɛ' });
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
    const result = createWordPlan('/start cassie /clip:the_vowel /end', cueBank, { start: 'start_beep', end: 'end_beep' });
    expect(result.plan.map(({ clipId, display }) => [clipId, display])).toEqual([
      ['start_beep', 'start cue'],
      ['cassie', 'cassie'],
      ['the_vowel', 'the_vowel'],
      ['end_beep', 'end cue'],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('recognizes slash commands next to spaced IPA blocks and resumes after an unclosed block', () => {
    const direct = createWordPlan('/pause:0.5 / a e: /', phoneBank, undefined, phoneCatalog);
    expect(direct.plan.map((item) => item.timelineKind)).toEqual(['gap', 'word']);
    expect(direct.plan[1].phonemeUnits).toHaveLength(2);
    const incomplete = analyzeText('/ a cassie', bank);
    expect(incomplete.words).toEqual(['cassie']);
    expect(incomplete.warnings).toContain('Unclosed IPA segment; text after the slash was parsed normally.');
  });

  it('classifies slash markers and spoken source spans, including only actual spaces as gaps', () => {
    const plan = createWordPlan('cassie /pitch:1.1 word', bank).plan;
    expect(plan[1]).toMatchObject({ sourceStart: 18, sourceEnd: 22, gapSourceStart: 17, gapSourceEnd: 18 });
    expect(analyzeText('cassie /pitch:1.1 word', bank).tokens.map(({ kind }) => kind)).toEqual(['recorded', 'marker', 'recorded']);
    expect(createWordPlan('newword', phoneBank, undefined, phoneCatalog, new Map([['newword', 'j']]), true).tokens[0].kind).toBe('synthesized');
  });

  it('keeps NATO letter recordings out of normal English while preserving explicit clip selection', () => {
    const letterBank = {
      ...bank,
      clips: [...bank.clips,
        { id: 'a', file: '/audio/a.opus', duration: 0.5, kind: 'word' as const },
        { id: 'i', file: '/audio/i.opus', duration: 0.5, kind: 'word' as const },
      ],
    };
    expect(createWordPlan('a I', letterBank, undefined, undefined, new Map(), true).unresolvedWords).toEqual(['a', 'i']);
    expect(createWordPlan('/clip:a', letterBank).plan[0].clipId).toBe('a');
  });

  it('allows direct effect clips and warns for unknown or unavailable cue assets', () => {
    const effectBank = {
      ...bank,
      clips: [...bank.clips, { id: 'cassie-background-std', file: '/audio/cassie-background-std.opus', duration: 39.43, kind: 'effect' as const }],
    };
    const result = analyzeText('/start /clip:cassie-background-std /clip:not-in-bank /end cassie', effectBank);
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

  it('rejects announcements without a playable word and bounds token count', () => {
    expect(analyzeText('not-in-bank', bank)).toMatchObject({ words: [] });
    expect(() => createWordPlan('not-in-bank', bank)).toThrow(/No playable words/);
    expect(analyzeText('cassie '.repeat(513), bank).words).toEqual([]);
    expect(() => createWordPlan('cassie '.repeat(513), bank)).toThrow(/512-token limit/);
  });

  it('ignores out-of-range modifiers with a warning', () => {
    expect(analyzeText('/pitch:99 cassie', bank).warnings).toContain('Invalid /pitch command: /pitch:99');
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
    await expect(renderAnnouncement('unrecordedword', bank, { pitch: 1, volume: 1, gap: 0.24, background: false }))
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
      const result = await renderAnnouncement('cassie', reactive(bank), { pitch: 1, volume: 1, gap: 0.24, background: false });
      expect(result.words).toEqual(['cassie']);
      expect(result.timeline).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
