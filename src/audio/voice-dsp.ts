import type { VoiceOptions } from './types';

export interface WorldFeatureSet {
  frameCount: number;
  fftSize: number;
  binCount: number;
  framePeriodMs: number;
  sampleCount: number;
  f0: Float64Array;
  spectral: Float64Array;
  aperiodicity: Float64Array;
}

export interface EditedWorldFeatures {
  f0: Float64Array;
  spectral: Float64Array;
  aperiodicity: Float64Array;
}

export function isNeutralVoice(options: VoiceOptions): boolean {
  return options.pitchSemitones === 0 && options.breathiness === 0 && options.formantSemitones === 0 && (options.loudnessDb ?? 0) === 0 && (options.tension ?? 0) === 0;
}

export function hasWorldVoiceEffects(options: VoiceOptions): boolean {
  return options.pitchSemitones !== 0 || options.breathiness !== 0 || options.formantSemitones !== 0 || (options.tension ?? 0) !== 0;
}

export function editWorldFeatures(features: WorldFeatureSet, options: VoiceOptions): EditedWorldFeatures {
  if (!Number.isInteger(features.sampleCount) || features.sampleCount <= 0 ||
      !Number.isInteger(features.fftSize) || features.fftSize < 2 || features.binCount !== features.fftSize / 2 + 1 ||
      features.framePeriodMs !== 5 || !Number.isInteger(features.frameCount) || features.frameCount <= 0 || !Number.isInteger(features.binCount) ||
      features.binCount <= 1 || features.f0.length !== features.frameCount ||
      features.spectral.length !== features.frameCount * features.binCount ||
      features.aperiodicity.length !== features.frameCount * features.binCount) {
    throw new Error('WORLD returned invalid voice features.');
  }
  if (!Number.isFinite(options.pitchSemitones) || options.pitchSemitones < -12 || options.pitchSemitones > 12 ||
      !Number.isFinite(options.breathiness) || options.breathiness < 0 || options.breathiness > 1 ||
      !Number.isFinite(options.formantSemitones) || options.formantSemitones < -6 || options.formantSemitones > 6 ||
      !Number.isFinite(options.loudnessDb ?? 0) || (options.loudnessDb ?? 0) < -24 || (options.loudnessDb ?? 0) > 12 ||
      !Number.isFinite(options.tension ?? 0) || (options.tension ?? 0) < -1 || (options.tension ?? 0) > 1) {
    throw new Error('Voice parameters are outside their supported ranges.');
  }
  const f0 = features.f0.slice();
  const spectral = features.spectral.slice();
  const aperiodicity = features.aperiodicity.slice();
  const pitchRatio = 2 ** (options.pitchSemitones / 12);
  const formantRatio = 2 ** (options.formantSemitones / 12);
  const spectralTiltDbPerOctave = (options.tension ?? 0) * 3;
  for (let frame = 0; frame < features.frameCount; frame += 1) {
    const fundamental = f0[frame];
    if (!Number.isFinite(fundamental) || fundamental < 0) throw new Error('WORLD returned an invalid fundamental frequency.');
    const voiced = fundamental > 0;
    if (voiced && options.pitchSemitones !== 0) f0[frame] = fundamental * pitchRatio;
    for (let bin = 0; bin < features.binCount; bin += 1) {
      const index = frame * features.binCount + bin;
      const ap = aperiodicity[index];
      const power = spectral[index];
      if (!Number.isFinite(ap) || ap < 0 || ap > 1 || !Number.isFinite(power) || power < 0) {
        throw new Error('WORLD returned an invalid spectral feature.');
      }
      if (voiced && options.breathiness > 0) {
        aperiodicity[index] = Math.sqrt(ap * ap + options.breathiness * 0.75 * (1 - ap * ap));
      }
      if (voiced && spectralTiltDbPerOctave !== 0) {
        const frequency = Math.max(40, bin * 48_000 / features.fftSize);
        const octavesFromReference = Math.log2(frequency / 1_000);
        const powerGain = 10 ** (spectralTiltDbPerOctave * octavesFromReference / 10);
        spectral[index] = Math.min(1e12, power * powerGain);
      }
    }
    if (options.formantSemitones !== 0) {
      const frameStart = frame * features.binCount;
      const formantSource = spectral.slice(frameStart, frameStart + features.binCount);
      for (let bin = 0; bin < features.binCount; bin += 1) {
        const sourceBin = Math.max(0, Math.min(features.binCount - 1, bin / formantRatio));
        const lower = Math.floor(sourceBin);
        const upper = Math.min(features.binCount - 1, lower + 1);
        const fraction = sourceBin - lower;
        spectral[frameStart + bin] = formantSource[lower] * (1 - fraction) + formantSource[upper] * fraction;
      }
    }
  }
  return { f0, spectral, aperiodicity };
}

export function applyVoiceLoudness(samples: Float32Array, loudnessDb: number, ceiling = 0.98): Float32Array {
  if (!Number.isFinite(loudnessDb) || loudnessDb < -24 || loudnessDb > 12 || !Number.isFinite(ceiling) || ceiling <= 0 || ceiling > 1) {
    throw new Error('Voice parameters are outside their supported ranges.');
  }
  if (loudnessDb === 0 || samples.length === 0) return samples;
  let peak = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error('Voice processing returned non-finite audio.');
    peak = Math.max(peak, Math.abs(sample));
  }
  const requestedGain = 10 ** (loudnessDb / 20);
  const safeGain = peak === 0 ? requestedGain : Math.min(requestedGain, (ceiling * (1 - 1e-7)) / peak);
  const output = new Float32Array(samples.length);
  for (let index = 0; index < output.length; index += 1) output[index] = samples[index] * safeGain;
  return output;
}

export function blendVoiceEdges(original: Float32Array, processed: Float32Array, sampleRate: number, fadeMs = 5): Float32Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || original.length !== processed.length) {
    throw new Error('Voice processing changed the audio duration.');
  }
  const output = processed.slice();
  const fade = Math.min(Math.floor(sampleRate * fadeMs / 1000), Math.floor(output.length / 2));
  for (let index = 0; index < output.length; index += 1) {
    if (!Number.isFinite(output[index])) throw new Error('Voice processing returned non-finite audio.');
    let blend = 1;
    if (index < fade) blend = 0.5 - 0.5 * Math.cos(Math.PI * (index + 1) / (fade + 1));
    else if (index >= output.length - fade) blend = 0.5 - 0.5 * Math.cos(Math.PI * (output.length - index) / (fade + 1));
    output[index] = original[index] * (1 - blend) + output[index] * blend;
  }
  return output;
}

export async function processVoicePreservingGaps(
  samples: Float32Array,
  sampleRate: number,
  gaps: Array<{ startSeconds: number; endSeconds: number }>,
  processSpeech: (speech: Float32Array) => Promise<Float32Array>,
): Promise<Float32Array> {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error('Voice processing requires a valid sample rate.');
  const ranges = gaps.map((gap) => {
    if (!Number.isFinite(gap.startSeconds) || !Number.isFinite(gap.endSeconds) || gap.startSeconds < 0 || gap.endSeconds < gap.startSeconds) {
      throw new Error('Voice processing received an invalid speech gap.');
    }
    return {
      start: Math.max(0, Math.min(samples.length, Math.floor(gap.startSeconds * sampleRate))),
      end: Math.max(0, Math.min(samples.length, Math.ceil(gap.endSeconds * sampleRate))),
    };
  }).filter((gap) => gap.end > gap.start).sort((left, right) => left.start - right.start);
  const output = samples.slice();
  let cursor = 0;
  for (const gap of ranges) {
    const start = Math.max(cursor, gap.start);
    const end = Math.max(start, gap.end);
    if (start > cursor) {
      const speech = samples.subarray(cursor, start);
      const processed = await processSpeech(speech);
      if (processed.length !== speech.length) throw new Error('Voice processing changed the audio duration.');
      output.set(processed, cursor);
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < samples.length) {
    const speech = samples.subarray(cursor);
    const processed = await processSpeech(speech);
    if (processed.length !== speech.length) throw new Error('Voice processing changed the audio duration.');
    output.set(processed, cursor);
  }
  return output;
}
