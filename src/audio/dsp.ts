import type { ClipKind, TimelineEntry, WordPlan } from './types';
import { FifoSampleBuffer, Stretch } from '@soundtouchjs/core';

export const OUTPUT_SAMPLE_RATE = 48_000;
export const MAX_RENDER_SECONDS = 120;

export function stretchSpeechRate(samples: Float32Array, sampleRate: number, rate: number): Float32Array {
  if (rate === 1 || samples.length === 0) return samples;
  if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) throw new Error('Speech rate is outside the supported range.');
  const outputFrames = Math.ceil(samples.length / rate);
  if (outputFrames > MAX_RENDER_SECONDS * sampleRate) throw new Error('Speech rate adjustment exceeds the 120-second render limit.');

  const stereo = new Float32Array(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) stereo[index * 2] = stereo[index * 2 + 1] = samples[index];
  const input = new FifoSampleBuffer();
  const output = new FifoSampleBuffer();
  input.putSamples(stereo);
  input.putSamples(new Float32Array(Math.ceil(sampleRate * 0.5) * 2));
  const stretch = new Stretch({ sampleRate, createBuffers: true });
  stretch.inputBuffer = input;
  stretch.outputBuffer = output;
  stretch.tempo = rate;
  stretch.process();

  const available = output.frameCount;
  const interleaved = new Float32Array(available * 2);
  output.extract(interleaved, 0, available);
  const result = new Float32Array(outputFrames);
  for (let index = 0; index < outputFrames; index += 1) {
    result[index] = index < available ? (interleaved[index * 2] + interleaved[index * 2 + 1]) * 0.5 : 0;
  }
  return result;
}

export function stretchSpeechPreservingGaps(
  samples: Float32Array,
  sampleRate: number,
  rate: number,
  timeline: TimelineSpan[],
): { samples: Float32Array; timeline: TimelineSpan[] } {
  if (rate === 1 || !samples.length) return { samples, timeline };
  const gaps = timeline.filter((entry) => entry.kind === 'gap')
    .map((entry) => ({ start: Math.max(0, Math.floor(entry.startSeconds * sampleRate)), end: Math.min(samples.length, Math.ceil(entry.endSeconds * sampleRate)) }))
    .sort((left, right) => left.start - right.start);
  const preservedGapFrames = gaps.reduce((sum, gap) => sum + Math.max(0, gap.end - gap.start), 0);
  const predictedFrames = Math.ceil((samples.length - preservedGapFrames) / rate) + preservedGapFrames;
  if (predictedFrames > MAX_RENDER_SECONDS * sampleRate) throw new Error('Speech rate adjustment exceeds the 120-second render limit.');
  const output: Float32Array[] = [];
  const segments: Array<{ sourceStart: number; sourceEnd: number; outputStart: number; outputEnd: number; gap: boolean }> = [];
  let sourceCursor = 0;
  let outputCursor = 0;
  const append = (start: number, end: number, gap: boolean) => {
    if (end <= start) return;
    const part = gap ? samples.subarray(start, end) : stretchSpeechRate(samples.subarray(start, end), sampleRate, rate);
    if (!part.length) return;
    output.push(part);
    segments.push({ sourceStart: start, sourceEnd: end, outputStart: outputCursor, outputEnd: outputCursor + part.length, gap });
    outputCursor += part.length;
  };
  for (const gap of gaps) {
    const start = Math.max(sourceCursor, gap.start);
    const end = Math.max(start, gap.end);
    append(sourceCursor, start, false);
    append(start, end, true);
    sourceCursor = end;
  }
  append(sourceCursor, samples.length, false);
  if (outputCursor > MAX_RENDER_SECONDS * sampleRate) throw new Error('Speech rate adjustment exceeds the 120-second render limit.');
  const stretched = new Float32Array(outputCursor);
  let offset = 0;
  for (const part of output) {
    stretched.set(part, offset);
    offset += part.length;
  }
  const mapped = timeline.flatMap((entry) => {
    const start = Math.max(0, Math.floor(entry.startSeconds * sampleRate));
    const end = Math.min(samples.length, Math.ceil(entry.endSeconds * sampleRate));
    return segments.flatMap((segment) => {
      const overlapStart = Math.max(start, segment.sourceStart);
      const overlapEnd = Math.min(end, segment.sourceEnd);
      if (overlapEnd <= overlapStart) return [];
      const sourceLength = segment.sourceEnd - segment.sourceStart;
      const outputLength = segment.outputEnd - segment.outputStart;
      const outputStart = segment.outputStart + (overlapStart - segment.sourceStart) * outputLength / sourceLength;
      const outputEnd = segment.outputStart + (overlapEnd - segment.sourceStart) * outputLength / sourceLength;
      return outputEnd > outputStart ? [{
        ...entry,
        startSeconds: outputStart / sampleRate,
        endSeconds: outputEnd / sampleRate,
      }] : [];
    });
  }).sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds);
  return { samples: stretched, timeline: mapped };
}

export function nextClipStart(
  previousEnd: number,
  previousKind: ClipKind | 'pause' | undefined,
  nextKind: ClipKind | 'pause',
  speechGap: number,
  sleep = 0,
): number {
  if (previousKind === undefined) return Math.max(0, sleep);
  const gap = previousKind === 'word' && nextKind === 'word' ? speechGap : 0;
  return Math.max(0, previousEnd + gap + sleep);
}

function crossfadeJoin(left: Float32Array, right: Float32Array, sampleRate: number): Float32Array {
  if (!left.length) return right;
  if (!right.length) return left;
  const overlap = Math.min(Math.round(sampleRate * 0.002), Math.floor(left.length / 4), Math.floor(right.length / 4));
  if (!overlap) {
    const output = new Float32Array(left.length + right.length);
    output.set(left);
    output.set(right, left.length);
    return output;
  }
  const output = new Float32Array(left.length + right.length - overlap);
  output.set(left.subarray(0, left.length - overlap));
  for (let index = 0; index < overlap; index += 1) {
    const amount = (index + 1) / (overlap + 1);
    output[left.length - overlap + index] = left[left.length - overlap + index] * (1 - amount) + right[index] * amount;
  }
  output.set(right.subarray(overlap), left.length);
  return output;
}

export function stretchVowelLoop(samples: Float32Array, sampleRate: number, factor: number): Float32Array {
  if (!samples.length || !Number.isFinite(factor) || factor <= 1) return samples;
  const targetLength = Math.ceil(samples.length * Math.min(2, factor));
  const coreStart = Math.floor(samples.length * 0.2);
  const coreEnd = Math.max(coreStart + 1, Math.ceil(samples.length * 0.8));
  const head = samples.subarray(0, coreEnd);
  const loop = samples.subarray(coreStart, coreEnd);
  const tail = samples.subarray(coreEnd);
  const fade = Math.min(Math.round(sampleRate * 0.005), Math.floor(head.length / 4), Math.floor(loop.length / 4), Math.floor(tail.length / 4));
  if (!fade || loop.length <= fade * 2 || !tail.length) return samples;
  let output: Float32Array<ArrayBufferLike> = head.slice();
  const targetBeforeTail = targetLength - (tail.length - fade);
  while (output.length < targetBeforeTail) {
    const needed = targetBeforeTail - output.length;
    const pieceLength = Math.min(loop.length, needed + fade);
    output = crossfadeJoin(output, loop.subarray(0, pieceLength), sampleRate);
  }
  const joined = crossfadeJoin(output, tail, sampleRate);
  return joined.length > targetLength ? joined.subarray(0, targetLength) : joined;
}

export function splicePhonemeWindows(segments: Float32Array[], sampleRate: number): Float32Array {
  if (!segments.length) return new Float32Array(0);
  let output: Float32Array<ArrayBufferLike> = segments[0];
  for (let index = 1; index < segments.length; index += 1) output = crossfadeJoin(output, segments[index], sampleRate);
  const faded = output.slice();
  const fadeLength = Math.min(Math.round(sampleRate * 0.002), Math.floor(faded.length / 2));
  for (let index = 0; index < fadeLength; index += 1) {
    const gain = (index + 1) / fadeLength;
    faded[index] *= gain;
    faded[faded.length - 1 - index] *= gain;
  }
  return faded;
}

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

const STUTTER_FADE_SECONDS = 0.004;

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
  const sliceEnd = point + segmentLength;
  const fade = Math.min(Math.round(sampleRate * STUTTER_FADE_SECONDS), Math.floor(segmentLength / 2));
  const following = Math.min(fade, samples.length - sliceEnd);
  for (let join = 1; join <= stutter.repeats; join += 1) {
    const base = point + join * segmentLength;
    if (following === fade) {
      // Equal-power blend into the audio that follows the slice end hides the loop seam
      for (let index = 0; index < fade; index += 1) {
        const angle = Math.PI / 2 * (index + 1) / (fade + 1);
        repeated[base + index] = samples[point + index] * Math.sin(angle) + samples[sliceEnd + index] * Math.cos(angle);
      }
    } else {
      // The slice reaches the end of the audio, so dip through zero at the restart instead
      for (let index = 0; index < fade; index += 1) {
        const angle = Math.PI / 2 * (index + 1) / (fade + 1);
        repeated[base + index] *= Math.sin(angle);
        repeated[base - 1 - index] *= Math.sin(angle);
      }
    }
  }
  return repeated;
}

export interface SourceTimelineSpan {
  startSample: number;
  endSample: number;
  sourceStart: number;
  sourceEnd: number;
  kind: TimelineEntry['kind'];
}

export type TimelineSpan = Omit<TimelineEntry, 'track' | 'provenance'>;

export function appendTimelineEntry(timeline: TimelineEntry[], entry: TimelineEntry): boolean {
  if (!Number.isFinite(entry.startSeconds) || !Number.isFinite(entry.endSeconds) || entry.endSeconds <= entry.startSeconds) return false;
  timeline.push(entry);
  return true;
}

export function clipTimelineToDuration(timeline: TimelineEntry[], duration: number): TimelineEntry[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  return timeline.flatMap((entry) => {
    const endSeconds = Math.min(entry.endSeconds, duration);
    return entry.startSeconds < endSeconds ? [{ ...entry, endSeconds }] : [];
  });
}

export function mapSourceTimeline(
  spans: SourceTimelineSpan[],
  sourceLength: number,
  plan: Pick<WordPlan, 'startAt' | 'maxDuration' | 'stutter' | 'pitch' | 'rate'>,
  globalPitch: number,
  sampleRate: number,
  outputStartSeconds: number,
  outputLength: number,
  globalRate = 1,
): TimelineSpan[] {
  const cropStart = Math.min(sourceLength, Math.floor((plan.startAt ?? 0) * sampleRate));
  const cropEnd = Math.min(sourceLength, cropStart + (plan.maxDuration === undefined ? sourceLength : Math.floor(plan.maxDuration * sampleRate)));
  const croppedLength = cropEnd - cropStart;
  const pitch = plan.pitch * globalPitch;
  const rate = (plan.rate ?? 1) * globalRate;
  if (croppedLength <= 0 || !Number.isFinite(pitch) || pitch <= 0 || !Number.isFinite(rate) || rate <= 0 || outputLength <= 0) return [];
  const stutter = plan.stutter;
  const point = stutter ? Math.min(croppedLength, Math.floor(stutter.position * croppedLength)) : croppedLength;
  const repeatLength = stutter
    ? Math.min(croppedLength - point, Math.max(1, Math.floor(stutter.length * sampleRate)))
    : 0;
  const repeats = repeatLength > 0 ? stutter?.repeats ?? 0 : 0;
  const pieces = repeats > 0
    ? [
      { sourceStart: cropStart, sourceEnd: cropStart + point, outputStart: 0 },
      ...Array.from({ length: repeats }, (_, repeat) => ({
        sourceStart: cropStart + point,
        sourceEnd: cropStart + point + repeatLength,
        outputStart: point + repeat * repeatLength,
      })),
      { sourceStart: cropStart + point, sourceEnd: cropEnd, outputStart: point + repeats * repeatLength },
    ]
    : [{ sourceStart: cropStart, sourceEnd: cropEnd, outputStart: 0 }];
  const renderedLength = outputLength / sampleRate;
  const timeline: TimelineSpan[] = [];
  for (const span of spans) {
    if (!Number.isFinite(span.startSample) || !Number.isFinite(span.endSample) || span.endSample <= span.startSample) continue;
    for (const piece of pieces) {
      const start = Math.max(span.startSample, piece.sourceStart);
      const end = Math.min(span.endSample, piece.sourceEnd);
      if (end <= start) continue;
      const outputStart = outputStartSeconds + (piece.outputStart + start - piece.sourceStart) / (pitch * rate * sampleRate);
      const outputEnd = outputStartSeconds + (piece.outputStart + end - piece.sourceStart) / (pitch * rate * sampleRate);
      const clippedStart = Math.max(outputStartSeconds, outputStart);
      const clippedEnd = Math.min(outputStartSeconds + renderedLength, outputEnd);
      if (clippedEnd > clippedStart) timeline.push({
        startSeconds: clippedStart,
        endSeconds: clippedEnd,
        sourceStart: span.sourceStart,
        sourceEnd: span.sourceEnd,
        kind: span.kind,
      });
    }
  }
  return timeline;
}

export function transformWord(samples: Float32Array, sampleRate: number, plan: WordPlan, pitchScale: number, globalGain = 1): Float32Array {
  const pitch = plan.pitch * pitchScale;
  if (!Number.isFinite(pitch) || pitch < 0.0065 || pitch > 20.25) throw new Error(`Invalid pitch for ${plan.display}.`);
  const first = Math.min(samples.length, Math.floor((plan.startAt ?? 0) * sampleRate));
  const end = plan.maxDuration === undefined
    ? samples.length
    : Math.min(samples.length, first + Math.floor(plan.maxDuration * sampleRate));
  const source = applyStutter(samples.subarray(first, end), sampleRate, plan.stutter);
  if (!source.length) return new Float32Array(0);
  const outputLength = Math.max(1, Math.ceil(source.length / pitch));
  if (outputLength > MAX_RENDER_SECONDS * sampleRate) throw new Error('Pitch adjustment exceeds the 120-second clip limit.');
  const output = new Float32Array(outputLength);
  const gain = plan.volume * globalGain;
  for (let index = 0; index < output.length; index += 1) {
    const position = Math.min(source.length - 1, index * pitch);
    const left = Math.floor(position);
    const right = Math.min(source.length - 1, left + 1);
    const fraction = position - left;
    output[index] = (source[left] * (1 - fraction) + source[right] * fraction) * gain;
  }
  return output;
}

const LIMITER_KNEE = 0.95;

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
  for (let index = 0; index < mixed.length; index += 1) {
    const magnitude = Math.abs(mixed[index]);
    // Soft knee keeps overlapping tracks from hard clipping
    if (magnitude > LIMITER_KNEE) mixed[index] = Math.sign(mixed[index]) * (LIMITER_KNEE + (1 - LIMITER_KNEE) * Math.tanh((magnitude - LIMITER_KNEE) / (1 - LIMITER_KNEE)));
  }
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
