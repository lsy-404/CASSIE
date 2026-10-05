import { createWordPlan } from './parser';
import type { Bank, BankClip, RenderOptions, RenderResult } from './types';

const BANK_URL = '/bank.json';
let cachedBank: Promise<Bank> | undefined;

function validateBank(value: unknown): Bank {
  if (!value || typeof value !== 'object') throw new Error('The audio bank is invalid.');
  const bank = value as Partial<Bank>;
  if (typeof bank.version !== 'string' || typeof bank.source !== 'string' || !Array.isArray(bank.clips)) {
    throw new Error('The audio bank is missing required metadata.');
  }
  const seen = new Set<string>();
  const clips = bank.clips.map((candidate): BankClip => {
    if (!candidate || typeof candidate !== 'object') throw new Error('The audio bank contains an invalid clip.');
    const clip = candidate as BankClip;
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(clip.id) || seen.has(clip.id.toLocaleLowerCase('en-US')) ||
        typeof clip.file !== 'string' || !clip.file.startsWith('/audio/') || clip.file.includes('..') ||
        !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 120 ||
        (clip.kind !== 'word' && clip.kind !== 'effect')) {
      throw new Error(`The audio bank contains invalid metadata for ${String(clip.id)}.`);
    }
    seen.add(clip.id.toLocaleLowerCase('en-US'));
    return { id: clip.id, file: clip.file, duration: clip.duration, kind: clip.kind };
  });
  return { version: bank.version, source: bank.source, clips };
}

export function loadBank(): Promise<Bank> {
  cachedBank ??= fetch(BANK_URL).then(async (response) => {
    if (!response.ok) throw new Error(`Could not load audio bank (${response.status}).`);
    return validateBank(await response.json());
  }).catch((error) => {
    cachedBank = undefined;
    throw error;
  });
  return cachedBank;
}

export function renderAnnouncement(
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
  };
  const { plan, warnings } = createWordPlan(text, bank);
  const words = plan.map((word) => word.display);
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
    worker.postMessage({ type: 'render', bank, plan, options: safeOptions });
  });
}

export { encodeWav } from './dsp';
export type { Bank, BankClip, RenderOptions, RenderResult } from './types';
