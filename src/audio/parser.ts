import type { Bank, BankClip, WordPlan } from './types';

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

function tokenPattern(): RegExp {
  return /\$[A-Za-z]+_[^\s$]+|-?\d+(?:\.\d+)?|[\p{L}_-][\p{L}\p{N}_-]*(?:['’][\p{L}]+)*/gu;
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

function inflection(token: string, lookup: Map<string, BankClip>): { clip: BankClip; prefix?: BankClip; suffix?: BankClip } | undefined {
  const suffixClip = (id: string) => lookup.get(id);
  const tryBases = (bases: string[], suffixId: string) => {
    const suffix = suffixClip(suffixId);
    if (!suffix) return undefined;
    for (const base of bases) {
      const clip = resolveClip(base, lookup);
      if (clip) return { clip, suffix };
    }
    return undefined;
  };
  const deduplicate = (stem: string) => stem.length > 2 && stem.at(-1) === stem.at(-2) ? stem.slice(0, -1) : '';

  for (const prefixId of ['anti-', 'post-', 'pre-', 'pro-', 'un-']) {
    const prefixText = prefixId.slice(0, -1);
    const base = token.startsWith(prefixId)
      ? token.slice(prefixId.length)
      : token.startsWith(prefixText)
        ? token.slice(prefixText.length)
        : '';
    const prefix = lookup.get(prefixId);
    const clip = base ? resolveClip(base, lookup) : undefined;
    if (prefix && clip) return { clip, prefix };
  }

  if (token.endsWith('-ish') || token.endsWith('ish')) {
    const base = token.slice(0, token.endsWith('-ish') ? -4 : -3);
    const generated = tryBases([base], '-ish');
    if (generated) return generated;
  }
  if (token.endsWith('-like') || token.endsWith('like')) {
    const base = token.slice(0, token.endsWith('-like') ? -5 : -4);
    const generated = tryBases([base], '-like');
    if (generated) return generated;
  }

  if (token.endsWith('ies') && token.length > 3) {
    return tryBases([`${token.slice(0, -3)}y`], '_suffix_plural_regular');
  }
  if (token.endsWith('es') && token.length > 2) {
    const base = token.slice(0, -2);
    const syllabic = /(?:s|x|z|ch|sh)$/.test(base);
    return tryBases([base], syllabic ? '_suffix_plural_syllabic' : '_suffix_plural_regular');
  }
  if (token.endsWith('s') && token.length > 1) {
    const base = token.slice(0, -1);
    const syllabic = /(?:s|x|z|ch|sh)$/.test(base);
    return tryBases([base], syllabic ? '_suffix_plural_syllabic' : '_suffix_plural_regular');
  }
  if (token.endsWith('ing') && token.length > 4) {
    const stem = token.slice(0, -3);
    return tryBases([stem, deduplicate(stem), `${stem}e`].filter(Boolean), '_suffix_ing');
  }
  if (token.endsWith('ied') && token.length > 4) {
    return tryBases([`${token.slice(0, -3)}y`], '_suffix_past_d');
  }
  if (token.endsWith('ed') && token.length > 3) {
    const stem = token.slice(0, -2);
    const bases = [stem, deduplicate(stem), `${stem}e`].filter(Boolean);
    for (const base of bases) {
      const ending = base.toLocaleLowerCase('en-US');
      const suffix = /(?:t|d)$/.test(ending) ? '_suffix_past_id' : /(?:p|k|f|s|x|ch|sh|c)$/.test(ending) ? '_suffix_past_t' : '_suffix_past_d';
      const result = tryBases([base], suffix);
      if (result) return result;
    }
  }
  if (token.endsWith('est') && token.length > 4) {
    const stem = token.slice(0, -3);
    return tryBases([stem, deduplicate(stem), `${stem}e`].filter(Boolean), '_suffix_est');
  }
  if (token.endsWith('er') && token.length > 3) {
    const stem = token.slice(0, -2);
    return tryBases([stem, deduplicate(stem), `${stem}e`].filter(Boolean), '_suffix_er');
  }
  return undefined;
}

function finiteInRange(value: string, min: number, max: number): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

function compileWordPlan(text: string, bank: Bank): { plan: WordPlan[]; warnings: string[] } {
  if (text.length > MAX_INPUT_LENGTH) throw new Error(`Announcement exceeds the ${MAX_INPUT_LENGTH}-character limit.`);
  const lookup = new Map(bank.clips.filter((clip) => clip.kind === 'word').map((clip) => [normalize(clip.id), clip]));
  const plan: WordPlan[] = [];
  const warnings: string[] = [];
  const tokens = [...text.matchAll(tokenPattern())].map((match) => match[0]);
  if (tokens.length > MAX_TOKENS) {
    throw new Error(`Announcement exceeds the ${MAX_TOKENS}-token limit.`);
  }
  let pitch = 1;
  let volume = 1;
  let pending: Omit<WordPlan, 'clipId' | 'display' | 'pitch' | 'volume'> = {};

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const raw = tokens[tokenIndex];
    const token = raw.toLocaleLowerCase('en-US');
    if (token.startsWith('$')) {
      const match = /^\$(PITCH|VOL|STARTT|MAXDUR|SLEEP|SPAC|STUTT)_(.+)$/i.exec(token);
      if (!match) {
        warnings.push(`Unsupported modifier: ${raw}`);
        continue;
      }
      const [, name, args] = match;
      if (name === 'stutt') {
        const parts = args.split('_');
        if (parts.length !== 3) {
          warnings.push(`Invalid stutter modifier: ${raw}`);
          continue;
        }
        const position = finiteInRange(parts[0], 0, 1);
        const length = finiteInRange(parts[1], Number.EPSILON, 120);
        const repeats = finiteInRange(parts[2], 1, MAX_REPEAT);
        if (position === undefined || length === undefined || repeats === undefined) {
          warnings.push(`Invalid stutter modifier: ${raw}`);
          continue;
        }
        pending.stutter = { position, length, repeats: Math.floor(repeats) };
        continue;
      }
      const max = name === 'pitch' ? 15 : name === 'vol' ? 1 : 120;
      const min = name === 'pitch' ? 0.01 : name === 'vol' ? 0 : name === 'startt' ? 0 : Number.EPSILON;
      const value = finiteInRange(args, min, max);
      if (value === undefined) {
        warnings.push(`Invalid ${name.toUpperCase()} modifier: ${raw}`);
        continue;
      }
      if (name === 'pitch') pitch = value;
      else if (name === 'vol') volume = value;
      else if (name === 'startt') pending.startAt = value;
      else if (name === 'maxdur') pending.maxDuration = value;
      else if (name === 'sleep') pending.sleep = value;
      else pending.spacing = value;
      continue;
    }

    const phraseParts = [token];
    let phraseClip: BankClip | undefined;
    let phraseEnd = tokenIndex;
    for (let candidateIndex = tokenIndex + 1; candidateIndex < Math.min(tokens.length, tokenIndex + 12); candidateIndex += 1) {
      const candidate = tokens[candidateIndex].toLocaleLowerCase('en-US');
      if (candidate.startsWith('$')) break;
      phraseParts.push(candidate);
      const match = lookup.get(normalize(phraseParts.join('-')));
      if (match) {
        phraseClip = match;
        phraseEnd = candidateIndex;
      }
    }
    if (phraseClip) {
      const display = tokens.slice(tokenIndex, phraseEnd + 1).join(' ').toLocaleLowerCase('en-US');
      plan.push({ clipId: phraseClip.id, display, pitch, volume, ...pending });
      pending = {};
      tokenIndex = phraseEnd;
      continue;
    }

    const expanded = /^-?\d/.test(token) ? numberWords(token) : [token.replace(/[’]/g, "'")];
    const nextToken = tokens.slice(tokenIndex + 1).find((candidate) => !candidate.startsWith('$'));
    for (const spoken of expanded) {
      if (plan.length >= MAX_TOKENS) throw new Error(`Announcement exceeds the ${MAX_TOKENS}-token limit.`);
      const clip = resolveClip(spoken, lookup, token === 'the' ? nextToken : undefined);
      const generated = clip ? undefined : inflection(spoken, lookup);
      const playableClip = clip ?? generated?.clip;
      if (!playableClip) {
        warnings.push(`No audio clip for “${spoken}”.`);
        continue;
      }
      const item: WordPlan = {
        clipId: playableClip.id,
        ...(generated?.prefix ? { prefixClipIds: [generated.prefix.id] } : {}),
        ...(generated?.suffix ? { suffixClipIds: [generated.suffix.id] } : {}),
        display: spoken,
        pitch,
        volume,
        ...pending,
      };
      plan.push(item);
      pending = {};
    }
  }
  return { plan, warnings };
}

export function createWordPlan(text: string, bank: Bank): { plan: WordPlan[]; warnings: string[] } {
  if (!text.trim()) throw new Error('No playable words were found in the announcement.');
  const result = compileWordPlan(text, bank);
  if (!result.plan.length) throw new Error('No playable words were found in the announcement.');
  return result;
}

export function analyzeText(text: string, bank: Bank): { words: string[]; warnings: string[] } {
  if (!text.trim()) return { words: [], warnings: [] };
  let result: { plan: WordPlan[]; warnings: string[] };
  try {
    result = compileWordPlan(text, bank);
  } catch (error) {
    return { words: [], warnings: [error instanceof Error ? error.message : 'Could not analyze announcement.'] };
  }
  const { plan, warnings } = result;
  return { words: plan.map((item) => item.display), warnings };
}

