import { createWordPlan } from './parser';
import type { Bank, BankClip, RenderOptions, RenderResult } from './types';
import { hasDirectPhonemeInput, loadPhonemeCatalog, phonemizeWords } from './phonemes';

const BANK_URL = '/bank.json';
let cachedBank: Promise<Bank> | undefined;

function validateBank(value: unknown, manifestSha256: string): Bank {
  if (!value || typeof value !== 'object') throw new Error('The audio bank is invalid.');
  const bank = value as Partial<Bank>;
  if (typeof bank.version !== 'string' || typeof bank.source !== 'string' || !Array.isArray(bank.clips)) {
    throw new Error('The audio bank is missing required metadata.');
  }
  const seen = new Set<string>();
  const clips = bank.clips.map((candidate): BankClip => {
    if (!candidate || typeof candidate !== 'object') throw new Error('The audio bank contains an invalid clip.');
    const clip = candidate as BankClip;
    if (!/^[a-z0-9_-]+$/i.test(clip.id) || seen.has(clip.id.toLocaleLowerCase('en-US')) ||
        typeof clip.file !== 'string' || !clip.file.startsWith('/audio/') || clip.file.includes('..') ||
        !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 120 ||
        (clip.kind !== 'word' && clip.kind !== 'effect')) {
      throw new Error(`The audio bank contains invalid metadata for ${String(clip.id)}.`);
    }
    seen.add(clip.id.toLocaleLowerCase('en-US'));
    return { id: clip.id, file: clip.file, duration: clip.duration, kind: clip.kind, ...(typeof clip.sha256 === 'string' ? { sha256: clip.sha256 } : {}) };
  });
  return { version: bank.version, source: bank.source, clips, manifestSha256 };
}

export function loadBank(): Promise<Bank> {
  cachedBank ??= fetch(BANK_URL).then(async (response) => {
    if (!response.ok) throw new Error(`Could not load audio bank (${response.status}).`);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const manifestSha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return validateBank(JSON.parse(new TextDecoder().decode(bytes)), manifestSha256);
  }).catch((error) => {
    cachedBank = undefined;
    throw error;
  });
  return cachedBank;
}

async function preparePlan(text: string, bank: Bank, phonemesEnabled: boolean, signal?: AbortSignal): Promise<{ plan: ReturnType<typeof createWordPlan>['plan']; warnings: string[] }> {
  if (signal?.aborted) throw new DOMException('The audio render was cancelled.', 'AbortError');
  if (!text.trim()) return { plan: [], warnings: [] };
  const needsCatalog = phonemesEnabled || hasDirectPhonemeInput(text);
  let catalog;
  if (needsCatalog) {
    try {
      catalog = await loadPhonemeCatalog(bank);
    } catch {
      catalog = undefined;
    }
    if (signal?.aborted) throw new DOMException('The audio render was cancelled.', 'AbortError');
  }

  const initial = createWordPlan(text, bank, undefined, catalog, new Map(), true);
  if (!phonemesEnabled || !catalog || !initial.unresolvedWords.length) {
    const warnings = [...initial.warnings];
    if (phonemesEnabled && !catalog && initial.unresolvedWords.length) warnings.push('The phoneme catalog is unavailable; unrecorded words were skipped.');
    return { plan: initial.plan, warnings };
  }

  try {
    const phonemized = await phonemizeWords(initial.unresolvedWords, signal);
    if (signal?.aborted) throw new DOMException('The audio render was cancelled.', 'AbortError');
    const resolved = createWordPlan(text, bank, undefined, catalog, phonemized, true);
    return { plan: resolved.plan, warnings: resolved.warnings };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { plan: initial.plan, warnings: [...initial.warnings, 'English phonemizer could not run; unmatched words were skipped.'] };
  }
}

export async function analyzeAnnouncement(
  text: string,
  bank: Bank,
  phonemesEnabled = false,
  signal?: AbortSignal,
): Promise<{ words: string[]; warnings: string[]; ipa: string[] }> {
  try {
    const { plan, warnings } = await preparePlan(text, bank, phonemesEnabled, signal);
    return {
      words: plan.map((word) => word.display),
      warnings,
      ipa: plan.map((word) => word.phonemeUnits?.map((unit) => unit.ipa).join(' ') ?? ''),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { words: [], warnings: [error instanceof Error ? error.message : 'Could not analyze announcement.'], ipa: [] };
  }
}

export async function renderAnnouncement(
  text: string,
  bank: Bank,
  options: RenderOptions,
  onProgress?: (value: number) => void,
  signal?: AbortSignal,
): Promise<RenderResult> {
  if (signal?.aborted) return Promise.reject(new DOMException('The audio render was cancelled.', 'AbortError'));
  const safeOptions: RenderOptions = {
    pitch: Number.isFinite(options.pitch) ? Math.min(1.35, Math.max(0.65, options.pitch)) : 1,
    volume: Number.isFinite(options.volume) ? Math.min(1, Math.max(0, options.volume)) : 1,
    gap: Number.isFinite(options.gap) ? Math.min(0.8, Math.max(0, options.gap)) : 0.24,
    background: options.background === true,
    phonemes: options.phonemes === true,
  };
  const { plan, warnings } = await preparePlan(text, bank, safeOptions.phonemes === true, signal);
  if (signal?.aborted) throw new DOMException('The audio render was cancelled.', 'AbortError');
  if (!plan.length) throw new Error(warnings[0] ?? 'No playable words were found in the announcement.');
  const words = plan.map((word) => word.display);
  const workerBank: Bank = {
    version: String(bank.version),
    source: String(bank.source),
    ...(bank.manifestSha256 ? { manifestSha256: bank.manifestSha256 } : {}),
    clips: bank.clips.map((clip) => ({
      id: String(clip.id),
      file: String(clip.file),
      duration: Number(clip.duration),
      kind: clip.kind,
      ...(clip.sha256 ? { sha256: clip.sha256 } : {}),
    })),
  };
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    let finished = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const finishError = (error: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    };
    const abort = () => finishError(new DOMException('The audio render was cancelled.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => finishError(new Error(event.message || 'Audio worker failed.'));
    worker.onmessageerror = () => finishError(new Error('Audio worker returned an unreadable response.'));
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        onProgress?.(Math.min(1, Math.max(0, data.value)));
      } else if (data.type === 'error') {
        finishError(new Error(data.message));
      } else if (data.type === 'done') {
        if (finished) return;
        finished = true;
        cleanup();
        onProgress?.(1);
        resolve({ samples: data.samples, sampleRate: data.sampleRate, duration: data.duration, words: [...words], warnings: [...warnings, ...data.warnings] });
      }
    };
    try {
      worker.postMessage({ type: 'render', bank: workerBank, plan, options: safeOptions });
    } catch (error) {
      finishError(error instanceof Error ? error : new Error('Could not start audio rendering.'));
    }
  });
}

export { encodeWav } from './dsp';
export type { Bank, BankClip, RenderOptions, RenderResult } from './types';
