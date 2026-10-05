import { OggOpusDecoder } from 'ogg-opus-decoder';
import { createWorldVocoder } from '../audio/world';

type Request = { type: 'check'; samples: Float32Array };
type Reply = { type: 'ready'; proof: Float32Array } | { type: 'error'; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: Reply, transfer?: Transferable[]): void;
};

scope.onmessage = async ({ data }) => {
  if (data.type !== 'check' || !(data.samples instanceof Float32Array)) return;
  let decoder: OggOpusDecoder | undefined;
  let vocoder: Awaited<ReturnType<typeof createWorldVocoder>> | undefined;
  let features: ReturnType<NonNullable<typeof vocoder>['analyze']> | undefined;
  try {
    const activeDecoder = new OggOpusDecoder();
    decoder = activeDecoder;
    await activeDecoder.ready;
    const response = await fetch(new URL('/audio/cassie.opus', self.location.origin));
    if (!response.ok) throw new Error('Opus fixture is unavailable.');
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > 32 * 1024 * 1024) throw new Error('Opus fixture is too large.');
    const encoded = await response.arrayBuffer();
    if (encoded.byteLength === 0 || encoded.byteLength > 32 * 1024 * 1024) throw new Error('Opus fixture size is invalid.');
    const decoded = await activeDecoder.decodeFile(new Uint8Array(encoded));
    if (decoded.errors.length || decoded.samplesDecoded <= 0 || decoded.sampleRate !== 48_000 || !decoded.channelData.length) {
      throw new Error('Opus decoding failed.');
    }
    await activeDecoder.reset();

    vocoder = await createWorldVocoder();
    features = vocoder.analyze(data.samples, 48_000);
    const proof = vocoder.synthesize(features);
    if (proof.length !== data.samples.length || !proof.every(Number.isFinite) ||
        !proof.some((sample) => Math.abs(sample) > 1e-8)) {
      throw new Error('WORLD synthesis failed.');
    }
    scope.postMessage({ type: 'ready', proof }, [proof.buffer]);
  } catch {
    scope.postMessage({ type: 'error', error: 'Required audio processing is unavailable.' });
  } finally {
    if (features && vocoder) vocoder.dispose(features);
    vocoder?.dispose();
    decoder?.free();
  }
};
