import { OggOpusDecoder } from 'ogg-opus-decoder';
import { advancePlaybackCursorAfterRepeat, appendTimelineEntry, clipTimelineToDuration, mapSourceTimeline, mixLayers, monoFromChannels, nextClipStart, OUTPUT_SAMPLE_RATE, splicePhonemeWindows, stretchVowelLoop, transformWord } from './dsp';
import type { Bank, BankClip, RenderOptions, TimelineEntry, WordPlan } from './types';

type RequestMessage = { type: 'render'; bank: Bank; plan: WordPlan[]; options: RenderOptions };
type ResponseMessage =
  | { type: 'progress'; value: number }
  | { type: 'done'; samples: Float32Array; sampleRate: number; duration: number; words: string[]; warnings: string[]; timeline: TimelineEntry[] }
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
    const uniqueIds = [...new Set(plan.flatMap((word) => [...(word.prefixClipIds ?? []), ...(word.clipId ? [word.clipId] : []), ...(word.suffixClipIds ?? []), ...(word.phonemeUnits ?? []).map((unit) => unit.clipId)]))];
    const decodedById = new Map<string, Float32Array>();
    const warnings: string[] = [];
    for (let index = 0; index < uniqueIds.length; index += 1) {
      const id = uniqueIds[index];
      const clip = clipById.get(id);
      if (!clip) throw new Error(`Audio bank is missing ${id}.`);
      decodedById.set(id, await fetchClip(clip, decoder));
      await decoder.reset();
      scope.postMessage({ type: 'progress', value: 0.6 * (index + 1) / uniqueIds.length });
    }

    const layers: Array<{ samples: Float32Array; start: number; gain?: number }> = [];
    let audioSampleCount = 0;
    const maxLayerSamples = OUTPUT_SAMPLE_RATE * 300;
    let previousStart = 0;
    let previousEnd = 0;
    let timelineEnd = 0;
    const timeline: TimelineEntry[] = [];
    const stutterGroups = new Map<number, { start: number; end: number; repeats: number }>();
    const finishStutterScopes = (word: WordPlan) => {
      for (const id of word.stutterScopeEnds ?? []) {
        const group = stutterGroups.get(id);
        if (!group) continue;
        const start = Math.floor(group.start * OUTPUT_SAMPLE_RATE);
        const end = Math.ceil(group.end * OUTPUT_SAMPLE_RATE);
        const length = Math.max(0, end - start);
        const added = length * group.repeats;
        if (!length || added + audioSampleCount > maxLayerSamples) {
          stutterGroups.delete(id);
          if (length) throw new Error('Scoped stutter exceeds the five-minute processing limit.');
          continue;
        }
        if (end + added > OUTPUT_SAMPLE_RATE * 120) throw new Error('Scoped stutter exceeds the 120-second render limit.');
        const groupLayers = layers.filter((layer) => layer.start >= start && layer.start + layer.samples.length <= end)
          .map((layer) => ({ samples: layer.samples, start: layer.start - start, gain: layer.gain }));
        const segment = mixLayers(groupLayers);
        if (!segment.length) {
          stutterGroups.delete(id);
          continue;
        }
        for (let repeat = 0; repeat < group.repeats; repeat += 1) {
          layers.push({ samples: segment, start: end + repeat * length });
        }
        const originals = timeline.filter((entry) => entry.startSeconds >= group.start && entry.endSeconds <= group.end);
        for (let repeat = 0; repeat < group.repeats; repeat += 1) {
          const shift = (group.end - group.start) * (repeat + 1);
          for (const entry of originals) appendTimelineEntry(timeline, { ...entry, startSeconds: entry.startSeconds + shift, endSeconds: entry.endSeconds + shift });
        }
        audioSampleCount += added;
        const repeatedEnd = (end + added) / OUTPUT_SAMPLE_RATE;
        ({ previousEnd, previousStart } = advancePlaybackCursorAfterRepeat(previousEnd, previousStart, repeatedEnd));
        timelineEnd = Math.max(timelineEnd, repeatedEnd);
        for (const active of word.stutterScopes ?? []) {
          const outer = stutterGroups.get(active.id);
          if (outer && active.id !== id) outer.end += added / OUTPUT_SAMPLE_RATE;
        }
        stutterGroups.delete(id);
      }
    };
    for (let index = 0; index < plan.length; index += 1) {
      const word = plan[index];
      if (word.pauseDuration !== undefined) {
        if (!Number.isFinite(word.pauseDuration) || word.pauseDuration < 0 || word.pauseDuration > 120) {
          throw new Error('Pause duration exceeds the 120-second limit.');
        }
        const previousPlan = index > 0 ? plan[index - 1] : undefined;
        const previousClip = previousPlan?.clipId ? clipById.get(previousPlan.clipId) : undefined;
        const previousKind = previousPlan?.pauseDuration !== undefined ? 'pause' : previousClip?.kind;
        const start = Math.max(0, word.spacing !== undefined
          ? previousStart + word.spacing + (word.sleep ?? 0)
          : nextClipStart(previousEnd, previousKind, 'pause', data.options.gap, word.sleep ?? 0));
        for (const scope of word.stutterScopes ?? []) if (!stutterGroups.has(scope.id)) stutterGroups.set(scope.id, { start, end: start, repeats: scope.repeats });
        const samples = new Float32Array(Math.ceil(word.pauseDuration * OUTPUT_SAMPLE_RATE));
        if (start > previousEnd && word.gapSourceStart !== undefined && word.gapSourceEnd !== undefined) {
          appendTimelineEntry(timeline, { startSeconds: previousEnd, endSeconds: start, sourceStart: word.gapSourceStart, sourceEnd: word.gapSourceEnd, kind: 'gap' });
        }
        appendTimelineEntry(timeline, { startSeconds: start, endSeconds: start + samples.length / OUTPUT_SAMPLE_RATE, sourceStart: word.sourceStart ?? 0, sourceEnd: word.sourceEnd ?? 0, kind: 'gap' });
        if (samples.length) {
          audioSampleCount += samples.length;
          if (audioSampleCount > maxLayerSamples) throw new Error('Audio content exceeds the five-minute processing limit.');
          layers.push({ samples, start: Math.floor(start * OUTPUT_SAMPLE_RATE) });
        }
        previousEnd = start + samples.length / OUTPUT_SAMPLE_RATE;
        previousStart = start;
        timelineEnd = Math.max(timelineEnd, previousEnd);
        for (const scope of word.stutterScopes ?? []) {
          const group = stutterGroups.get(scope.id);
          if (group) group.end = Math.max(group.end, previousEnd);
        }
        finishStutterScopes(word);
        if (timelineEnd > 120) throw new Error('Rendered audio exceeds the 120-second limit.');
        scope.postMessage({ type: 'progress', value: 0.6 + 0.35 * (index + 1) / plan.length });
        continue;
      }
      const sourceClip = clipById.get(word.clipId);
      if (!sourceClip) throw new Error(`Audio bank is missing ${word.clipId}.`);
      const decoded = decodedById.get(word.clipId);
      if (!decoded) throw new Error(`Could not decode ${word.clipId}.`);
      const wordParts = [
        ...(word.prefixClipIds ?? []).map((id) => {
          const prefix = decodedById.get(id);
          if (!prefix) throw new Error(`Could not decode prefix ${id}.`);
          return prefix;
        }),
        decoded,
        ...(word.suffixClipIds ?? []).map((id) => {
          const suffix = decodedById.get(id);
          if (!suffix) throw new Error(`Could not decode suffix ${id}.`);
          return suffix;
        }),
      ];
      const sourceLength = wordParts.reduce((sum, samples) => sum + samples.length, 0);
      if (sourceLength > OUTPUT_SAMPLE_RATE * 120) throw new Error(`Audio clip ${word.display} exceeds rendering limits.`);
      let source: Float32Array;
      if (word.phonemeUnits?.length) {
        if (word.phonemeUnits.length > 128) throw new Error(`Phoneme sequence for ${word.display} exceeds rendering limits.`);
        const estimatedSamples = word.phonemeUnits.reduce((sum, unit) => {
          const factor = unit.stretchFactor ? Math.min(2, unit.stretchFactor) : 1;
          return sum + Math.ceil((unit.endSeconds - unit.startSeconds) * OUTPUT_SAMPLE_RATE * factor);
        }, 0);
        if (estimatedSamples > OUTPUT_SAMPLE_RATE * 120) throw new Error(`Phoneme sequence for ${word.display} exceeds the 120-second limit.`);
        const segments = word.phonemeUnits.map((unit) => {
          const clip = clipById.get(unit.clipId);
          const clipSamples = decodedById.get(unit.clipId);
          if (!clip || !clipSamples || clip.kind !== 'word' || clip.sha256?.toLowerCase() !== unit.sourceSha256.toLowerCase() ||
              !Number.isFinite(unit.startSeconds) || !Number.isFinite(unit.endSeconds) ||
              unit.startSeconds < 0 || unit.endSeconds - unit.startSeconds < 0.02 ||
              unit.endSeconds > unit.sourceDurationSeconds || Math.abs(unit.sourceDurationSeconds - clip.duration) > 0.02 ||
              Math.abs(unit.sourceDurationSeconds - clipSamples.length / OUTPUT_SAMPLE_RATE) > 0.03) {
            throw new Error(`Phoneme source window for ${unit.ipa} failed validation.`);
          }
          const start = Math.floor(unit.startSeconds * OUTPUT_SAMPLE_RATE);
          const end = Math.ceil(unit.endSeconds * OUTPUT_SAMPLE_RATE);
          if (end > clipSamples.length || end <= start) throw new Error(`Phoneme source window for ${unit.ipa} is outside its clip.`);
          const samples = clipSamples.subarray(start, end);
          return unit.stretchFactor ? stretchVowelLoop(samples, OUTPUT_SAMPLE_RATE, unit.stretchFactor) : samples;
        });
        if (segments.reduce((sum, segment) => sum + segment.length, 0) > OUTPUT_SAMPLE_RATE * 120) {
          throw new Error(`Phoneme sequence for ${word.display} exceeds the 120-second limit.`);
        }
        source = splicePhonemeWindows(segments, OUTPUT_SAMPLE_RATE);
      } else {
        source = wordParts.length === 1 ? decoded : new Float32Array(sourceLength);
        if (wordParts.length > 1) {
          let offset = 0;
          for (const part of wordParts) {
            source.set(part, offset);
            offset += part.length;
          }
        }
      }
      const samples = transformWord(source, OUTPUT_SAMPLE_RATE, word, data.options.pitch, data.options.volume);
      if (word.startAt !== undefined && word.startAt >= source.length / OUTPUT_SAMPLE_RATE) {
        warnings.push(`Start time skipped all of “${word.display}”.`);
      }
      const previousPlan = index > 0 ? plan[index - 1] : undefined;
      const previousClip = previousPlan?.clipId ? clipById.get(previousPlan.clipId) : undefined;
      const previousKind = previousPlan?.pauseDuration !== undefined ? 'pause' : previousClip?.kind;
      const start = Math.max(0, word.joinPrevious
        ? previousEnd
        : word.spacing !== undefined
        ? previousStart + word.spacing + (word.sleep ?? 0)
        : nextClipStart(previousEnd, previousKind, sourceClip.kind, data.options.gap, word.sleep ?? 0));
      const frameStart = Math.floor(start * OUTPUT_SAMPLE_RATE);
      const actualStart = frameStart / OUTPUT_SAMPLE_RATE;
      const actualEnd = actualStart + samples.length / OUTPUT_SAMPLE_RATE;
      for (const scope of word.stutterScopes ?? []) if (!stutterGroups.has(scope.id)) stutterGroups.set(scope.id, { start: actualStart, end: actualStart, repeats: scope.repeats });
      if (actualStart > previousEnd && word.gapSourceStart !== undefined && word.gapSourceEnd !== undefined) {
        appendTimelineEntry(timeline, { startSeconds: previousEnd, endSeconds: actualStart, sourceStart: word.gapSourceStart, sourceEnd: word.gapSourceEnd, kind: 'gap' });
      }
      if (word.sourceWordTimings?.length && !word.phonemeUnits?.length) {
        const sourceDuration = decoded.length / OUTPUT_SAMPLE_RATE;
        const spans: Array<{ startSample: number; endSample: number; sourceStart: number; sourceEnd: number; kind: 'word' | 'gap' }> = [];
        const validTimings = word.sourceWordTimings.filter((timing) => Number.isFinite(timing.startSeconds) && Number.isFinite(timing.endSeconds) &&
          timing.startSeconds >= 0 && timing.endSeconds > timing.startSeconds && timing.endSeconds <= sourceDuration + 0.001)
          .sort((left, right) => left.startSeconds - right.startSeconds);
        for (let wordIndex = 0; wordIndex < validTimings.length; wordIndex += 1) {
          const timing = validTimings[wordIndex];
          const startSample = Math.max(0, Math.floor(timing.startSeconds * OUTPUT_SAMPLE_RATE));
          const endSample = Math.min(decoded.length, Math.ceil(timing.endSeconds * OUTPUT_SAMPLE_RATE));
          if (endSample <= startSample) continue;
          spans.push({ startSample, endSample, sourceStart: timing.sourceStart, sourceEnd: timing.sourceEnd, kind: 'word' });
          const next = validTimings[wordIndex + 1];
          const sourceStart = timing.sourceEnd;
          const sourceEnd = next?.sourceStart ?? sourceStart;
          const gapStart = Math.min(decoded.length, Math.ceil(timing.endSeconds * OUTPUT_SAMPLE_RATE));
          const gapEnd = next ? Math.max(0, Math.floor(next.startSeconds * OUTPUT_SAMPLE_RATE)) : gapStart;
          if (next && next.startSeconds > timing.endSeconds && sourceEnd > sourceStart && gapEnd > gapStart) {
            spans.push({ startSample: gapStart, endSample: gapEnd, sourceStart, sourceEnd, kind: 'gap' });
          }
        }
        for (const entry of mapSourceTimeline(spans, decoded.length, word, data.options.pitch, OUTPUT_SAMPLE_RATE, actualStart, samples.length)) appendTimelineEntry(timeline, entry);
      } else {
        appendTimelineEntry(timeline, { startSeconds: actualStart, endSeconds: actualEnd, sourceStart: word.sourceStart ?? 0, sourceEnd: word.sourceEnd ?? 0, kind: word.timelineKind ?? (sourceClip.kind === 'effect' ? 'cue' : 'word') });
      }
      if (samples.length && frameStart + samples.length > 0) {
        audioSampleCount += samples.length;
        if (audioSampleCount > maxLayerSamples) throw new Error('Audio content exceeds the five-minute processing limit.');
        layers.push({ samples, start: frameStart });
      }
      previousEnd = start + samples.length / OUTPUT_SAMPLE_RATE;
      previousStart = start;
      timelineEnd = Math.max(timelineEnd, previousEnd);
      for (const scope of word.stutterScopes ?? []) {
        const group = stutterGroups.get(scope.id);
        if (group) group.end = Math.max(group.end, previousEnd);
      }
      finishStutterScopes(word);
      if (timelineEnd > 120) throw new Error('Rendered audio exceeds the 120-second limit.');
      scope.postMessage({ type: 'progress', value: 0.6 + 0.35 * (index + 1) / plan.length });
    }

    if (!audioSampleCount) throw new Error('No audio could be rendered from the selected clips.');
    const samples = mixLayers(layers);
    const result = {
      type: 'done' as const,
      samples,
      sampleRate: OUTPUT_SAMPLE_RATE,
      duration: samples.length / OUTPUT_SAMPLE_RATE,
      words: plan.map((word) => word.display),
      warnings,
      timeline: clipTimelineToDuration(timeline, samples.length / OUTPUT_SAMPLE_RATE)
        .sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds),
    };
    scope.postMessage(result, [samples.buffer]);
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Audio rendering failed.' });
  } finally {
    decoder?.free();
  }
};
