import { OggOpusDecoder } from 'ogg-opus-decoder';
import { createWorldVocoder } from '../audio/world';

export async function checkAudioCapability(samples: Float32Array): Promise<Float32Array> {
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
    features = vocoder.analyze(samples, 48_000);
    const proof = vocoder.synthesize(features);
    if (proof.length !== samples.length || !proof.every(Number.isFinite) ||
        !proof.some((sample) => Math.abs(sample) > 1e-8)) {
      throw new Error('WORLD synthesis failed.');
    }
    return proof;
  } finally {
    try {
      if (features && vocoder) vocoder.dispose(features);
    } finally {
      try {
        vocoder?.dispose();
      } finally {
        decoder?.free();
      }
    }
  }
}
