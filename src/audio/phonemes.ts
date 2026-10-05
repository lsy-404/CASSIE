import type { Bank, BankClip, PhonemeUnit } from './types';

export interface PhonemeWindow {
  clipId: string;
  ipa: string;
  startSeconds: number;
  endSeconds: number;
  sourceDurationSeconds: number;
  sourceSha256: string;
  position?: 'initial' | 'medial' | 'final' | 'single';
  previousIpa?: string | null;
  nextIpa?: string | null;
}

export interface PhonemeCatalog {
  schemaVersion: number;
  sourceBank: { version: string; sha256: string };
  phones: Record<string, PhonemeWindow[]>;
  wordTimings?: Record<string, Array<{ text: string; startSeconds: number; endSeconds: number }>>;
}

const MAX_PHONE_UNITS = 128;
const STRESS = /[ˈˌ]/g;
const ASCII_ALIASES: Record<string, string> = {
  a: 'ɑː', e: 'ɛ', aa: 'ɑː', ae: 'æ', ah: 'ʌ', ao: 'ɔː', eh: 'ɛ', ih: 'ɪ', iy: 'iː',
  ow: 'oʊ', oy: 'ɔɪ', aw: 'aʊ', ay: 'aɪ', uh: 'ʊ', uw: 'uː', sh: 'ʃ', zh: 'ʒ',
  th: 'θ', dh: 'ð', ng: 'ŋ', ch: 'tʃ', jh: 'dʒ', y: 'j', r: 'ɹ', g: 'ɡ',
};

let catalogRequest: Promise<PhonemeCatalog> | undefined;

export function hasDirectPhonemeInput(text: string): boolean {
  return /\/\s*[^/\r\n]{1,256}?\s*\//u.test(text);
}

function stressless(phone: string): string {
  return phone.normalize('NFC').replace(STRESS, '');
}

function windowsFor(phone: string, catalog: PhonemeCatalog): PhonemeWindow[] {
  if (!Object.hasOwn(catalog.phones, phone)) return [];
  const windows = catalog.phones[phone];
  return Array.isArray(windows) ? windows : [];
}

function hasPhone(phone: string, catalog: PhonemeCatalog): boolean {
  return Object.hasOwn(catalog.phones, phone) && Array.isArray(catalog.phones[phone]);
}

function validCatalog(value: unknown, bank: Bank): PhonemeCatalog {
  if (!value || typeof value !== 'object') throw new Error('The phoneme catalog is invalid.');
  const catalog = value as Partial<PhonemeCatalog>;
  if ((catalog.schemaVersion !== 1 && catalog.schemaVersion !== 2) || !catalog.sourceBank || catalog.sourceBank.version !== bank.version ||
      catalog.sourceBank.sha256 !== bank.manifestSha256 || !catalog.phones || typeof catalog.phones !== 'object') {
    throw new Error('The phoneme catalog does not match this audio bank.');
  }
  return catalog as PhonemeCatalog;
}

export function loadPhonemeCatalog(bank: Bank): Promise<PhonemeCatalog> {
  catalogRequest ??= fetch('/phonemes.json').then(async (response) => {
    if (!response.ok) throw new Error(`Could not load phoneme catalog (${response.status}).`);
    return validCatalog(await response.json(), bank);
  }).catch((error) => {
    catalogRequest = undefined;
    throw error;
  });
  return catalogRequest.then((catalog) => validCatalog(catalog, bank));
}

function findCandidates(phone: string, catalog: PhonemeCatalog, bankById: Map<string, BankClip>): Array<{ clip: BankClip; window: PhonemeWindow }> {
  const windows = windowsFor(stressless(phone), catalog);
  return windows.flatMap((window) => {
    const clip = bankById.get(window.clipId);
    if (!clip || clip.kind !== 'word' || !/^[a-f\d]{64}$/i.test(window.sourceSha256) ||
        clip.sha256?.toLocaleLowerCase('en-US') !== window.sourceSha256.toLocaleLowerCase('en-US') ||
        !Number.isFinite(window.startSeconds) || !Number.isFinite(window.endSeconds) ||
        !Number.isFinite(window.sourceDurationSeconds) || window.startSeconds < 0 ||
        window.endSeconds - window.startSeconds < 0.02 || window.endSeconds > window.sourceDurationSeconds ||
        window.sourceDurationSeconds > clip.duration + 0.02 || window.sourceDurationSeconds < clip.duration - 0.02) return [];
    return [{ clip, window }];
  });
}

function median(numbers: number[]): number {
  const sorted = [...numbers].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function chooseWindow(phone: string, catalog: PhonemeCatalog, bankById: Map<string, BankClip>, expected?: string, previous?: string, next?: string, prior?: { clip: BankClip; window: Pick<PhonemeWindow, 'startSeconds' | 'endSeconds'> }): { clip: BankClip; window: PhonemeWindow } | undefined {
  const candidates = findCandidates(phone, catalog, bankById);
  if (!candidates.length) return undefined;
  const preferred = candidates.filter(({ window }) => {
    const length = window.endSeconds - window.startSeconds;
    return length >= 0.08 && length <= 0.18;
  });
  const pool = preferred.length ? preferred : candidates;
  const target = median(pool.map(({ window }) => window.endSeconds - window.startSeconds));
  pool.sort((left, right) => {
    const leftDuration = left.window.endSeconds - left.window.startSeconds;
    const rightDuration = right.window.endSeconds - right.window.startSeconds;
    const cost = ({ window, clip }: typeof left) =>
      (expected && window.position ? (window.position === expected ? 0 : 5) : 0) +
      (previous && window.previousIpa ? (stressless(window.previousIpa) === stressless(previous) ? 0 : 2) : 0) +
      (next && window.nextIpa ? (stressless(window.nextIpa) === stressless(next) ? 0 : 2) : 0) +
      (prior?.clip.id === clip.id && Math.abs(prior.window.endSeconds - window.startSeconds) <= 0.025 ? -0.08 : 0) +
      Math.abs((window.endSeconds - window.startSeconds) - target) + clip.id.length * 1e-6;
    return cost(left) - cost(right) || left.clip.id.localeCompare(right.clip.id) || left.window.startSeconds - right.window.startSeconds;
  });
  return pool[0];
}

function isVowel(phone: string): boolean {
  return /^[ɑæɐɒɔəɛɜɞɪɨʊʌʉɯɤeioœøɶy]/u.test(phone);
}

function aliasPhone(input: string): { phone: string; long: boolean } {
  const colonLong = input.endsWith(':');
  const raw = colonLong ? input.slice(0, -1) : input;
  const aliasKey = raw.toLocaleLowerCase('en-US');
  const alias = Object.hasOwn(ASCII_ALIASES, aliasKey) ? ASCII_ALIASES[aliasKey] : undefined;
  let phone = (alias ?? raw).replace(/:/g, 'ː');
  if (colonLong && !phone.endsWith('ː')) phone += 'ː';
  return { phone: stressless(phone), long: colonLong || phone.endsWith('ː') };
}

function splitPhoneString(value: string, keys: string[]): string[] | undefined {
  const normalized = stressless(value.replace(/:/g, 'ː').replace(/\s+/gu, ''));
  if (!normalized) return undefined;
  const units = Array.from(normalized);
  const orderedKeys = [...keys].sort((left, right) => Array.from(right).length - Array.from(left).length);
  const result: string[] = [];
  for (let offset = 0; offset < units.length;) {
    const match = orderedKeys.find((key) => units.slice(offset, offset + Array.from(key).length).join('') === key);
    if (!match) return undefined;
    result.push(match);
    offset += Array.from(match).length;
    if (result.length > MAX_PHONE_UNITS) return undefined;
  }
  return result;
}

export function parseExplicitPhones(value: string, catalog: PhonemeCatalog): { phones: string[]; warnings: string[] } {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  if (!tokens.length || tokens.length > MAX_PHONE_UNITS) return { phones: [], warnings: ['The IPA segment is empty or too long.'] };
  const phones: string[] = [];
  const warnings: string[] = [];
  const keys = Object.keys(catalog.phones);
  for (const token of tokens) {
    const { phone } = aliasPhone(token);
    if (hasPhone(phone, catalog) || (phone.endsWith('ː') && (hasPhone(phone.slice(0, -1), catalog) || isVowel(phone))) ||
        (!phone.endsWith('ː') && isVowel(phone) && hasPhone(`${phone}ː`, catalog))) {
      phones.push(phone);
      continue;
    }
    const split = splitPhoneString(phone, keys);
    if (split) phones.push(...split);
    else warnings.push(`Unsupported phoneme: ${token}.`);
  }
  return { phones, warnings };
}

export function parseGeneratedPhones(value: string, catalog: PhonemeCatalog): { phones: string[]; warnings: string[] } {
  const canonical = value.normalize('NFC').replace(/oːɹ/gu, 'ɔːɹ').replace(/oː/gu, 'ɔː');
  const phones = splitPhoneString(canonical, Object.keys(catalog.phones));
  if (!phones?.length) return { phones: [], warnings: [`Could not segment generated pronunciation “${value}”.`] };
  return { phones, warnings: [] };
}

export function resolvePhoneUnits(phones: string[], catalog: PhonemeCatalog, bank: Bank): { units: PhonemeUnit[]; warnings: string[] } {
  if (!phones.length || phones.length > MAX_PHONE_UNITS) return { units: [], warnings: ['The phoneme sequence is empty or too long.'] };
  const bankById = new Map(bank.clips.map((clip) => [clip.id, clip]));
  const units: PhonemeUnit[] = [];
  for (let phoneIndex = 0; phoneIndex < phones.length; phoneIndex += 1) {
    const phoneInput = phones[phoneIndex];
    const phone = stressless(phoneInput);
    const expected = phones.length === 1 ? 'single' : phoneIndex === 0 ? 'initial' : phoneIndex === phones.length - 1 ? 'final' : 'medial';
    const previous = phoneIndex ? phones[phoneIndex - 1] : undefined;
    const next = phoneIndex + 1 < phones.length ? phones[phoneIndex + 1] : undefined;
    const long = phone.endsWith('ː');
    let selectedPhone = phone;
    const prior = units.length ? {
      clip: bankById.get(units[units.length - 1].clipId)!,
      window: { startSeconds: units[units.length - 1].startSeconds, endSeconds: units[units.length - 1].endSeconds },
    } : undefined;
    let selected = chooseWindow(selectedPhone, catalog, bankById, expected, previous, next, prior);
    let stretchFactor: number | undefined;
    if (!selected && long && phone.endsWith('ː') && isVowel(phone)) {
      selectedPhone = phone.slice(0, -1);
      selected = chooseWindow(selectedPhone, catalog, bankById, expected, previous, next, prior);
      if (selected) stretchFactor = 1.7;
    }
    if (!selected && !long && isVowel(phone)) {
      const longPhone = `${phone}ː`;
      selected = chooseWindow(longPhone, catalog, bankById, expected, previous, next, prior);
      if (selected) selectedPhone = longPhone;
    }
    if (!selected) return { units: [], warnings: [`No verified audio window for /${phone}/; the complete segment was skipped.`] };
    const unit: PhonemeUnit = {
      clipId: selected.clip.id,
      startSeconds: selected.window.startSeconds,
      endSeconds: selected.window.endSeconds,
      ipa: selectedPhone,
      sourceDurationSeconds: selected.window.sourceDurationSeconds,
      sourceSha256: selected.window.sourceSha256,
      ...(stretchFactor ? { stretchFactor } : {}),
    };
    const last = units.at(-1);
    if (last && !last.stretchFactor && !unit.stretchFactor && last.clipId === unit.clipId && Math.abs(last.endSeconds - unit.startSeconds) <= 0.005) {
      last.endSeconds = unit.endSeconds;
      last.ipa += unit.ipa;
    } else units.push(unit);
  }
  return { units, warnings: [] };
}

export async function phonemizeWords(words: string[], signal?: AbortSignal): Promise<Map<string, string>> {
  if (signal?.aborted) throw new DOMException('The audio render was cancelled.', 'AbortError');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./phoneme.worker.ts', import.meta.url), { type: 'module' });
    let finished = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(new DOMException('The audio render was cancelled.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => fail(new Error(event.message || 'English phonemizer worker failed.'));
    worker.onmessageerror = () => fail(new Error('English phonemizer returned unreadable data.'));
    worker.onmessage = ({ data }: MessageEvent<{ phones: Record<string, string> } | { error: string }>) => {
      if ('error' in data) {
        fail(new Error(data.error));
        return;
      }
      if (finished) return;
      finished = true;
      cleanup();
      resolve(new Map(Object.entries(data.phones)));
    };
    try {
      worker.postMessage({ words });
    } catch (error) {
      fail(error instanceof Error ? error : new Error('Could not start English phonemizer worker.'));
    }
  });
}
