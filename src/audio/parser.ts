import type { AnalysisNotice, AnalysisToken, Bank, BankClip, PhonemeUnit, VoiceOptions, WordPlan } from './types';
import { announcementCueIds } from './catalog';
import { parseExplicitPhones, parseGeneratedPhones, resolvePhoneUnits } from './phonemes';
import type { PhonemeCatalog } from './phonemes';
import { ElementType, parseDocument } from 'htmlparser2';

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

const VOICE_RANGES: Record<string, [number, number]> = { pitch: [-12, 12], breathiness: [0, 1], formant: [-6, 6], loudness: [-24, 12], tension: [-1, 1] };

function valueRange(name: string): [number, number] {
  const min = name === 'pitch' ? 0.01 : name === 'volume' || name === 'offset' || name === 'pause' ? 0 : name === 'rate' ? 0.5 : name === 'fit' ? 0.05 : Number.EPSILON;
  const max = name === 'pitch' ? 15 : name === 'volume' ? 1 : name === 'rate' ? 2 : name === 'stutter' ? MAX_REPEAT : 120;
  return [min, max];
}

function withAttribute(raw: string, key: string, value: string): string {
  return raw.replace(new RegExp(`(\\b${key}\\s*=\\s*)(["'])[^"']*\\2`, 'iu'), (_match, head: string, quote: string) => `${head}${quote}${value}${quote}`);
}

function clampText(value: number, [min, max]: [number, number], integer = false): string {
  const floor = min > 0 && min < 0.01 ? (integer ? 1 : 0.01) : min;
  return String(Math.min(max, Math.max(floor, integer ? Math.round(value) : value)));
}

function numericFix(tag: MarkupTag, raw: string): string | undefined {
  const entries = tag.name === 'voice'
    ? Object.entries(tag.attrs).map(([key, value]) => ({ key, value, range: VOICE_RANGES[key] ?? [-1, 1] as [number, number], integer: false }))
    : [{ key: tag.name === 'stutter' ? 'repeats' : tag.name === 'pitch' || tag.name === 'volume' || tag.name === 'rate' ? 'value' : 'seconds', value: '', range: valueRange(tag.name), integer: tag.name === 'stutter' }]
      .map((entry) => ({ ...entry, value: tag.attrs[entry.key] ?? '' }));
  let fixed = raw;
  for (const { key, value, range, integer } of entries) {
    const number = Number(value);
    if (value.trim() === '' || !Number.isFinite(number)) return undefined;
    const text = clampText(number, range, integer);
    if (Number(text) !== number) fixed = withAttribute(fixed, key, text);
  }
  return fixed === raw ? undefined : fixed;
}

interface MarkupTag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: Record<string, string>;
  pairedIndex?: number;
  valid: boolean;
}

interface ScanResult {
  tokens: string[];
  spans: Array<{ start: number; end: number }>;
  notices: AnalysisNotice[];
  fixes: Map<number, { replacement: string }>;
  tags: Map<number, MarkupTag>;
  spaces: Array<{ start: number; end: number }>;
  spellingWord: Array<string | undefined>;
  inlineFragment: boolean[];
  inlineGroups: Map<number, number[]>;
  inlineGroupId: Array<number | undefined>;
  scopeAtToken: Array<{ pitch: number; volume: number; rate: number; voice?: Partial<VoiceOptions>; startAt?: number; maxDuration?: number; spacing?: number; fits?: Array<{ id: number; seconds: number }>; stutters: Array<{ id: number; repeats: number }> }>;
  stutterEnds: Map<number, number>;
}

const SCOPED_TAGS = new Set(['pitch', 'volume', 'rate', 'voice', 'stutter', 'offset', 'duration', 'spacing', 'fit']);
const MARKER_TAGS = new Set(['start', 'end', 'pause', 'clip', 'br']);

function parseMarkupTag(raw: string): MarkupTag | undefined {
  const close = /^<\/([A-Za-z][\w-]*)\s*>$/u.exec(raw);
  if (close) return { name: close[1].toLocaleLowerCase('en-US'), closing: true, selfClosing: false, attrs: {}, valid: false };
  const match = /^<([A-Za-z][\w-]*)([\s\S]*)>$/u.exec(raw);
  if (!match) return undefined;
  const name = match[1].toLocaleLowerCase('en-US');
  let attrText = match[2];
  const selfClosing = /\/\s*$/u.test(attrText);
  if (selfClosing) attrText = attrText.replace(/\/\s*$/u, '');
  const parsed = parseDocument(raw, { xmlMode: true, recognizeSelfClosing: true });
  if (parsed.children.length !== 1 || parsed.children[0].type !== ElementType.Tag ||
      (parsed.children[0] as { name?: string }).name?.toLocaleLowerCase('en-US') !== name) return undefined;
  const attrs: Record<string, string> = {};
  let cursor = 0;
  const attrPattern = /\s+([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
  while (cursor < attrText.length) {
    if (!attrText.slice(cursor).trim()) break;
    attrPattern.lastIndex = cursor;
    const attribute = attrPattern.exec(attrText);
    if (!attribute) return undefined;
    const key = attribute[1].toLocaleLowerCase('en-US');
    if (Object.hasOwn(attrs, key)) return undefined;
    attrs[key] = attribute[2] ?? attribute[3] ?? '';
    cursor = attrPattern.lastIndex;
  }
  return { name, closing: false, selfClosing, attrs, valid: false };
}

function tokenizeInput(text: string): ScanResult {
  const tokens: string[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  const notices: AnalysisNotice[] = [];
  const fixes = new Map<number, { replacement: string }>();
  const tags = new Map<number, MarkupTag>();
  const spaces: Array<{ start: number; end: number }> = [];
  const noticeAt = (severity: AnalysisNotice['severity'], text: string, index: number) => {
    notices.push({ severity, text, sourceStart: spans[index].start, sourceEnd: spans[index].end });
  };
  const push = (value: string, start: number, tag?: MarkupTag) => {
    tokens.push(value);
    spans.push({ start, end: start + value.length });
    if (tag) tags.set(tokens.length - 1, tag);
  };
  const ipaBlock = /^\/\s*[^/\r\n]{1,256}?\s*\//u;
  const number = /^-?\d+(?:\.\d+)?/u;
  const word = /^[\p{L}_-][\p{L}\p{N}_-]*(?:['’][\p{L}]+)*/u;
  let cursor = 0;
  while (cursor < text.length) {
    if (/\s/u.test(text[cursor])) {
      const start = cursor;
      cursor += 1;
      while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
      spaces.push({ start, end: cursor });
      continue;
    }
    const remaining = text.slice(cursor);
    if (text[cursor] === '<') {
      let quote = '';
      let end = cursor + 1;
      for (; end < text.length; end += 1) {
        const character = text[end];
        if (quote) {
          if (character === quote) quote = '';
        } else if (character === '"' || character === "'") quote = character;
        else if (character === '>') break;
      }
      if (end < text.length) {
        const raw = text.slice(cursor, end + 1);
        push(raw, cursor, parseMarkupTag(raw) ?? { name: '', closing: false, selfClosing: false, attrs: {}, valid: false });
        cursor = end + 1;
      } else {
        push('<', cursor, { name: '', closing: false, selfClosing: false, attrs: {}, valid: false });
        noticeAt('error', 'Malformed markup tag; the remaining text was parsed normally.', tokens.length - 1);
        cursor += 1;
      }
      continue;
    }
    const direct = remaining.match(ipaBlock)?.[0];
    if (direct) {
      push(direct, cursor);
      cursor += direct.length;
      continue;
    }
    if (text[cursor] === '$') {
      const token = remaining.match(/^\$[^\s]*/u)?.[0] ?? '$';
      push(token, cursor);
      noticeAt('error', `Dollar-prefixed syntax is unsupported: ${token}`, tokens.length - 1);
      cursor += token.length;
      continue;
    }
    if (text[cursor] === '/') {
      notices.push({ severity: 'warning', text: 'Unclosed IPA segment; text after the slash was parsed normally.', sourceStart: cursor, sourceEnd: cursor + 1 });
      cursor += 1;
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
  const stack: number[] = [];
  const unusableOpeners = new Set<number>();
  for (let index = 0; index < tokens.length; index += 1) {
    const tag = tags.get(index);
    if (!tag) continue;
    const validShape = tag.closing
      ? SCOPED_TAGS.has(tag.name) && !Object.keys(tag.attrs).length
      : SCOPED_TAGS.has(tag.name)
        ? !tag.selfClosing && (tag.name === 'voice'
          ? Object.keys(tag.attrs).length > 0 && Object.keys(tag.attrs).every((key) => ['pitch', 'breathiness', 'formant', 'loudness', 'tension'].includes(key))
          : Object.keys(tag.attrs).length === 1 && Object.hasOwn(tag.attrs, tag.name === 'stutter' ? 'repeats' : tag.name === 'pitch' || tag.name === 'volume' || tag.name === 'rate' ? 'value' : 'seconds'))
        : MARKER_TAGS.has(tag.name) && (tag.name === 'br' ? !Object.keys(tag.attrs).length : tag.name === 'pause' ? Object.keys(tag.attrs).length === 1 && Object.hasOwn(tag.attrs, 'seconds') : tag.name === 'clip' ? Object.keys(tag.attrs).length === 1 && Object.hasOwn(tag.attrs, 'id') : !Object.keys(tag.attrs).length);
    const valueName = tag.name === 'stutter' ? 'repeats' : tag.name === 'pitch' || tag.name === 'volume' || tag.name === 'rate' ? 'value' : 'seconds';
    const rawScopedValue = tag.attrs[valueName];
    const scopedValue = Number(rawScopedValue);
    const validVoice = tag.name !== 'voice' || Object.entries(tag.attrs).every(([key, raw]) => {
      const bounds = VOICE_RANGES[key] ?? [-1, 1];
      return raw.trim() !== '' && Number.isFinite(Number(raw)) && Number(raw) >= bounds[0] && Number(raw) <= bounds[1];
    });
    const [minValue, maxValue] = valueRange(tag.name);
    const validValue = tag.closing || tag.name === 'voice' ? tag.closing || validVoice : !SCOPED_TAGS.has(tag.name) && tag.name !== 'pause' ||
      rawScopedValue?.trim() !== '' && Number.isFinite(scopedValue) && scopedValue >= minValue && scopedValue <= maxValue &&
      (tag.name !== 'stutter' || Number.isInteger(scopedValue));
    if (!validShape || !validValue) {
      noticeAt('error', `Invalid markup tag: ${tokens[index]}`, index);
      const replacement = validShape ? numericFix(tag, tokens[index]) : undefined;
      if (replacement) fixes.set(index, { replacement });
      if (validShape && !tag.closing && SCOPED_TAGS.has(tag.name)) {
        unusableOpeners.add(index);
        stack.push(index);
      }
      continue;
    }
    if (tag.closing) {
      const openIndex = stack.at(-1);
      const open = openIndex === undefined ? undefined : tags.get(openIndex);
      if (!open || open.name !== tag.name) {
        noticeAt('error', `Mismatched closing tag: ${tokens[index]}`, index);
        if (stack.length <= 1) fixes.set(index, { replacement: open ? `</${open.name}>` : '' });
        while (stack.length) {
          const unmatched = tags.get(stack.pop()!);
          if (unmatched) unmatched.valid = false;
        }
        continue;
      }
      stack.pop();
      open.pairedIndex = index;
      tag.pairedIndex = openIndex;
      tag.valid = !unusableOpeners.has(openIndex!);
      open.valid = tag.valid;
    } else if (SCOPED_TAGS.has(tag.name)) {
      if (stack.length >= 32) {
        noticeAt('error', 'Markup nesting exceeds the 32-level limit.', index);
        unusableOpeners.add(index);
      }
      stack.push(index);
    } else {
      tag.valid = true;
    }
  }
  for (const index of stack) {
    const tag = tags.get(index);
    if (tag) noticeAt('error', `Unclosed markup tag: ${tokens[index]}`, index);
  }
  const spellingWord: Array<string | undefined> = Array(tokens.length).fill(undefined);
  const inlineFragment = Array(tokens.length).fill(false) as boolean[];
  const inlineGroupId: Array<number | undefined> = Array(tokens.length).fill(undefined);
  const inlineGroups = new Map<number, number[]>();
  let priorWordIndex = -1;
  let group = '';
  let groupId = 0;
  const wordIndexes = tokens.map((token, index) => /^-?[\p{L}\p{N}_-][\p{L}\p{N}_'’\-]*$/u.test(token) ? index : -1).filter((index) => index >= 0);
  for (const index of wordIndexes) {
    const previous = priorWordIndex;
    const betweenIndices = previous < 0 ? [] : Array.from({ length: index - previous - 1 }, (_, offset) => previous + offset + 1);
    const hasTextWhitespace = previous >= 0 && spaces.some((space) => space.start >= spans[previous].end && space.end <= spans[index].start);
    const joins = previous >= 0 && !hasTextWhitespace && betweenIndices.length > 0 && betweenIndices.every((betweenIndex) => {
      const tag = tags.get(betweenIndex);
      return Boolean(tag?.valid && SCOPED_TAGS.has(tag.name));
    });
    if (!joins) {
      group = tokens[index];
      groupId += 1;
    } else group += tokens[index];
    spellingWord[index] = group;
    inlineGroupId[index] = groupId;
    const groupIndexes = inlineGroups.get(groupId) ?? [];
    groupIndexes.push(index);
    inlineGroups.set(groupId, groupIndexes);
    inlineFragment[index] = joins;
    priorWordIndex = index;
  }
  for (const indexes of inlineGroups.values()) {
    const completeSpelling = indexes.map((index) => tokens[index]).join('');
    for (const index of indexes) {
      spellingWord[index] = completeSpelling;
      if (indexes.length > 1) inlineFragment[index] = true;
    }
  }
  const defaultScope = { pitch: 1, volume: 1, rate: 1, stutters: [] as Array<{ id: number; repeats: number }> };
  const scopeAtToken: ScanResult['scopeAtToken'] = Array.from({ length: tokens.length }, () => defaultScope);
  const stutterEnds = new Map<number, number>();
  type Scope = typeof defaultScope & { voice?: Partial<VoiceOptions>; startAt?: number; maxDuration?: number; spacing?: number; fits?: Array<{ id: number; seconds: number }> };
  const activeStack: Array<{ before: Scope; name: string; stutterId?: number }> = [];
  let activeScope: Scope = defaultScope;
  let nextScopeStutterId = 1;
  let nextScopeFitId = 1;
  for (let index = 0; index < tokens.length; index += 1) {
    const tag = tags.get(index);
    if (tag?.valid) {
      if (tag.closing) {
        const frame = activeStack.pop();
        if (frame) {
          activeScope = frame.before;
          if (frame.stutterId !== undefined) stutterEnds.set(index, frame.stutterId);
        }
      } else if (SCOPED_TAGS.has(tag.name)) {
        let stutterId: number | undefined;
        let next = { ...activeScope, ...(activeScope.voice ? { voice: { ...activeScope.voice } } : {}) };
        if (tag.name === 'voice') {
          const voice = { ...activeScope.voice };
          if (Object.hasOwn(tag.attrs, 'pitch')) voice.pitchSemitones = Number(tag.attrs.pitch);
          if (Object.hasOwn(tag.attrs, 'breathiness')) voice.breathiness = Number(tag.attrs.breathiness);
          if (Object.hasOwn(tag.attrs, 'formant')) voice.formantSemitones = Number(tag.attrs.formant);
          if (Object.hasOwn(tag.attrs, 'loudness')) voice.loudnessDb = Number(tag.attrs.loudness);
          if (Object.hasOwn(tag.attrs, 'tension')) voice.tension = Number(tag.attrs.tension);
          next.voice = voice;
          activeStack.push({ before: activeScope, name: tag.name });
          activeScope = next;
          scopeAtToken[index] = activeScope;
          continue;
        }
        const attr = tag.name === 'stutter' ? 'repeats' : tag.name === 'pitch' || tag.name === 'volume' || tag.name === 'rate' ? 'value' : 'seconds';
        const value = Number(tag.attrs[attr]);
        if (tag.name === 'pitch') next.pitch = value;
        else if (tag.name === 'volume') next.volume = value;
        else if (tag.name === 'rate') next.rate = value;
        else if (tag.name === 'offset') next.startAt = value;
        else if (tag.name === 'duration') next.maxDuration = value;
        else if (tag.name === 'spacing') next.spacing = value;
        else if (tag.name === 'fit') next.fits = [...(activeScope.fits ?? []), { id: nextScopeFitId++, seconds: value }];
        else {
          stutterId = nextScopeStutterId++;
          next.stutters = [...activeScope.stutters, { id: stutterId, repeats: value }];
        }
        activeStack.push({ before: activeScope, name: tag.name, stutterId });
        activeScope = next;
      }
    }
    scopeAtToken[index] = activeScope;
  }
  return { tokens, spans, notices, fixes, tags, spaces, spellingWord, inlineFragment, inlineGroups, inlineGroupId, scopeAtToken, stutterEnds };
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

function editDistance(left: ArrayLike<string>, right: ArrayLike<string>): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + Number(left[leftIndex - 1] !== right[rightIndex - 1]),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function closestClipId(id: string, clips: BankClip[]): string | undefined {
  if (id.length < 4) return undefined;
  const limit = id.length >= 8 ? 2 : 1;
  let best: string[] = [];
  let bestDistance = limit + 1;
  for (const clip of clips) {
    const distance = editDistance(normalize(id), normalize(clip.id));
    if (distance < bestDistance) { best = [clip.id]; bestDistance = distance; }
    else if (distance === bestDistance) best.push(clip.id);
  }
  return best.length === 1 ? best[0] : undefined;
}

function alignPhoneBoundary(fullPhones: string[], prefixPhones: string[], minimum: number): number {
  const distance = editDistance;
  let best = Math.max(minimum, 0);
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = Math.max(minimum, 0); index <= fullPhones.length; index += 1) {
    const score = distance(fullPhones.slice(0, index), prefixPhones);
    if (score < bestDistance || (score === bestDistance && index > best)) {
      best = index;
      bestDistance = score;
    }
  }
  return best;
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
  strict = false,
): { plan: WordPlan[]; notices: AnalysisNotice[]; unresolvedWords: string[]; tokens: AnalysisToken[] } {
  if (text.length > MAX_INPUT_LENGTH) throw new Error(`Announcement exceeds the ${MAX_INPUT_LENGTH}-character limit.`);
  const lookup = new Map(bank.clips.filter((clip) => clip.kind === 'word' && !/^[a-z]$/i.test(clip.id)).map((clip) => [normalize(clip.id), clip]));
  const clipLookup = new Map(bank.clips.map((clip) => [normalize(clip.id), clip]));
  const plan: WordPlan[] = [];
  const unresolvedWords = new Set<string>();
  const classifications = new Map<number, AnalysisToken['kind']>();
  const blocked = new Set<number>();
  const scanned = tokenizeInput(text);
  const tokens = scanned.tokens;
  const notices: AnalysisNotice[] = [...scanned.notices];
  const fixes = new Map(scanned.fixes);
  const notify = (severity: AnalysisNotice['severity'], message: string, first: number, last = first, range?: { start: number; end: number }) => {
    notices.push({ severity, text: message, sourceStart: range?.start ?? scanned.spans[first].start, sourceEnd: range?.end ?? scanned.spans[last].end });
  };
  const notifyAll = (severity: AnalysisNotice['severity'], messages: string[], first: number, last = first, prefix = '') => {
    for (const message of messages) notify(severity, `${prefix}${message}`, first, last);
  };
  const reportSynthesized = (word: string, units: PhonemeUnit[], phoneCount: number, first: number, last = first, range?: { start: number; end: number }) => {
    notify('info', `${word} → /${units.map((unit) => unit.ipa).join('')}/ synthesized from ${phoneCount} phonemes`, first, last, range);
  };
  const block = (word: string, first: number, last = first, range?: { start: number; end: number }) => {
    for (let index = first; index <= last; index += 1) { classifications.set(index, 'synthesized'); blocked.add(index); }
    notify('warning', `'${word}' can be synthesized from phonemes, but unrecorded-word synthesis is off`, first, last, range);
  };
  for (const [index, tag] of scanned.tags) classifications.set(index, tag.valid ? 'marker' : 'error');
  if (tokens.length > MAX_TOKENS) {
    throw new Error(`Announcement exceeds the ${MAX_TOKENS}-token limit.`);
  }
  const pushPlan = (item: WordPlan, firstToken: number, lastToken = firstToken, kind: NonNullable<WordPlan['timelineKind']> = 'word', classification: AnalysisToken['kind'] = 'recorded', sourceRange?: { start: number; end: number }) => {
    for (let sourceToken = firstToken; sourceToken <= lastToken; sourceToken += 1) classifications.set(sourceToken, classification);
    const scope = scanned.scopeAtToken[firstToken];
    const planned: WordPlan = {
      ...item,
      rate: item.rate ?? scope.rate,
      ...(item.voice ?? scope.voice ? { voice: item.voice ?? scope.voice } : {}),
      sourceStart: sourceRange?.start ?? scanned.spans[firstToken]?.start ?? 0,
      sourceEnd: sourceRange?.end ?? scanned.spans[lastToken]?.end ?? 0,
      timelineKind: kind,
      ...(scope.fits ? { fits: scope.fits.map((group) => ({ ...group })) } : {}),
      ...(scope.stutters.length ? { stutterScopes: scope.stutters.map((active) => ({ ...active })) } : {}),
    };
    plan.push(planned);
  };

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const raw = tokens[tokenIndex];
    const token = raw.toLocaleLowerCase('en-US');
    const scope = scanned.scopeAtToken[tokenIndex];
    const pitch = scope.pitch;
    const volume = scope.volume;
    const startAt = scope.startAt;
    const maxDuration = scope.maxDuration;
    const spacing = scope.spacing;
    const directPhones = /^\/\s*(.*?)\s*\/$/u.exec(raw);
    if (directPhones) {
      if (!phonemeCatalog) {
        notify('error', 'The phoneme catalog is unavailable; the IPA segment was skipped.', tokenIndex);
        continue;
      }
      const parsed = parseExplicitPhones(directPhones[1], phonemeCatalog);
      if (parsed.warnings.length) {
        notifyAll('error', parsed.warnings, tokenIndex);
        continue;
      }
      const resolved = resolvePhoneUnits(parsed.phones, phonemeCatalog, bank);
      if (!resolved.units.length) {
        notifyAll('error', resolved.warnings, tokenIndex);
        continue;
      }
      notifyAll('warning', resolved.warnings, tokenIndex);
      reportSynthesized(`IPA ${raw}`, resolved.units, parsed.phones.length, tokenIndex);
      pushPlan({
        clipId: resolved.units[0].clipId,
        display: `IPA ${raw}`,
        pitch,
        volume,
        phonemeUnits: resolved.units,
        ...(startAt !== undefined ? { startAt } : {}),
        ...(maxDuration !== undefined ? { maxDuration } : {}),
        ...(spacing !== undefined ? { spacing } : {}),
      }, tokenIndex, tokenIndex, 'word', 'synthesized');
      continue;
    }
    const tag = scanned.tags.get(tokenIndex);
    if (tag) {
      if (!tag.valid) {
        classifications.set(tokenIndex, 'error');
        continue;
      }
      const name = tag.name;
      if (tag.closing || SCOPED_TAGS.has(name)) {
        classifications.set(tokenIndex, 'marker');
        continue;
      }
      if (name === 'br' || name === 'pause') {
        const duration = name === 'br' ? 0.5 : finiteInRange(tag.attrs.seconds ?? '', 0, 120);
        if (duration === undefined) {
          notify('error', `Invalid markup tag: ${raw}`, tokenIndex);
          classifications.set(tokenIndex, 'error');
          continue;
        }
        pushPlan({ clipId: '', display: `pause ${duration}s`, pitch, volume, pauseDuration: duration, ...(startAt !== undefined ? { startAt } : {}), ...(spacing !== undefined ? { spacing } : {}) }, tokenIndex, tokenIndex, 'gap', 'marker');
      } else if (name === 'start' || name === 'end') {
        const cueId = name === 'start' ? cueIds.start : cueIds.end;
        const cue = cueId ? clipLookup.get(normalize(cueId)) : undefined;
        if (!cue || cue.kind !== 'effect') {
          notify('error', `The ${name.toUpperCase()} cue is unavailable in this audio bank.`, tokenIndex);
          classifications.set(tokenIndex, 'error');
          continue;
        }
        else pushPlan({ clipId: cue.id, display: `${name} cue`, pitch, volume, ...(startAt !== undefined ? { startAt } : {}), ...(maxDuration !== undefined ? { maxDuration } : {}), ...(spacing !== undefined ? { spacing } : {}) }, tokenIndex, tokenIndex, 'cue', 'marker');
      } else if (name === 'clip') {
        const clip = /^[a-z0-9_-]+$/i.test(tag.attrs.id ?? '') ? clipLookup.get(normalize(tag.attrs.id)) : undefined;
        if (!clip) {
          notify('error', `Unknown audio clip ID: ${tag.attrs.id ?? ''}.`, tokenIndex);
          const suggestion = /^[a-z0-9_-]+$/i.test(tag.attrs.id ?? '') ? closestClipId(tag.attrs.id, bank.clips) : undefined;
          if (suggestion) fixes.set(tokenIndex, { replacement: withAttribute(raw, 'id', suggestion) });
          classifications.set(tokenIndex, 'error');
          continue;
        }
        else pushPlan({ clipId: clip.id, display: clip.id, pitch, volume, ...(startAt !== undefined ? { startAt } : {}), ...(maxDuration !== undefined ? { maxDuration } : {}), ...(spacing !== undefined ? { spacing } : {}) }, tokenIndex, tokenIndex, clip.kind === 'effect' ? 'cue' : 'word', 'marker');
      }
      classifications.set(tokenIndex, 'marker');
      continue;
    }
    if (raw.startsWith('/')) {
      notify('error', `Unsupported slash command: ${raw}`, tokenIndex);
      classifications.set(tokenIndex, 'error');
      continue;
    }
    if (token.startsWith('$')) {
      classifications.set(tokenIndex, 'error');
      continue;
    }

    const phraseParts = [token];
    let phraseClip: BankClip | undefined;
    let phraseEnd = tokenIndex;
    for (let candidateIndex = tokenIndex + 1; candidateIndex < Math.min(tokens.length, tokenIndex + 12); candidateIndex += 1) {
      const candidate = tokens[candidateIndex].toLocaleLowerCase('en-US');
      if (candidate.startsWith('$') || candidate.startsWith('/') || candidate.startsWith('<')) break;
      const priorSpan = scanned.spans[candidateIndex - 1];
      if (!scanned.spaces.some((space) => space.start >= priorSpan.end && space.end <= scanned.spans[candidateIndex].start)) break;
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
      pushPlan({ clipId: phraseClip.id, display, pitch, volume, ...(startAt !== undefined ? { startAt } : {}), ...(maxDuration !== undefined ? { maxDuration } : {}), ...(spacing !== undefined ? { spacing } : {}), ...(sourceWordTimings.length ? { sourceWordTimings } : {}) }, tokenIndex, phraseEnd);
      tokenIndex = phraseEnd;
      continue;
    }

    const fullWord = scanned.spellingWord[tokenIndex] ?? raw;
    const inlineGroup = scanned.inlineGroupId[tokenIndex];
    const inlineIndexes = inlineGroup === undefined ? undefined : scanned.inlineGroups.get(inlineGroup);
    if (scanned.inlineFragment[tokenIndex] && inlineIndexes?.[0] === tokenIndex) {
      const fullPronunciation = phonemized.get(fullWord.toLocaleLowerCase('en-US'));
      if (!phonemeCatalog || !fullPronunciation) {
        unresolvedWords.add(fullWord.toLocaleLowerCase('en-US'));
        for (let fragment = 0; fragment < inlineIndexes.length - 1; fragment += 1) {
          const prefix = inlineIndexes.slice(0, fragment + 1).map((part) => tokens[part]).join('').toLocaleLowerCase('en-US');
          unresolvedWords.add(prefix);
        }
        notify('error', `No audio clip for “${fullWord}”.`, inlineIndexes[0], inlineIndexes.at(-1)!);
        for (const index of inlineIndexes) classifications.set(index, 'error');
        tokenIndex = inlineIndexes.at(-1)!;
        continue;
      }
      const lastFragment = inlineIndexes.at(-1)!;
      const complete = parseGeneratedPhones(fullPronunciation, phonemeCatalog);
      if (complete.warnings.length) {
        notifyAll('error', complete.warnings, inlineIndexes[0], lastFragment, `“${fullWord}”: `);
        for (const index of inlineIndexes) classifications.set(index, 'error');
        tokenIndex = inlineIndexes.at(-1)!;
        continue;
      }
      const completeResolution = resolvePhoneUnits(complete.phones, phonemeCatalog, bank, false);
      if (!completeResolution.units.length) {
        notifyAll('error', completeResolution.warnings, inlineIndexes[0], lastFragment, `“${fullWord}”: `);
        for (const index of inlineIndexes) classifications.set(index, 'error');
        tokenIndex = inlineIndexes.at(-1)!;
        continue;
      }
      if (strict) {
        block(fullWord, inlineIndexes[0], lastFragment);
        tokenIndex = lastFragment;
        continue;
      }
      notifyAll('warning', completeResolution.warnings, inlineIndexes[0], lastFragment, `“${fullWord}”: `);
      const boundaries = [0];
      for (let fragment = 0; fragment < inlineIndexes.length - 1; fragment += 1) {
        const prefix = inlineIndexes.slice(0, fragment + 1).map((part) => tokens[part]).join('').toLocaleLowerCase('en-US');
        const prefixPronunciation = phonemized.get(prefix);
        if (!prefixPronunciation) {
          unresolvedWords.add(prefix);
          notify('warning', `Could not align the scoped pronunciation boundary in “${fullWord}”.`, inlineIndexes[0], lastFragment);
          boundaries.push(boundaries.at(-1)!);
          continue;
        }
        const prefixPhones = parseGeneratedPhones(prefixPronunciation, phonemeCatalog);
        if (prefixPhones.warnings.length) {
          notify('warning', `Could not align the scoped pronunciation boundary in “${fullWord}”.`, inlineIndexes[0], lastFragment);
          boundaries.push(boundaries.at(-1)!);
          continue;
        }
        boundaries.push(alignPhoneBoundary(complete.phones, prefixPhones.phones, boundaries.at(-1)!));
      }
      boundaries.push(complete.phones.length);
      notify('warning', `Scoped pronunciation boundaries in “${fullWord}” use nearest IPA-phone alignment.`, inlineIndexes[0], lastFragment);
      let allFragmentsRendered = true;
      for (let fragment = 0; fragment < inlineIndexes.length; fragment += 1) {
        const sourceToken = inlineIndexes[fragment];
        const units = completeResolution.units.slice(boundaries[fragment], boundaries[fragment + 1]);
        if (!units.length) {
          notify('error', `The scoped text fragment “${tokens[sourceToken]}” maps to no IPA phones.`, sourceToken);
          classifications.set(sourceToken, 'error');
          allFragmentsRendered = false;
          continue;
        }
        const fragmentScope = scanned.scopeAtToken[sourceToken];
        pushPlan({
          clipId: units[0].clipId,
          display: fullWord,
          pitch: fragmentScope.pitch,
          volume: fragmentScope.volume,
          phonemeUnits: units,
          ...(fragmentScope.startAt !== undefined ? { startAt: fragmentScope.startAt } : {}),
          ...(fragmentScope.maxDuration !== undefined ? { maxDuration: fragmentScope.maxDuration } : {}),
          ...(fragmentScope.spacing !== undefined ? { spacing: fragmentScope.spacing } : {}),
          ...(fragment > 0 ? { joinPrevious: true } : {}),
        }, sourceToken, sourceToken, 'word', 'synthesized');
      }
      if (allFragmentsRendered) reportSynthesized(fullWord, completeResolution.units, complete.phones.length, inlineIndexes[0], lastFragment);
      tokenIndex = inlineIndexes.at(-1)!;
      continue;
    }
    const isUppercaseSpelling = (/^[A-Z]+$/u.test(fullWord) && fullWord !== 'I') && !resolveClip(fullWord, lookup);
    if (isUppercaseSpelling) {
      const letters = [...raw];
      const letterUnits: PhonemeUnit[] = [];
      let letterPhones = 0;
      let lettersOk = true;
      for (let letterIndex = 0; letterIndex < letters.length; letterIndex += 1) {
        const letter = letters[letterIndex].toLocaleUpperCase('en-US');
        const generatedPhones = phonemized.get(`letter:${letter}`);
        const sourceRange = { start: scanned.spans[tokenIndex].start + letterIndex, end: scanned.spans[tokenIndex].start + letterIndex + 1 };
        if (!generatedPhones || !phonemeCatalog) {
          unresolvedWords.add(`letter:${letter}`);
          notify('error', `No verified letter-name pronunciation for “${letter}”.`, tokenIndex, tokenIndex, sourceRange);
          lettersOk = false;
          continue;
        }
        const parsed = parseGeneratedPhones(generatedPhones, phonemeCatalog);
        const resolved = parsed.warnings.length ? { units: [], warnings: parsed.warnings } : resolvePhoneUnits(parsed.phones, phonemeCatalog, bank);
        if (!resolved.units.length) {
          notifyAll('error', resolved.warnings, tokenIndex, tokenIndex, `“${letter}”: `);
          lettersOk = false;
          continue;
        }
        notifyAll('warning', resolved.warnings, tokenIndex, tokenIndex, `“${letter}”: `);
        letterUnits.push(...resolved.units);
        letterPhones += parsed.phones.length;
        if (strict) continue;
        pushPlan({ clipId: resolved.units[0].clipId, display: letter, pitch, volume, phonemeUnits: resolved.units, ...(startAt !== undefined ? { startAt } : {}), ...(maxDuration !== undefined ? { maxDuration } : {}), ...(spacing !== undefined ? { spacing } : {}), ...(letterIndex > 0 ? { joinPrevious: true } : {}) }, tokenIndex, tokenIndex, 'word', 'synthesized', sourceRange);
      }
      if (!lettersOk) classifications.set(tokenIndex, 'error');
      else if (strict) block(raw, tokenIndex);
      else reportSynthesized(raw, letterUnits, letterPhones, tokenIndex);
      continue;
    }
    const expanded = /^-?\d/.test(token) ? numberWords(token) : [raw === 'I' ? 'I' : token.replace(/[’]/g, "'")];
    const nextToken = tokens.slice(tokenIndex + 1).find((candidate) => !candidate.startsWith('$') && !candidate.startsWith('/') && !candidate.startsWith('<'));
    const planStart = plan.length;
    const outcomes: Array<'recorded' | 'synthesized' | 'blocked' | 'error'> = [];
    for (const spoken of expanded) {
      if (plan.length >= MAX_TOKENS) throw new Error(`Announcement exceeds the ${MAX_TOKENS}-token limit.`);
      const inlineFragment = scanned.inlineFragment[tokenIndex];
      const clip = inlineFragment ? undefined : resolveClip(spoken, lookup, token === 'the' ? nextToken : undefined);
      const playableClip = clip;
      if (!playableClip) {
        const generatedPhones = phonemized.get(spoken.toLocaleLowerCase('en-US'));
        if (generatedPhones && phonemeCatalog) {
          const parsed = parseGeneratedPhones(generatedPhones, phonemeCatalog);
          const resolved = parsed.warnings.length
            ? { units: [], warnings: parsed.warnings }
            : resolvePhoneUnits(parsed.phones, phonemeCatalog, bank);
          if (!resolved.units.length) {
            notifyAll('error', resolved.warnings, tokenIndex, tokenIndex, `“${spoken}”: `);
            outcomes.push('error');
            continue;
          }
          if (strict) {
            block(spoken, tokenIndex);
            outcomes.push('blocked');
            continue;
          }
          notifyAll('warning', resolved.warnings, tokenIndex, tokenIndex, `“${spoken}”: `);
          reportSynthesized(spoken, resolved.units, parsed.phones.length, tokenIndex);
          if (plan.length >= MAX_TOKENS) throw new Error(`Announcement exceeds the ${MAX_TOKENS}-token limit.`);
          pushPlan({
            clipId: resolved.units[0].clipId,
            display: spoken,
            pitch,
            volume,
            phonemeUnits: resolved.units,
            ...(startAt !== undefined ? { startAt } : {}),
            ...(maxDuration !== undefined ? { maxDuration } : {}),
            ...(spacing !== undefined ? { spacing } : {}),
            ...(inlineFragment && plan.length ? { joinPrevious: true } : {}),
          }, tokenIndex, tokenIndex, 'word', 'synthesized');
          outcomes.push('synthesized');
          continue;
        }
        unresolvedWords.add(raw === 'I' ? 'I' : spoken.toLocaleLowerCase('en-US'));
        notify('error', `No audio clip for “${spoken}”.`, tokenIndex);
        classifications.set(tokenIndex, 'error');
        outcomes.push('error');
        continue;
      }
      const item: WordPlan = {
        clipId: playableClip.id,
        display: spoken,
        pitch,
        volume,
        ...(startAt !== undefined ? { startAt } : {}),
        ...(maxDuration !== undefined ? { maxDuration } : {}),
        ...(spacing !== undefined ? { spacing } : {}),
      };
      pushPlan(item, tokenIndex, tokenIndex, 'word', 'recorded');
      outcomes.push('recorded');
    }
    if (outcomes.length > 1) {
      const failed = outcomes.includes('error');
      if (failed || outcomes.includes('blocked')) plan.length = planStart;
      if (failed) blocked.delete(tokenIndex);
      classifications.set(tokenIndex, failed ? 'error' : outcomes.includes('blocked') || outcomes.includes('synthesized') ? 'synthesized' : 'recorded');
    }
  }
  for (const [tokenIndex, id] of scanned.stutterEnds) {
    const source = scanned.spans[tokenIndex].start;
    let last = -1;
    for (let index = 0; index < plan.length; index += 1) {
      if ((plan[index].sourceEnd ?? 0) <= source && plan[index].stutterScopes?.some((scope) => scope.id === id)) last = index;
    }
    if (last >= 0) plan[last].stutterScopeEnds = [...(plan[last].stutterScopeEnds ?? []), id];
  }
  for (let index = 1; index < plan.length; index += 1) {
    const previousEnd = plan[index - 1].sourceEnd ?? 0;
    const currentStart = plan[index].sourceStart ?? 0;
    const gap = scanned.spaces.filter((space) => space.start >= previousEnd && space.end <= currentStart).at(-1);
    if (gap) {
      plan[index].gapSourceStart = gap.start;
      plan[index].gapSourceEnd = gap.end;
    }
  }
  const analyzedTokens = tokens.map((token, index) => {
    const hint = scanned.spellingWord[index];
    const hasSpellingHint = Boolean(hint) && !/^[A-Z]{2,}$/u.test(hint!) && hint !== 'A' && hint !== 'I';
    return {
      sourceStart: scanned.spans[index].start,
      sourceEnd: scanned.spans[index].end,
      kind: classifications.get(index) ?? 'error',
      text: token,
      ...(hasSpellingHint ? { spellingWord: hint } : {}),
      ...(blocked.has(index) ? { blocked: true } : {}),
      ...(fixes.has(index) ? { fix: fixes.get(index) } : {}),
    };
  });
  return { plan, notices, unresolvedWords: [...unresolvedWords], tokens: analyzedTokens };
}

export function createWordPlan(
  text: string,
  bank: Bank,
  cueIds: AnnouncementCueIds = announcementCueIds,
  phonemeCatalog?: PhonemeCatalog,
  phonemized: ReadonlyMap<string, string> = new Map(),
  allowEmpty = false,
  strict = false,
): { plan: WordPlan[]; notices: AnalysisNotice[]; unresolvedWords: string[]; tokens: AnalysisToken[] } {
  if (!text.trim()) throw new Error('No playable words were found in the announcement.');
  const result = compileWordPlan(text, bank, cueIds, phonemeCatalog, phonemized, strict);
  if (!result.plan.length && !allowEmpty) throw new Error('No playable words were found in the announcement.');
  return result;
}

export function analyzeText(
  text: string,
  bank: Bank,
  cueIds: AnnouncementCueIds = announcementCueIds,
  phonemeCatalog?: PhonemeCatalog,
): { words: string[]; notices: AnalysisNotice[]; tokens: AnalysisToken[] } {
  if (!text.trim()) return { words: [], notices: [], tokens: [] };
  let result: { plan: WordPlan[]; notices: AnalysisNotice[]; tokens: AnalysisToken[] };
  try {
    result = compileWordPlan(text, bank, cueIds, phonemeCatalog, new Map(), false);
  } catch (error) {
    return { words: [], notices: [{ severity: 'error', text: error instanceof Error ? error.message : 'Could not analyze announcement.' }], tokens: [] };
  }
  return { words: result.plan.map((item) => item.display), notices: result.notices, tokens: result.tokens };
}
