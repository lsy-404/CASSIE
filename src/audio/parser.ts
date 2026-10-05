import type { AnalysisToken, Bank, BankClip, WordPlan } from './types';
import { announcementCueIds } from './catalog';
import { parseExplicitPhones, parseGeneratedPhones, resolvePhoneUnits } from './phonemes';
import type { PhonemeCatalog } from './phonemes';

const MAX_TOKENS = 512;
const MAX_INPUT_LENGTH = 8192;
const MAX_REPEAT = 32;
const MAX_NUMBER = 999_999_999_999;
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion'];
const NUMBER_CLIP_IDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
  seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50',
  sixty: '60', seventy: '70', eighty: '80', ninety: '90',
};

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US');
}

function wordsUnderThousand(value: number): string[] {
  const result: string[] = [];
  if (value >= 100) {
    result.push(ONES[Math.floor(value / 100)], 'hundred');
    value %= 100;
  }
  if (value >= 20) {
    result.push(TENS[Math.floor(value / 10)]);
    value %= 10;
  } else if (value >= 10) {
    result.push(TEENS[value - 10]);
    return result;
  }
  if (value > 0) result.push(ONES[value]);
  return result;
}

function numberWords(value: string): string[] {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerText, fraction] = unsigned.split('.');
  const integer = Number(integerText);
  let result: string[];
  if (!Number.isFinite(integer) || integer > MAX_NUMBER) {
    result = [...integerText.replace(/\D/g, '').split('').map((digit) => ONES[Number(digit)])];
  } else if (integer === 0) {
    result = ['zero'];
  } else {
    result = [];
    let remaining = integer;
    let scale = 0;
    while (remaining > 0) {
      const group = remaining % 1000;
      if (group) result.unshift(...wordsUnderThousand(group), ...(SCALES[scale] ? [SCALES[scale]] : []));
      remaining = Math.floor(remaining / 1000);
      scale += 1;
    }
  }
  if (negative) result.unshift('negative');
  if (fraction) result.push('point', ...fraction.split('').map((digit) => ONES[Number(digit)]));
  return result;
}

function tokenizeInput(text: string): { tokens: string[]; spans: Array<{ start: number; end: number }>; warnings: string[] } {
  const tokens: string[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  const warnings: string[] = [];
  const push = (value: string, start: number) => {
    tokens.push(value);
    spans.push({ start, end: start + value.length });
  };
  const command = /^\/(?:start|end)(?=$|[\s/])|^\/(?:pause|pitch|volume|offset|duration|spacing|stutter|clip)(?::[^\s/]*)?(?=$|[\s/])/iu;
  const ipaBlock = /^\/\s*[^/\r\n]{1,256}?\s*\//u;
  const legacy = /^\$[A-Za-z]+_[^\s$]+/u;
  const number = /^-?\d+(?:\.\d+)?/u;
  const word = /^[\p{L}_-][\p{L}\p{N}_-]*(?:['’][\p{L}]+)*/u;
  let cursor = 0;
  while (cursor < text.length) {
    if (/\s/u.test(text[cursor])) {
      cursor += 1;
      continue;
    }
    const remaining = text.slice(cursor);
    const slashCommand = remaining.match(command)?.[0];
    if (slashCommand) {
      push(slashCommand, cursor);
      cursor += slashCommand.length;
      continue;
    }
    const direct = remaining.match(ipaBlock)?.[0];
    if (direct) {
      push(direct, cursor);
      cursor += direct.length;
      continue;
    }
    const oldModifier = remaining.match(legacy)?.[0];
    if (oldModifier) {
      push(oldModifier, cursor);
      cursor += oldModifier.length;
      continue;
    }
    if (text[cursor] === '$') {
      const token = remaining.match(/^\$[^\s]*/u)?.[0] ?? '$';
      push(token, cursor);
      cursor += token.length;
      continue;
    }
    if (text[cursor] === '/') {
      if (/\s/u.test(text[cursor + 1] ?? '')) warnings.push('Unclosed IPA segment; text after the slash was parsed normally.');
      else push(remaining.match(/^\/[^\s]*/u)?.[0] ?? '/', cursor);
      cursor += text[cursor + 1] && !/\s/u.test(text[cursor + 1]) ? (tokens.at(-1)?.length ?? 1) : 1;
      continue;
    }
    const match = remaining.match(number)?.[0] ?? remaining.match(word)?.[0];
    if (match) {
      push(match, cursor);
      cursor += match.length;
    } else {
      cursor += 1;
    }
  }
  return { tokens, spans, warnings };
}

function resolveClip(token: string, lookup: Map<string, BankClip>, nextToken?: string): BankClip | undefined {
  if (token === 'the') {
    const nextWord = nextToken && /^-?\d/.test(nextToken) ? numberWords(nextToken)[0] : nextToken;
    const article = lookup.get(nextWord && /^[aeiou]/i.test(nextWord) ? 'the_vowel' : 'the_consonant');
    if (article) return article;
  }
  const direct = lookup.get(normalize(token));
  if (direct) return direct;
  const numeric = NUMBER_CLIP_IDS[normalize(token)];
  return numeric ? lookup.get(numeric) : undefined;
}

function finiteInRange(value: string, min: number, max: number): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

export interface AnnouncementCueIds {
  start: string | null;
  end: string | null;
}

function compileWordPlan(
  text: string,
  bank: Bank,
  cueIds: AnnouncementCueIds,
  phonemeCatalog?: PhonemeCatalog,
  phonemized: ReadonlyMap<string, string> = new Map(),
): { plan: WordPlan[]; warnings: string[]; unresolvedWords: string[]; tokens: AnalysisToken[] } {
  if (text.length > MAX_INPUT_LENGTH) throw new Error(`Announcement exceeds the ${MAX_INPUT_LENGTH}-character limit.`);
  const lookup = new Map(bank.clips.filter((clip) => clip.kind === 'word' && !/^[a-z]$/i.test(clip.id)).map((clip) => [normalize(clip.id), clip]));
  const clipLookup = new Map(bank.clips.map((clip) => [normalize(clip.id), clip]));
  const plan: WordPlan[] = [];
  const warnings: string[] = [];
  const unresolvedWords = new Set<string>();
  const classifications = new Map<number, AnalysisToken['kind']>();
  const scanned = tokenizeInput(text);
  const tokens = scanned.tokens;
  warnings.push(...scanned.warnings);
  if (tokens.length > MAX_TOKENS) {
    throw new Error(`Announcement exceeds the ${MAX_TOKENS}-token limit.`);
  }
  let pitch = 1;
  let volume = 1;
  let pending: Omit<WordPlan, 'clipId' | 'display' | 'pitch' | 'volume'> = {};
  const pushPlan = (item: WordPlan, firstToken: number, lastToken = firstToken, kind: NonNullable<WordPlan['timelineKind']> = 'word', classification: AnalysisToken['kind'] = 'recorded') => {
    for (let sourceToken = firstToken; sourceToken <= lastToken; sourceToken += 1) classifications.set(sourceToken, classification);
    plan.push({
      ...item,
      sourceStart: scanned.spans[firstToken]?.start ?? 0,
      sourceEnd: scanned.spans[lastToken]?.end ?? 0,
      timelineKind: kind,
    });
  };

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const raw = tokens[tokenIndex];
    const token = raw.toLocaleLowerCase('en-US');
    const directPhones = /^\/\s*(.*?)\s*\/$/u.exec(raw);
    if (directPhones) {
      if (!phonemeCatalog) {
        warnings.push('The phoneme catalog is unavailable; the IPA segment was skipped.');
        continue;
      }
      const parsed = parseExplicitPhones(directPhones[1], phonemeCatalog);
      if (parsed.warnings.length) {
        warnings.push(...parsed.warnings);
        continue;
      }
      const resolved = resolvePhoneUnits(parsed.phones, phonemeCatalog, bank);
      if (!resolved.units.length) {
        warnings.push(...resolved.warnings);
        continue;
      }
      warnings.push(...resolved.warnings);
      pushPlan({
        clipId: resolved.units[0].clipId,
        display: `IPA ${raw}`,
        pitch,
        volume,
        phonemeUnits: resolved.units,
        ...pending,
      }, tokenIndex, tokenIndex, 'word', resolved.warnings.length ? 'error' : 'synthesized');
      pending = {};
      continue;
    }
    if (token.startsWith('/')) {
      const slashCommand = /^\/(start|end|pause|pitch|volume|offset|duration|spacing|stutter|clip)(?::(.*))?$/iu.exec(raw);
      if (!slashCommand) {
        warnings.push(`Unsupported slash command: ${raw}`);
        continue;
      }
      const [, commandName, args = ''] = slashCommand;
      const name = commandName.toLocaleLowerCase('en-US');
      if (name === 'start' || name === 'end') {
        if (args) {
          warnings.push(`Invalid /${name} command: ${raw}`);
          continue;
        }
        const cueId = name === 'start' ? cueIds.start : cueIds.end;
        const cue = cueId ? clipLookup.get(normalize(cueId)) : undefined;
        if (!cue || cue.kind !== 'effect') {
          warnings.push(`The ${name.toUpperCase()} cue is unavailable in this audio bank.`);
          continue;
        }
        pushPlan({ clipId: cue.id, display: `${name} cue`, pitch, volume, ...pending }, tokenIndex, tokenIndex, 'cue', 'marker');
        classifications.set(tokenIndex, 'marker');
        pending = {};
        continue;
      }
      if (name === 'clip') {
        const clipId = /^[a-z0-9_-]+$/i.test(args) ? args : '';
        const clip = clipId ? clipLookup.get(normalize(clipId)) : undefined;
        if (!clip) {
          warnings.push(args ? `Unknown audio clip ID: ${args}.` : 'Invalid /clip command.');
          continue;
        }
        pushPlan({ clipId: clip.id, display: clip.id, pitch, volume, ...pending }, tokenIndex, tokenIndex, clip.kind === 'effect' ? 'cue' : 'word', 'marker');
        classifications.set(tokenIndex, 'marker');
        pending = {};
        continue;
      }
      if (name === 'pause') {
        const duration = finiteInRange(args, 0, 120);
        if (duration === undefined) {
          warnings.push(`Invalid /pause command: ${raw}`);
          continue;
        }
        pushPlan({ clipId: '', display: `pause ${duration}s`, pitch, volume, pauseDuration: duration, ...pending }, tokenIndex, tokenIndex, 'gap');
        classifications.set(tokenIndex, 'marker');
        pending = {};
        continue;
      }
      if (name === 'stutter') {
        const parts = args.split(':');
        if (parts.length !== 3) {
          warnings.push(`Invalid /stutter command: ${raw}`);
          continue;
        }
        const position = finiteInRange(parts[0], 0, 1);
        const length = finiteInRange(parts[1], Number.EPSILON, 120);
        const repeats = finiteInRange(parts[2], 1, MAX_REPEAT);
        if (position === undefined || length === undefined || repeats === undefined) {
          warnings.push(`Invalid /stutter command: ${raw}`);
          continue;
        }
        pending.stutter = { position, length, repeats: Math.floor(repeats) };
        classifications.set(tokenIndex, 'marker');
        continue;
      }
      if (!args) {
        warnings.push(`Invalid /${name} command: ${raw}`);
        continue;
      }
      const max = name === 'pitch' ? 15 : name === 'volume' ? 1 : 120;
      const min = name === 'pitch' ? 0.01 : name === 'volume' || name === 'offset' ? 0 : Number.EPSILON;
      const value = finiteInRange(args, min, max);
      if (value === undefined) {
        warnings.push(`Invalid /${name} command: ${raw}`);
        continue;
      }
      if (name === 'pitch') pitch = value;
      else if (name === 'volume') volume = value;
      else if (name === 'offset') pending.startAt = value;
      else if (name === 'duration') pending.maxDuration = value;
      else if (name === 'spacing') pending.spacing = value;
      classifications.set(tokenIndex, 'marker');
      continue;
    }
    if (token.startsWith('$')) {
      warnings.push(`Dollar-prefixed syntax is unsupported: ${raw}`);
      continue;
    }

    const phraseParts = [token];
    let phraseClip: BankClip | undefined;
    let phraseEnd = tokenIndex;
    for (let candidateIndex = tokenIndex + 1; candidateIndex < Math.min(tokens.length, tokenIndex + 12); candidateIndex += 1) {
      const candidate = tokens[candidateIndex].toLocaleLowerCase('en-US');
      if (candidate.startsWith('$') || candidate.startsWith('/')) break;
      phraseParts.push(candidate);
      const match = lookup.get(normalize(phraseParts.join('-')));
      if (match) {
        phraseClip = match;
        phraseEnd = candidateIndex;
      }
    }
    if (phraseClip) {
      const display = tokens.slice(tokenIndex, phraseEnd + 1).join(' ').toLocaleLowerCase('en-US');
      const timings = phonemeCatalog?.wordTimings?.[phraseClip.id];
      const sourceWordTimings: NonNullable<WordPlan['sourceWordTimings']> = [];
      if (timings?.length) {
        let sourceToken = tokenIndex;
        for (const timing of timings) {
          const expected = normalize(timing.text.replace(/[’']/gu, ''));
          while (sourceToken <= phraseEnd && normalize(tokens[sourceToken].replace(/[’']/gu, '')) !== expected) sourceToken += 1;
          if (sourceToken > phraseEnd) break;
          const span = scanned.spans[sourceToken];
          sourceWordTimings.push({ ...timing, sourceStart: span.start, sourceEnd: span.end });
          sourceToken += 1;
        }
      }
      pushPlan({ clipId: phraseClip.id, display, pitch, volume, ...(sourceWordTimings.length ? { sourceWordTimings } : {}), ...pending }, tokenIndex, phraseEnd);
      pending = {};
      tokenIndex = phraseEnd;
      continue;
    }

    const expanded = /^-?\d/.test(token) ? numberWords(token) : [token.replace(/[’]/g, "'")];
    const nextToken = tokens.slice(tokenIndex + 1).find((candidate) => !candidate.startsWith('$') && !candidate.startsWith('/'));
    for (const spoken of expanded) {
      if (plan.length >= MAX_TOKENS) throw new Error(`Announcement exceeds the ${MAX_TOKENS}-token limit.`);
      const clip = resolveClip(spoken, lookup, token === 'the' ? nextToken : undefined);
      const playableClip = clip;
      if (!playableClip) {
        const generatedPhones = phonemized.get(spoken.toLocaleLowerCase('en-US'));
        if (generatedPhones && phonemeCatalog) {
          const parsed = parseGeneratedPhones(generatedPhones, phonemeCatalog);
          const resolved = parsed.warnings.length
            ? { units: [], warnings: parsed.warnings }
            : resolvePhoneUnits(parsed.phones, phonemeCatalog, bank);
          if (!resolved.units.length) {
            warnings.push(...resolved.warnings.map((warning) => `“${spoken}”: ${warning}`));
            continue;
          }
          warnings.push(...resolved.warnings.map((warning) => `“${spoken}”: ${warning}`));
          if (plan.length >= MAX_TOKENS) throw new Error(`Announcement exceeds the ${MAX_TOKENS}-token limit.`);
          pushPlan({
            clipId: resolved.units[0].clipId,
            display: spoken,
            pitch,
            volume,
            phonemeUnits: resolved.units,
            ...pending,
          }, tokenIndex, tokenIndex, 'word', resolved.warnings.length ? 'error' : 'synthesized');
          pending = {};
          continue;
        }
        unresolvedWords.add(spoken.toLocaleLowerCase('en-US'));
        warnings.push(`No audio clip for “${spoken}”.`);
      classifications.set(tokenIndex, 'error');
        continue;
      }
      const item: WordPlan = {
        clipId: playableClip.id,
        display: spoken,
        pitch,
        volume,
        ...pending,
      };
      pushPlan(item, tokenIndex);
      pending = {};
    }
  }
  for (let index = 1; index < plan.length; index += 1) {
    const previousEnd = plan[index - 1].sourceEnd ?? 0;
    const currentStart = plan[index].sourceStart ?? 0;
    const between = text.slice(previousEnd, currentStart);
    const spaces = [...between.matchAll(/\s+/gu)];
    const lastSpace = spaces.at(-1);
    if (lastSpace?.index !== undefined) {
      const gapSourceStart = previousEnd + lastSpace.index;
      plan[index].gapSourceStart = gapSourceStart;
      plan[index].gapSourceEnd = gapSourceStart + lastSpace[0].length;
    }
  }
  const analyzedTokens = tokens.map((token, index) => ({
    sourceStart: scanned.spans[index].start,
    sourceEnd: scanned.spans[index].end,
    kind: classifications.get(index) ?? (token.startsWith('/') || token.startsWith('$') ? 'error' : 'error'),
    text: token,
  }));
  return { plan, warnings, unresolvedWords: [...unresolvedWords], tokens: analyzedTokens };
}

export function createWordPlan(
  text: string,
  bank: Bank,
  cueIds: AnnouncementCueIds = announcementCueIds,
  phonemeCatalog?: PhonemeCatalog,
  phonemized: ReadonlyMap<string, string> = new Map(),
  allowEmpty = false,
): { plan: WordPlan[]; warnings: string[]; unresolvedWords: string[]; tokens: AnalysisToken[] } {
  if (!text.trim()) throw new Error('No playable words were found in the announcement.');
  const result = compileWordPlan(text, bank, cueIds, phonemeCatalog, phonemized);
  if (!result.plan.length && !allowEmpty) throw new Error('No playable words were found in the announcement.');
  return result;
}

export function analyzeText(
  text: string,
  bank: Bank,
  cueIds: AnnouncementCueIds = announcementCueIds,
  phonemeCatalog?: PhonemeCatalog,
): { words: string[]; warnings: string[]; tokens: AnalysisToken[] } {
  if (!text.trim()) return { words: [], warnings: [], tokens: [] };
  let result: { plan: WordPlan[]; warnings: string[]; tokens: AnalysisToken[] };
  try {
    result = compileWordPlan(text, bank, cueIds, phonemeCatalog);
  } catch (error) {
    return { words: [], warnings: [error instanceof Error ? error.message : 'Could not analyze announcement.'], tokens: [] };
  }
  const { plan, warnings } = result;
  return { words: plan.map((item) => item.display), warnings, tokens: result.tokens };
}

