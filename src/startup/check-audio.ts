import { OggOpusDecoder } from 'ogg-opus-decoder';
import { createWorldVocoder } from '../audio/world';
import worldWasmAssetUrl from '../audio/world/runtime/world.wasm?url';
import type { StartupStep, StepHandler } from './capabilities';

const postStep: StepHandler = (step) => self.postMessage({ type: 'step', step });

export async function checkAudioCapability(samples: Float32Array, onStep: StepHandler = postStep): Promise<Float32Array> {
  let decoder: OggOpusDecoder | undefined;
  let vocoder: Awaited<ReturnType<typeof createWorldVocoder>> | undefined;
  let features: ReturnType<NonNullable<typeof vocoder>['analyze']> | undefined;

  const step = async <T>(id: string, label: string, run: () => Promise<T>, describe: (value: T) => string): Promise<T> => {
    const line: Pick<StartupStep, 'id' | 'label'> = { id, label };
    onStep({ ...line, detail: '', status: 'pending' });
    const start = performance.now();
    try {
      const value = await run();
      onStep({ ...line, detail: `${describe(value)} · ${Math.round(performance.now() - start)} ms`, status: 'ok' });
      return value;
    } catch (error) {
      onStep({ ...line, detail: error instanceof Error ? error.message : 'failed', status: 'fail' });
      throw error;
    }
  };

  try {
    const activeDecoder = await step('opus-decoder', 'initialise Opus decoder', async () => {
      const created = new OggOpusDecoder();
      decoder = created;
      await created.ready;
      return created;
    }, () => 'ogg-opus-decoder wasm ready');

    await step('opus-fixture', 'decode Opus fixture', async () => {
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
      return { bytes: encoded.byteLength, decoded };
    }, ({ bytes, decoded }) => `${(bytes / 1024).toFixed(1)} KiB -> ${decoded.samplesDecoded} samples @ ${decoded.sampleRate} Hz`);

    const world = await step('world-wasm', 'instantiate WORLD wasm module', createWorldVocoder, () => {
      const wasmBytes = performance.getEntriesByType('resource')
        .find((entry) => entry.name.endsWith(worldWasmAssetUrl)) as PerformanceResourceTiming | undefined;
      return wasmBytes?.decodedBodySize ? `world.wasm ${(wasmBytes.decodedBodySize / 1024).toFixed(1)} KiB instantiated` : 'world.wasm instantiated';
    });
    vocoder = world;

    const proof = await step('render-selftest', 'render self-test', async () => {
      features = world.analyze(samples, 48_000);
      const rendered = world.synthesize(features);
      if (rendered.length !== samples.length || !rendered.every(Number.isFinite) ||
          !rendered.some((sample) => Math.abs(sample) > 1e-8)) {
        throw new Error('WORLD synthesis failed.');
      }
      return rendered;
    }, (rendered) => `render OK · ${rendered.length} samples · peak ${rendered.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0).toFixed(3)}`);
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
