import worldModuleAssetUrl from './world/runtime/world.mjs?url';
import worldWasmAssetUrl from './world/runtime/world.wasm?url';

type WorldModule = {
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _world_last_error(): number;
  _world_analyze_f32(pointer: number, sampleCount: number, sampleRate: number): number;
  _world_destroy_analysis(handle: number): void;
  _world_sample_count(handle: number): number;
  _world_sample_rate(handle: number): number;
  _world_frame_count(handle: number): number;
  _world_fft_size(handle: number): number;
  _world_bin_count(handle: number): number;
  _world_frame_period_ms(): number;
  _world_f0_ptr(handle: number): number;
  _world_spectral_ptr(handle: number): number;
  _world_aperiodicity_ptr(handle: number): number;
  _world_synthesize_f32(
    handle: number,
    f0Pointer: number,
    spectralPointer: number,
    aperiodicityPointer: number,
    outputPointer: number,
    outputCount: number,
  ): number;
};

type WorldModuleFactory = (options: {
  locateFile(path: string): string;
}) => Promise<WorldModule>;

export type WorldFeatures = {
  readonly sampleCount: number;
  readonly sampleRate: 48000;
  readonly frameCount: number;
  readonly fftSize: number;
  readonly binCount: number;
  readonly framePeriodMs: 5;
  readonly f0: Float64Array;
  readonly spectral: Float64Array;
  readonly aperiodicity: Float64Array;
};

export type WorldVocoder = {
  analyze(pcm: Float32Array, sampleRate: number): WorldFeatures;
  synthesize(features: WorldFeatures): Float32Array;
  dispose(features: WorldFeatures): void;
  dispose(): void;
};

const ERROR_MESSAGES: Record<number, string> = {
  1: 'WORLD received invalid audio or feature buffers.',
  2: 'WORLD requires mono audio at 48 kHz.',
  3: 'WORLD requires at least 30 ms of speech audio.',
  4: 'WORLD supports voice blocks up to 20 seconds.',
  5: 'WORLD received non-finite or out-of-range audio.',
  6: 'WORLD features contain invalid values.',
  7: 'WORLD ran out of WebAssembly memory.',
  8: 'WORLD analysis or synthesis failed.',
};

function checkStatus(module: WorldModule, status: number): void {
  if (status === 0) return;
  throw new Error(ERROR_MESSAGES[status] ?? `WORLD failed with status ${status}.`);
}

function allocate(module: WorldModule, byteLength: number): number {
  const pointer = module._malloc(byteLength);
  if (pointer === 0) throw new Error('WORLD could not allocate WebAssembly memory.');
  return pointer;
}

function asFloat64(module: WorldModule, pointer: number, length: number): Float64Array {
  return module.HEAPF64.slice(pointer / Float64Array.BYTES_PER_ELEMENT,
    pointer / Float64Array.BYTES_PER_ELEMENT + length);
}

function validateFeatureArray(values: Float64Array, length: number, name: string): void {
  if (!(values instanceof Float64Array) || values.length !== length) {
    throw new Error(`WORLD ${name} must contain exactly ${length} Float64 values.`);
  }
}

export async function createWorldVocoder(): Promise<WorldVocoder> {
  const moduleUrl = new URL(worldModuleAssetUrl, self.location.origin).href;
  const wasmUrl = new URL(worldWasmAssetUrl, self.location.origin).href;
  const loadedModule = await import(/* @vite-ignore */ moduleUrl) as { default: WorldModuleFactory };
  const module = await loadedModule.default({ locateFile: (path) => path.endsWith('.wasm') ? wasmUrl : path });
  const handles = new WeakMap<WorldFeatures, number>();
  const released = new WeakSet<WorldFeatures>();
  const liveFeatures = new Set<WorldFeatures>();
  let disposed = false;

  const ensureOpen = () => {
    if (disposed) throw new Error('WORLD worker instance has been disposed.');
  };

  const disposeFeatures = (features: WorldFeatures) => {
    const handle = handles.get(features);
    if (handle === undefined || released.has(features)) return;
    released.add(features);
    handles.delete(features);
    liveFeatures.delete(features);
    module._world_destroy_analysis(handle);
  };

  return {
    analyze(pcm, sampleRate) {
      ensureOpen();
      if (!(pcm instanceof Float32Array) || pcm.length === 0) {
        throw new Error('WORLD input must be a non-empty mono Float32Array.');
      }
      if (sampleRate !== 48000) throw new Error(ERROR_MESSAGES[2]);
      if (pcm.length < 1440) throw new Error(ERROR_MESSAGES[3]);
      if (pcm.length > 20 * sampleRate) throw new Error(ERROR_MESSAGES[4]);

      const inputPointer = allocate(module, pcm.byteLength);
      let handle = 0;
      try {
        module.HEAPF32.set(pcm, inputPointer / Float32Array.BYTES_PER_ELEMENT);
        handle = module._world_analyze_f32(inputPointer, pcm.length, sampleRate);
        if (handle === 0) checkStatus(module, module._world_last_error());

        const sampleCount = module._world_sample_count(handle);
        const frameCount = module._world_frame_count(handle);
        const fftSize = module._world_fft_size(handle);
        const binCount = module._world_bin_count(handle);
        const matrixLength = frameCount * binCount;
        const features: WorldFeatures = {
          sampleCount,
          sampleRate: 48000,
          frameCount,
          fftSize,
          binCount,
          framePeriodMs: 5,
          f0: asFloat64(module, module._world_f0_ptr(handle), frameCount),
          spectral: asFloat64(module, module._world_spectral_ptr(handle), matrixLength),
          aperiodicity: asFloat64(module, module._world_aperiodicity_ptr(handle), matrixLength),
        };
        handles.set(features, handle);
        liveFeatures.add(features);
        handle = 0;
        return features;
      } finally {
        module._free(inputPointer);
        if (handle !== 0) module._world_destroy_analysis(handle);
      }
    },

    synthesize(features) {
      ensureOpen();
      const handle = handles.get(features);
      if (handle === undefined || released.has(features)) {
        throw new Error('WORLD analysis features have already been disposed.');
      }
      const f0Length = features.frameCount;
      const matrixLength = features.frameCount * features.binCount;
      validateFeatureArray(features.f0, f0Length, 'f0');
      validateFeatureArray(features.spectral, matrixLength, 'spectral envelope');
      validateFeatureArray(features.aperiodicity, matrixLength, 'aperiodicity');

      const f0Pointer = allocate(module, features.f0.byteLength);
      let spectralPointer = 0;
      let aperiodicityPointer = 0;
      let outputPointer = 0;
      try {
        spectralPointer = allocate(module, features.spectral.byteLength);
        aperiodicityPointer = allocate(module, features.aperiodicity.byteLength);
        outputPointer = allocate(module, features.sampleCount * Float32Array.BYTES_PER_ELEMENT);
        module.HEAPF64.set(features.f0, f0Pointer / Float64Array.BYTES_PER_ELEMENT);
        module.HEAPF64.set(features.spectral, spectralPointer / Float64Array.BYTES_PER_ELEMENT);
        module.HEAPF64.set(features.aperiodicity,
          aperiodicityPointer / Float64Array.BYTES_PER_ELEMENT);
        const status = module._world_synthesize_f32(
          handle,
          f0Pointer,
          spectralPointer,
          aperiodicityPointer,
          outputPointer,
          features.sampleCount,
        );
        checkStatus(module, status);
        return module.HEAPF32.slice(outputPointer / Float32Array.BYTES_PER_ELEMENT,
          outputPointer / Float32Array.BYTES_PER_ELEMENT + features.sampleCount);
      } finally {
        module._free(f0Pointer);
        if (spectralPointer !== 0) module._free(spectralPointer);
        if (aperiodicityPointer !== 0) module._free(aperiodicityPointer);
        if (outputPointer !== 0) module._free(outputPointer);
      }
    },

    dispose(features?: WorldFeatures) {
      if (features !== undefined) {
        disposeFeatures(features);
        return;
      }
      if (disposed) return;
      disposed = true;
      for (const features of liveFeatures) disposeFeatures(features);
    },
  };
}
