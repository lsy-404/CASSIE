import type { WordPlan } from './types';

export const OUTPUT_SAMPLE_RATE = 48_000;
export const MAX_RENDER_SECONDS = 120;

export function monoFromChannels(channels: Float32Array[]): Float32Array {
  if (!channels.length || channels.some((channel) => channel.length !== channels[0].length)) {
    throw new Error('Decoded audio has an invalid channel layout.');
  }
  if (channels.length === 1) return channels[0];
  const mono = new Float32Array(channels[0].length);
  const gain = 1 / channels.length;
  for (const channel of channels) {
    for (let index = 0; index < mono.length; index += 1) mono[index] += channel[index] * gain;
  }
  return mono;
}

export function applyStutter(samples: Float32Array, sampleRate: number, stutter?: WordPlan['stutter']): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length > MAX_RENDER_SECONDS * sampleRate) {
    throw new Error('Audio clip exceeds rendering limits.');
  }
  if (!stutter) return samples;
  const point = Math.min(samples.length, Math.floor(stutter.position * samples.length));
  const segmentLength = Math.min(samples.length - point, Math.max(1, Math.floor(stutter.length * sampleRate)));
  if (!segmentLength) return samples;
  const outputLength = samples.length + segmentLength * stutter.repeats;
  if (outputLength > MAX_RENDER_SECONDS * sampleRate) throw new Error('Stutter exceeds the 120-second clip limit.');
  const repeated = new Float32Array(outputLength);
  repeated.set(samples.subarray(0, point));
  let offset = point;
  for (let repeat = 0; repeat < stutter.repeats; repeat += 1) {
    repeated.set(samples.subarray(point, point + segmentLength), offset);
    offset += segmentLength;
  }
  repeated.set(samples.subarray(point), offset);
  return repeated;
}

export function transformWord(samples: Float32Array, sampleRate: number, plan: WordPlan, pitchScale: number): Float32Array {
  const pitch = plan.pitch * pitchScale;
  if (!Number.isFinite(pitch) || pitch < 0.0065 || pitch > 20.25) throw new Error(`Invalid pitch for ${plan.display}.`);
  const first = Math.min(samples.length, Math.floor((plan.startAt ?? 0) * sampleRate));
  let end = samples.length;
  if (plan.maxDuration !== undefined) end = Math.min(end, first + Math.floor(plan.maxDuration * sampleRate));
  const source = applyStutter(samples.subarray(first, end), sampleRate, plan.stutter);
  if (!source.length) return new Float32Array(0);
  const outputLength = Math.max(1, Math.ceil(source.length / pitch));
  if (outputLength > MAX_RENDER_SECONDS * sampleRate) throw new Error('Pitch adjustment exceeds the 120-second clip limit.');
  const output = new Float32Array(outputLength);
  const gain = plan.volume;
  for (let index = 0; index < output.length; index += 1) {
    const position = Math.min(source.length - 1, index * pitch);
    const left = Math.floor(position);
    const right = Math.min(source.length - 1, left + 1);
    const fraction = position - left;
    output[index] = (source[left] * (1 - fraction) + source[right] * fraction) * gain;
  }
  return output;
}

export function mixLayers(layers: Array<{ samples: Float32Array; start: number; gain?: number }>): Float32Array {
  const end = layers.reduce((maximum, layer) => Math.max(maximum, layer.start + layer.samples.length), 0);
  if (end > MAX_RENDER_SECONDS * OUTPUT_SAMPLE_RATE) throw new Error(`Rendered audio exceeds the ${MAX_RENDER_SECONDS}-second limit.`);
  const mixed = new Float32Array(end);
  for (const layer of layers) {
    const gain = layer.gain ?? 1;
    for (let index = 0; index < layer.samples.length; index += 1) {
      mixed[layer.start + index] += layer.samples[index] * gain;
    }
  }
  for (let index = 0; index < mixed.length; index += 1) mixed[index] = Math.max(-1, Math.min(1, mixed[index]));
  return mixed;
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length > MAX_RENDER_SECONDS * sampleRate) {
    throw new Error('Audio data exceeds WAV export limits.');
  }
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const write = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
