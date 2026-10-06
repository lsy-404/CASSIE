import phonemeWorkerUrl from '../audio/phoneme.worker.ts?worker&url';
import renderWorkerUrl from '../audio/render.worker.ts?worker&url';
import spellingWorkerUrl from '../spelling.worker.ts?worker&url';
import { phonemeEngineError } from '../phoneme-engine';
import { withStage, type StagedError } from './worker-stage';

export type StepStatus = 'pending' | 'ok' | 'warn' | 'fail';
export interface StartupStep { id: string; label: string; detail: string; status: StepStatus }
export type StepHandler = (step: StartupStep) => void;

interface FfmpegManifest {
  version: string;
  bytes: number;
  compressedBytes: number;
  parts: { file: string; bytes: number; sha256: string }[];
}

const CHECK_TIMEOUT_MS = 20_000;
const LINE_PACING_MS = 40;

type WorkerReply = { type?: string; proof?: Float32Array; error?: string; message?: string; name?: string; stage?: string; step?: StartupStep };

const sleep = (ms: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));
const elapsed = (start: number) => `${Math.round(performance.now() - start)} ms`;
const size = (bytes: number) => bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// A module worker that fails to load fires a plain Event without message or location, so the script is refetched to expose the HTTP cause.
async function describeWorkerError(event: Event, url: string, signal: AbortSignal): Promise<string> {
  const { message, filename, lineno, colno } = event as Partial<ErrorEvent>;
  if (message) return `${message}${filename ? ` at ${filename.split('/').pop()}:${lineno}:${colno}` : ''}`;
  const name = new URL(url, location.href).pathname.split('/').pop();
  try {
    const response = await fetch(url, { signal });
    const type = response.headers.get('content-type') ?? 'no content-type';
    return response.ok
      ? `${name} was fetched (HTTP ${response.status}, ${type}) but failed to load as a module script`
      : `${name} answered HTTP ${response.status} (${type})`;
  } catch (error) {
    return `${name} could not be fetched (${error instanceof Error ? error.message : 'network error'})`;
  }
}

function requestWorker(worker: Worker, url: string, message: unknown, valid: (reply: WorkerReply) => boolean, signal: AbortSignal, onStep?: StepHandler, transfer: Transferable[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let stage: string | undefined;
    const timeout = globalThis.setTimeout(() => finish(new Error(`Worker gave no reply within ${CHECK_TIMEOUT_MS / 1000} s (${elapsed(started)} elapsed).`)), CHECK_TIMEOUT_MS);
    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      worker.terminate();
    };
    const onAbort = () => finish(new DOMException('Startup check cancelled.', 'AbortError'));
    const finish = (error?: Error) => {
      cleanup();
      signal.removeEventListener('abort', onAbort);
      if (error) reject(Object.assign(error, { stage }));
      else resolve();
    };
    const onMessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (reply?.type === 'step' && reply.step) {
        onStep?.(reply.step);
      } else if (reply?.type === 'stage') {
        stage = reply.stage;
      } else if (reply?.type === 'error' || reply?.error) {
        stage = reply.stage ?? stage;
        finish(new Error(reply.name ? `${reply.name}: ${reply.message}` : reply.error ?? reply.message ?? 'A required audio capability failed.'));
      } else if (valid(reply ?? {})) {
        finish();
      } else {
        finish(new Error('A required audio capability returned an invalid result.'));
      }
    };
    const onError = (event: Event) => {
      event.preventDefault();
      worker.removeEventListener('error', onError);
      void describeWorkerError(event, url, signal).then((detail) => finish(new Error(`Worker script failed: ${detail}.`)));
    };
    const onMessageError = () => finish(new Error('Worker reply could not be deserialized.'));
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    try {
      worker.postMessage(message, transfer);
    } catch (error) {
      finish(new Error(`Worker could not be contacted: ${error instanceof Error ? error.message : 'unknown error'}.`));
    }
  });
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<{ data: T; bytes: number }> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const text = await response.text();
  return { data: JSON.parse(text) as T, bytes: new TextEncoder().encode(text).length };
}

function browserVersion(): string {
  const brand = (navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } }).userAgentData?.brands
    .find((item) => /chrom/i.test(item.brand) && !/not/i.test(item.brand));
  return brand ? `${brand.brand} ${brand.version}` : (/(?:Chrome|Firefox|Version)\/[\d.]+/.exec(navigator.userAgent)?.[0] ?? 'unknown browser');
}

export async function checkStartupCapabilities(signal?: AbortSignal, onStep?: StepHandler): Promise<void> {
  phonemeEngineError.value = undefined;
  const checks = new AbortController();
  const abort = () => checks.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const cancelled = () => new DOMException('Startup check cancelled.', 'AbortError');
  let opusWorldWorker: Worker | undefined;
  let phonemeWorker: Worker | undefined;
  let spellingWorker: Worker | undefined;

  const begin = async (id: string, label: string) => {
    if (signal?.aborted) throw cancelled();
    onStep?.({ id, label, detail: '', status: 'pending' });
    await sleep(LINE_PACING_MS);
    return performance.now();
  };
  const step = async (id: string, label: string, run: () => Promise<string>): Promise<void> => {
    const start = await begin(id, label);
    try {
      onStep?.({ id, label, detail: `${await run()} · ${elapsed(start)}`, status: 'ok' });
    } catch (error) {
      onStep?.({ id, label, detail: error instanceof Error ? error.message : 'failed', status: 'fail' });
      throw error;
    }
  };

  try {
    await step('browser', 'probe browser capabilities', async () => {
      const required: [string, boolean][] = [
        ['Worker', typeof Worker === 'function'],
        ['WebAssembly', typeof WebAssembly === 'object'],
        ['AudioContext', typeof AudioContext === 'function'],
        ['Float32Array', typeof Float32Array === 'function'],
        ['TextEncoder', typeof TextEncoder === 'function' && typeof TextDecoder === 'function'],
        ['structuredClone', typeof structuredClone === 'function'],
        ['DecompressionStream', typeof DecompressionStream === 'function'],
        ['URL.createObjectURL', typeof URL.createObjectURL === 'function'],
        ['crypto.subtle', typeof globalThis.crypto?.subtle?.digest === 'function'],
      ];
      const missing = required.filter(([, present]) => !present).map(([name]) => name);
      if (missing.length) throw new Error(`missing ${missing.join(', ')}`);
      return `${browserVersion()} · ${navigator.hardwareConcurrency ?? '?'} logical cores · ${required.length} APIs present`;
    });

    await step('audio-context', 'probe AudioContext and audio worklet', async () => {
      const context = new AudioContext();
      try {
        if (typeof context.audioWorklet?.addModule !== 'function') throw new Error('audioWorklet unavailable');
        return `${context.sampleRate} Hz · ${context.state} · base latency ${(context.baseLatency * 1000).toFixed(1)} ms · audioWorklet present`;
      } finally {
        await context.close().catch(() => undefined);
      }
    });

    let manifest!: FfmpegManifest;
    await step('ffmpeg-manifest', 'fetch ffmpeg wasm manifest', async () => {
      manifest = (await fetchJson<FfmpegManifest>('/ffmpeg/manifest.json', checks.signal)).data;
      if (!Array.isArray(manifest.parts) || !manifest.parts.length) throw new Error('manifest has no chunks');
      return `ffmpeg-core ${manifest.version} · ${manifest.parts.length} chunks · ${size(manifest.compressedBytes)} gzip / ${size(manifest.bytes)} wasm`;
    });
    for (const [index, part] of manifest.parts.entries()) {
      await step(`ffmpeg-chunk-${index}`, `load ffmpeg wasm chunk ${index + 1}/${manifest.parts.length}`, async () => {
        if (!/^ffmpeg-core\.wasm\.gz\.\d{2}$/.test(part.file)) throw new Error('invalid chunk path');
        const response = await fetch(`/ffmpeg/${part.file}`, { signal: checks.signal });
        if (!response.ok) throw new Error(`${part.file} returned HTTP ${response.status}`);
        const chunk = new Uint8Array(await response.arrayBuffer());
        if (chunk.byteLength !== part.bytes) throw new Error(`${part.file} size mismatch`);
        if (await sha256(chunk) !== part.sha256) throw new Error(`${part.file} checksum mismatch`);
        return `${part.file} · ${size(chunk.byteLength)} · sha256 ${part.sha256.slice(0, 12)}`;
      });
    }

    await step('bank', 'fetch voice bank manifest', async () => {
      const { data, bytes } = await fetchJson<{ clips: unknown[] }>('/bank.json', checks.signal);
      if (!Array.isArray(data.clips) || !data.clips.length) throw new Error('voice bank has no clips');
      return `${data.clips.length} clips · ${size(bytes)}`;
    });

    await step('phoneme-index', 'index phoneme catalog', async () => {
      const { data, bytes } = await fetchJson<{ phones?: Record<string, unknown> }>('/phonemes.json', checks.signal);
      const count = Object.keys(data.phones ?? {}).length;
      if (!count) throw new Error('phoneme catalog is empty');
      return `${count} phones · ${size(bytes)}`;
    });

    // The engine only serves unrecorded words, so its failure degrades the studio instead of halting boot; the 20 s wait overlaps the other checks.
    const phonemeCheck = (async () => {
      try {
        const start = await begin('phoneme-worker', 'spawn phoneme worker');
        phonemeWorker = new Worker(phonemeWorkerUrl, { type: 'module' });
        let phones = '';
        await requestWorker(phonemeWorker, phonemeWorkerUrl, { words: ['hello'] }, (reply) => {
          const value = (reply as WorkerReply & { phones?: Record<string, unknown> }).phones?.hello;
          if (typeof value !== 'string' || !/^h(?:ə|ɛ|e)l(?:oʊ|əʊ|oː)$/u.test(value.replace(/[ˈˌ\s]/gu, ''))) return false;
          phones = value;
          return true;
        }, checks.signal);
        onStep?.({ id: 'phoneme-worker', label: 'spawn phoneme worker', detail: `module worker · phonemize "hello" -> /${phones}/ · ${elapsed(start)}`, status: 'ok' });
      } catch (error) {
        if (checks.signal.aborted) {
          onStep?.({ id: 'phoneme-worker', label: 'spawn phoneme worker', detail: 'skipped · startup halted', status: 'warn' });
          return;
        }
        const reason = withStage(error instanceof Error ? error.message : 'failed', (error as StagedError).stage);
        phonemeEngineError.value = reason;
        onStep?.({ id: 'phoneme-worker', label: 'spawn phoneme worker', detail: reason, status: 'warn' });
      }
    })();

    await step('spelling-worker', 'spawn spelling worker', async () => {
      spellingWorker = new Worker(spellingWorkerUrl, { type: 'module' });
      await requestWorker(spellingWorker, spellingWorkerUrl, { id: 0, words: ['hello', 'zqxvj'] }, (reply) => {
        const misspelled = (reply as WorkerReply & { misspelled?: string[] }).misspelled;
        return Array.isArray(misspelled) && misspelled.length === 1 && misspelled[0] === 'zqxvj';
      }, checks.signal);
      return 'module worker · en + en-GB dictionaries loaded · probe words classified';
    });

    const sampleRate = 48_000;
    const samples = new Float32Array(Math.round(sampleRate * 0.12));
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = 0.1 * Math.sin((2 * Math.PI * 180 * index) / sampleRate);
    }
    const spawnStart = await begin('render-worker', 'spawn render worker');
    let spawned = false;
    let latestWorkerStep: StartupStep | undefined;
    const spawnLine = { id: 'render-worker', label: 'spawn render worker' };
    try {
      opusWorldWorker = new Worker(renderWorkerUrl, { type: 'module' });
      await requestWorker(opusWorldWorker, renderWorkerUrl, { type: 'check', samples }, (reply) => {
        return reply.type === 'ready' && reply.proof instanceof Float32Array && reply.proof.length > 0 &&
          reply.proof.every(Number.isFinite) && reply.proof.some((sample) => Math.abs(sample) > 1e-8);
      }, checks.signal, (workerStep) => {
        if (!spawned) {
          spawned = true;
          onStep?.({ ...spawnLine, detail: `module worker booted · ${elapsed(spawnStart)}`, status: 'ok' });
        }
        latestWorkerStep = workerStep;
        onStep?.(workerStep);
      }, [samples.buffer]);
    } catch (error) {
      if (latestWorkerStep?.status !== 'fail') {
        const target = spawned && latestWorkerStep?.status === 'pending' ? latestWorkerStep : spawnLine;
        onStep?.({ ...target, detail: error instanceof Error ? error.message : 'failed', status: 'fail' });
      }
      throw error;
    }

    await phonemeCheck;
    if (signal?.aborted) throw cancelled();
  } catch (error) {
    checks.abort();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    opusWorldWorker?.terminate();
    phonemeWorker?.terminate();
    spellingWorker?.terminate();
  }
}
