import { OggOpusDecoder } from 'ogg-opus-decoder';
import { createWordPlan } from './parser';
import { mixLayers, monoFromChannels, OUTPUT_SAMPLE_RATE, transformWord } from './dsp';
import type { Bank, BankClip, RenderOptions, WordPlan } from './types';

type RequestMessage = { type: 'render'; bank: Bank; plan: WordPlan[]; options: RenderOptions };
type ResponseMessage =
  | { type: 'progress'; value: number }
  | { type: 'done'; samples: Float32Array; sampleRate: number; duration: number; words: string[]; warnings: string[] }
  | { type: 'error'; message: string };
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RequestMessage>) => void) | null;
  postMessage: (message: ResponseMessage, transfer?: Transferable[]) => void;
};

async function fetchClip(clip: BankClip, decoder: OggOpusDecoder): Promise<Float32Array> {
  if (!clip.file.startsWith('/audio/') || clip.file.includes('..')) throw new Error(`Unsafe audio path for ${clip.id}.`);
  const response = await fetch(new URL(clip.file, self.location.origin));
  if (!response.ok) throw new Error(`Could not load audio clip ${clip.id} (${response.status}).`);
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > 32 * 1024 * 1024) throw new Error(`Audio clip ${clip.id} has an invalid file size.`);
  const decoded = await decoder.decodeFile(new Uint8Array(buffer));
  if (decoded.errors.length) throw new Error(`Opus decoding failed for ${clip.id}: ${decoded.errors[0].message}`);
  const mono = monoFromChannels(decoded.channelData);
  if (!mono.length || mono.length > OUTPUT_SAMPLE_RATE * 120) throw new Error(`Audio clip ${clip.id} has an invalid duration.`);
  return mono;
}

scope.onmessage = async ({ data }) => {
  if (data.type !== 'render') return;
  let decoder: OggOpusDecoder | undefined;
  try {
    decoder = new OggOpusDecoder();
    await decoder.ready;
    const clipById = new Map(data.bank.clips.map((clip) => [clip.id, clip]));
    const plan = data.plan;
    const uniqueIds = [...new Set(plan.map((word) => word.clipId))];
    const decodedById = new Map<string, Float32Array>();
    const warnings: string[] = [];
    for (let index = 0; index < uniqueIds.length; index += 1) {
      const id = uniqueIds[index];
      const clip = clipById.get(id);
      if (!clip) throw new Error(`Audio bank is missing ${id}.`);
      decodedById.set(id, await fetchClip(clip, decoder));
      await decoder.reset();
      scope.postMessage({ type: 'progress', value: (index + 1) / (uniqueIds.length + 1) });
    }

    const layers: Array<{ samples: Float32Array; start: number; gain?: number }> = [];
    let previousStart = 0;
    let previousEnd = 0;
    let timelineEnd = 0;
    for (let index = 0; index < plan.length; index += 1) {
      const word = plan[index];
      const decoded = decodedById.get(word.clipId);
      if (!decoded) throw new Error(`Could not decode ${word.clipId}.`);
      const samples = transformWord(decoded, OUTPUT_SAMPLE_RATE, word, data.options.pitch);
      let start = index === 0
        ? (word.sleep ?? 0)
        : word.spacing !== undefined
          ? previousStart + word.spacing + (word.sleep ?? 0)
          : previousEnd + data.options.gap + (word.sleep ?? 0);
      start = Math.max(0, start);
      if (word.startAt !== undefined && word.startAt >= decoded.length / OUTPUT_SAMPLE_RATE) {
        warnings.push(`Start time skipped all of “${word.display}”.`);
      }
      const frameStart = Math.floor(start * OUTPUT_SAMPLE_RATE);
      if (samples.length && frameStart + samples.length > 0) layers.push({ samples, start: frameStart });
      previousStart = start;
      previousEnd = start + samples.length / OUTPUT_SAMPLE_RATE;
      timelineEnd = Math.max(timelineEnd, previousEnd);
      if (timelineEnd > 120) throw new Error('Rendered audio exceeds the 120-second limit.');
      scope.postMessage({ type: 'progress', value: (uniqueIds.length + index + 1) / (uniqueIds.length + plan.length + 1) });
    }

    if (data.options.background) {
      const background = data.bank.clips.find((clip) => clip.id.toLocaleLowerCase('en-US') === 'cassie-background-std' && clip.kind === 'effect');
      if (!background) warnings.push('CASSIE background audio is not available in this bank.');
      else {
        const backgroundSamples = await fetchClip(background, decoder);
        const length = Math.min(backgroundSamples.length, Math.ceil(timelineEnd * OUTPUT_SAMPLE_RATE));
        if (length > 0) layers.push({ samples: backgroundSamples.subarray(0, length), start: 0, gain: 0.2 });
      }
    }
    const samples = mixLayers(layers);
    const result = {
      type: 'done' as const,
      samples,
      sampleRate: OUTPUT_SAMPLE_RATE,
      duration: samples.length / OUTPUT_SAMPLE_RATE,
      words: plan.map((word) => word.display),
      warnings,
    };
    scope.postMessage(result, [samples.buffer]);
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Audio rendering failed.' });
  } finally {
    decoder?.free();
  }
};
