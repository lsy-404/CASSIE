type RequestMessage = { words: string[]; letterNames?: string[] };
type Stage = 'module loaded' | 'loading engine' | 'running engine' | 'ready';
type ResponseMessage =
  | { phones: Record<string, string> }
  | { type: 'stage'; stage: Stage }
  | { type: 'error'; stage: Stage; name: string; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RequestMessage>) => void) | null;
  postMessage: (message: ResponseMessage) => void;
  addEventListener: (type: 'unhandledrejection' | 'error', listener: (event: Event) => void) => void;
};

let stage: Stage = 'module loaded';

function mark(next: Stage): void {
  stage = next;
  scope.postMessage({ type: 'stage', stage });
}

function report(reason: unknown): void {
  const error = reason instanceof Error ? reason : undefined;
  scope.postMessage({ type: 'error', stage, name: error?.name ?? 'Error', message: error?.message ?? String(reason) });
}

// Unhandled rejections in a worker never reach the Worker object, so they are forwarded explicitly.
scope.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  report((event as PromiseRejectionEvent).reason);
});
scope.addEventListener('error', (event) => {
  event.preventDefault();
  report(new Error((event as ErrorEvent).message || 'Worker script error'));
});

// phonemizer reads its bundled data with for-await over a stream, which Safari before 27 lacks.
const streamPrototype = ReadableStream.prototype as unknown as Record<symbol, unknown>;
if (!streamPrototype[Symbol.asyncIterator]) {
  streamPrototype[Symbol.asyncIterator] = async function* (this: ReadableStream<unknown>) {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

scope.onmessage = async ({ data }) => {
  try {
    if (!Array.isArray(data.words) || data.words.length > 512 || data.words.some((word) => typeof word !== 'string' || word.length > 256) ||
        (data.letterNames !== undefined && (!Array.isArray(data.letterNames) || data.letterNames.length > 26 || data.letterNames.some((letter) => !/^[A-Z]$/u.test(letter))))) {
      throw new Error('English phonemizer input is invalid.');
    }
    mark('loading engine');
    const { phonemize } = await import('phonemizer');
    mark('running engine');
    const phones: Record<string, string> = {};
    for (const word of data.words) {
      const result = await phonemize(word, 'en-us');
      const phonetic = result.find((item) => item.trim());
      if (phonetic) phones[word.toLocaleLowerCase('en-US')] = word.toLocaleLowerCase('en-US') === 'a' ? 'ə' : phonetic;
    }
    for (const letter of data.letterNames ?? []) {
      const result = await phonemize(letter, 'en-us');
      const phonetic = result.find((item) => item.trim());
      if (phonetic) phones[`letter:${letter}`] = phonetic;
    }
    mark('ready');
    scope.postMessage({ phones });
  } catch (error) {
    report(error);
  }
};

mark('module loaded');
