type Pending = { resolve: (words: Set<string>) => void; reject: (error: Error) => void; cleanup: () => void };
const pending = new Map<number, Pending>();
let worker: Worker | undefined;
let nextId = 0;

function spellingWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./spelling.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<{ id: number; misspelled?: string[]; error?: string }>) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    request.cleanup();
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(new Set(data.misspelled ?? []));
  };
  worker.onerror = () => {
    const failed = worker;
    worker = undefined;
    failed?.terminate();
    for (const request of pending.values()) {
      request.cleanup();
      request.reject(new Error('English spelling hints are unavailable.'));
    }
    pending.clear();
  };
  return worker;
}

export function checkEnglishSpelling(words: readonly string[], signal?: AbortSignal): Promise<Set<string>> {
  const cancelled = () => new DOMException('Spelling analysis was cancelled.', 'AbortError');
  if (signal?.aborted) return Promise.reject(cancelled());
  const uniqueWords = [...new Set(words.map((word) => word.toLocaleLowerCase('en-US').replace(/’/g, "'")))];
  if (!uniqueWords.length) return Promise.resolve(new Set());
  if (uniqueWords.length > 512) return Promise.reject(new Error('The spelling request exceeds the word limit.'));
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const abort = () => {
      pending.delete(id);
      signal?.removeEventListener('abort', abort);
      reject(cancelled());
    };
    pending.set(id, { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      spellingWorker().postMessage({ id, words: uniqueWords });
    } catch (error) {
      pending.delete(id);
      signal?.removeEventListener('abort', abort);
      reject(error instanceof Error ? error : new Error('English spelling hints could not start.'));
    }
  });
}
