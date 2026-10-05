import type { Bank, BankClip, WordPlan } from './types';

const MAX_TOKENS = 512;
const MAX_REPEAT = 32;
const MAX_NUMBER = 999_999_999_999;
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion'];

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
    result = [...unsigned.replace(/\D/g, '').split('').map((digit) => ONES[Number(digit)])];
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

function tokenPattern(text: string): RegExp {
  return /\$[A-Za-z]+_[^\s$]+|-?\d+(?:\.\d+)?|[\p{L}]+(?:['’][\p{L}]+)*(?:-[\p{L}]+)?/gu;
}

function resolveClip(token: string, lookup: Map<string, BankClip>): BankClip | undefined {
  const direct = lookup.get(normalize(token));
  if (direct) return direct;
  const candidates: string[] = [];
  const addStem = (stem: string) => {
    candidates.push(stem);
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) candidates.push(stem.slice(0, -1));
    if (stem.endsWith('i')) candidates.push(`${stem.slice(0, -1)}y`);
    candidates.push(`${stem}e`);
  };
  if (token.endsWith('ies') && token.length > 3) candidates.push(`${token.slice(0, -3)}y`);
  if (token.endsWith('es') && token.length > 2) candidates.push(token.slice(0, -2));
  if (token.endsWith('s') && token.length > 1) candidates.push(token.slice(0, -1));
  if (token.endsWith('ing') && token.length > 4) {
    const stem = token.slice(0, -3);
    addStem(stem);
  }
  if (token.endsWith('ed') && token.length > 3) {
    const stem = token.slice(0, -2);
    addStem(stem);
  }
  if (token.endsWith('er') && token.length > 3) {
    const stem = token.slice(0, -2);
    addStem(stem);
  }
  if (token.endsWith('est') && token.length > 4) {
    const stem = token.slice(0, -3);
    addStem(stem);
  }
  for (const candidate of candidates) {
    const clip = lookup.get(normalize(candidate));
    if (clip) return clip;
  }
  return undefined;
}

function finiteInRange(value: string, min: number, max: number): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

export function createWordPlan(text: string, bank: Bank): { plan: WordPlan[]; warnings: string[] } {
  const lookup = new Map(bank.clips.filter((clip) => clip.kind === 'word').map((clip) => [normalize(clip.id), clip]));
  const plan: WordPlan[] = [];
  const warnings: string[] = [];
  const tokens = [...text.matchAll(tokenPattern(text))].map((match) => match[0]);
  if (tokens.length > MAX_TOKENS) {
    throw new Error(`Announcement exceeds the ${MAX_TOKENS}-token limit.`);
  }
  let pitch = 1;
  let volume = 1;
  let pending: Omit<WordPlan, 'clipId' | 'display' | 'pitch' | 'volume'> = {};

  for (const raw of tokens) {
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

    const expanded = /^-?\d/.test(token) ? numberWords(token) : [token.replace(/[’]/g, "'")];
    for (const spoken of expanded) {
      if (plan.length >= MAX_TOKENS) throw new Error(`Announcement exceeds the ${MAX_TOKENS}-token limit.`);
      const clip = resolveClip(spoken, lookup);
      if (!clip) {
        warnings.push(`No audio clip for “${spoken}”.`);
        continue;
      }
      const item: WordPlan = { clipId: clip.id, display: spoken, pitch, volume, ...pending };
      plan.push(item);
      pending = {};
    }
  }
  if (!plan.length) throw new Error('No playable words were found in the announcement.');
  return { plan, warnings };
}

export function analyzeText(text: string, bank: Bank): { words: string[]; warnings: string[] } {
  const { plan, warnings } = createWordPlan(text, bank);
  return { words: plan.map((item) => item.display), warnings };
}

