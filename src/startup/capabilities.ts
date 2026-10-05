export interface CapabilityReport {
  audio: true;
  opus: true;
  world: true;
  phonemizer: true;
}

const CHECK_TIMEOUT_MS = 20_000;

type WorkerReply = { type?: string; proof?: Float32Array; error?: string };

function requestWorker(worker: Worker, message: unknown, valid: (reply: WorkerReply) => boolean, signal: AbortSignal, transfer: Transferable[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => finish(new Error('Capability check timed out.')), CHECK_TIMEOUT_MS);
    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.terminate();
    };
    const onAbort = () => finish(new DOMException('Startup check cancelled.', 'AbortError'));
    const finish = (error?: Error) => {
      cleanup();
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onMessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (reply?.type === 'error' || reply?.error) {
        finish(new Error('A required audio capability failed.'));
      } else if (valid(reply ?? {})) {
        finish();
      } else {
        finish(new Error('A required audio capability returned an invalid result.'));
      }
    };
    const onError = () => finish(new Error('A required audio worker could not start.'));
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    try {
      worker.postMessage(message, transfer);
    } catch {
      finish(new Error('A required audio worker could not be contacted.'));
    }
  });
}

export async function checkStartupCapabilities(signal?: AbortSignal): Promise<CapabilityReport> {
  if (typeof Worker !== 'function' || typeof WebAssembly !== 'object' ||
      typeof AudioContext !== 'function' || typeof Float32Array !== 'function' ||
      typeof TextEncoder !== 'function' || typeof TextDecoder !== 'function' ||
      typeof structuredClone !== 'function' || typeof DecompressionStream !== 'function' ||
      typeof URL.createObjectURL !== 'function' || typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('Required browser capabilities are unavailable.');
  }
  if (signal?.aborted) throw new DOMException('Startup check cancelled.', 'AbortError');

  const checks = new AbortController();
  const abort = () => checks.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let opusWorldWorker: Worker | undefined;
  let phonemeWorker: Worker | undefined;

  const sampleRate = 48_000;
  const samples = new Float32Array(Math.round(sampleRate * 0.12));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = 0.1 * Math.sin((2 * Math.PI * 180 * index) / sampleRate);
  }
  try {
    opusWorldWorker = new Worker(new URL('./capability.worker.ts', import.meta.url), { type: 'module' });
    phonemeWorker = new Worker(new URL('../audio/phoneme.worker.ts', import.meta.url), { type: 'module' });
    await Promise.all([
      requestWorker(opusWorldWorker, { type: 'check', samples }, (reply) => {
        if (reply.type !== 'ready' || !(reply.proof instanceof Float32Array) || !reply.proof.length) return false;
        return reply.proof.every(Number.isFinite) && reply.proof.some((sample) => Math.abs(sample) > 1e-8);
      }, checks.signal, [samples.buffer]),
      requestWorker(phonemeWorker, { words: ['hello'] }, (reply) => {
        const phones = (reply as WorkerReply & { phones?: Record<string, unknown> }).phones;
        return typeof phones?.hello === 'string' && phones.hello.trim().length > 0;
      }, checks.signal),
    ]);
    if (signal?.aborted) throw new DOMException('Startup check cancelled.', 'AbortError');
    return { audio: true, opus: true, world: true, phonemizer: true };
  } catch (error) {
    checks.abort();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    opusWorldWorker?.terminate();
    phonemeWorker?.terminate();
  }
}
