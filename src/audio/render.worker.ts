import { OggOpusDecoder } from 'ogg-opus-decoder';
import { appendTimelineEntry, clipTimelineToDuration, mapSourceTimeline, mixLayers, monoFromChannels, nextClipStart, OUTPUT_SAMPLE_RATE, splicePhonemeWindows, stretchSpeechPreservingGaps, stretchSpeechRate, stretchVowelLoop, transformWord } from './dsp';
import { applyVoiceLoudness, blendVoiceEdges, editWorldFeatures, hasWorldVoiceEffects, isNeutralVoice, processVoicePreservingGaps } from './voice-dsp';
import { fitGroupsOf, fitItemOf, fitOwnersOf, fitWarning, solveFitRates } from './fit';
import type { FitItem } from './fit';
import { createWorldVocoder } from './world';
import { checkAudioCapability } from '../startup/check-audio';
import type { WorldVocoder } from './world';
import type { Bank, BankClip, ClipKind, RenderOptions, TimelineEntry, VoiceOptions, WordPlan } from './types';
import type { TimelineSpan } from './dsp';

type RequestMessage =
  | { type: 'check'; samples: Float32Array }
  | { type: 'render'; bank: Bank; plan: WordPlan[]; options: RenderOptions };
type ResponseMessage =
  | { type: 'ready'; proof: Float32Array }
  | { type: 'progress'; value: number }
  | { type: 'preview'; samples: Float32Array; sampleRate: number; duration: number; words: string[]; warnings: string[]; timeline: TimelineEntry[] }
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
  if (data.type === 'check') {
    try {
      const proof = await checkAudioCapability(data.samples);
      scope.postMessage({ type: 'ready', proof }, [proof.buffer]);
    } catch (error) {
      scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Required audio processing is unavailable.' });
    }
    return;
  }
  let decoder: OggOpusDecoder | undefined;
  let world: WorldVocoder | undefined;
  try {
    const activeDecoder = new OggOpusDecoder();
    decoder = activeDecoder;
    await activeDecoder.ready;
    const clipById = new Map(data.bank.clips.map((clip) => [clip.id, clip]));
    const plan = data.plan;
    const uniqueIds = [...new Set(plan.flatMap((word) => [...(word.prefixClipIds ?? []), ...(word.clipId ? [word.clipId] : []), ...(word.suffixClipIds ?? []), ...(word.phonemeUnits ?? []).map((unit) => unit.clipId)]))];
    const decodedById = new Map<string, Float32Array>();
    const warnings: string[] = [];
    let decodedCount = 0;
    let completedCount = 0;
    let lastProgress = 0;
    const reportProgress = () => {
      const decodeProgress = 0.6 * decodedCount / Math.max(1, uniqueIds.length);
      const renderProgress = 0.35 * completedCount / Math.max(1, plan.length);
      lastProgress = Math.max(lastProgress, Math.min(0.95, decodeProgress + renderProgress));
      scope.postMessage({ type: 'progress', value: lastProgress });
    };
    const getDecoded = async (id: string) => {
      const cached = decodedById.get(id);
      if (cached) return cached;
      const clip = clipById.get(id);
      if (!clip) throw new Error(`Audio bank is missing ${id}.`);
      const decoded = await fetchClip(clip, activeDecoder);
      await activeDecoder.reset();
      decodedById.set(id, decoded);
      decodedCount += 1;
      reportProgress();
      return decoded;
    };
    const processVoice = async (samples: Float32Array, voice: VoiceOptions): Promise<Float32Array> => {
      if (!samples.length) return samples;
      if (!hasWorldVoiceEffects(voice)) return applyVoiceLoudness(samples, voice.loudnessDb ?? 0);
      if (samples.length > OUTPUT_SAMPLE_RATE * 20) throw new Error('WORLD voice processing supports speech blocks up to 20 seconds.');
      let peak = 0;
      for (const sample of samples) {
        if (!Number.isFinite(sample)) throw new Error('Voice input contains non-finite audio.');
        peak = Math.max(peak, Math.abs(sample));
      }
      if (peak === 0) return samples.slice();
      const normalizedGain = 0.8 / peak;
      const paddedLength = Math.max(samples.length, Math.ceil(OUTPUT_SAMPLE_RATE * 0.03));
      const padding = Math.floor((paddedLength - samples.length) / 2);
      const normalized = new Float32Array(paddedLength);
      for (let index = 0; index < samples.length; index += 1) normalized[padding + index] = samples[index] * normalizedGain;
      world ??= await createWorldVocoder();
      let features;
      try {
        features = world.analyze(normalized, OUTPUT_SAMPLE_RATE);
        const edited = editWorldFeatures(features, voice);
        features.f0.set(edited.f0);
        features.spectral.set(edited.spectral);
        features.aperiodicity.set(edited.aperiodicity);
        const synthesized = world.synthesize(features);
        if (synthesized.length !== paddedLength) throw new Error('WORLD changed the speech block duration.');
        const restored = new Float32Array(samples.length);
        for (let index = 0; index < restored.length; index += 1) restored[index] = synthesized[padding + index] / normalizedGain;
        return applyVoiceLoudness(blendVoiceEdges(samples, restored, OUTPUT_SAMPLE_RATE), voice.loudnessDb ?? 0);
      } finally {
        if (features) world.dispose(features);
      }
    };

    const prepareWord = async (word: WordPlan) => {
      for (const id of [...(word.prefixClipIds ?? []), word.clipId, ...(word.suffixClipIds ?? []), ...(word.phonemeUnits ?? []).map((unit) => unit.clipId)]) {
        if (id && !decodedById.has(id)) await getDecoded(id);
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
      const pitched = transformWord(source, OUTPUT_SAMPLE_RATE, word, data.options.pitch, data.options.volume);
      let phraseTimeline: TimelineSpan[] | undefined;
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
        phraseTimeline = mapSourceTimeline(spans, decoded.length, { ...word, rate: 1 }, data.options.pitch, OUTPUT_SAMPLE_RATE, 0, pitched.length);
      }
      return { sourceClip, decoded, source, pitched, phraseTimeline };
    };
    const layers: Array<{ samples: Float32Array; start: number; gain?: number; track: number }> = [];
    let audioSampleCount = 0;
    const maxLayerSamples = OUTPUT_SAMPLE_RATE * 300;
    interface TrackCursor { start: number; end: number; kind?: ClipKind | 'pause'; started: boolean }
    const cursors = new Map<number, TrackCursor>([[0, { start: 0, end: 0, started: true }]]);
    const parentTracks = new Map(plan.flatMap((word) => word.track ? [[word.track, word.parentTrack ?? 0] as const] : []));
    const cursorOf = (track: number): TrackCursor => {
      let cursor = cursors.get(track);
      if (!cursor) {
        cursor = { ...cursorOf(parentTracks.get(track) ?? 0), started: false };
        cursors.set(track, cursor);
      }
      return cursor;
    };
    let timelineEnd = 0;
    const timeline: TimelineEntry[] = [];
    const addEntry = (word: WordPlan, entry: TimelineSpan) => appendTimelineEntry(timeline, {
      ...entry,
      track: word.track ?? 0,
      ...(entry.kind === 'word' ? { provenance: word.phonemeUnits?.length ? 'synthesized' as const : 'recorded' as const } : {}),
    });
    let previewCount = 0;
    let lastPreviewAt = 0;
    const publishPreview = (completedIndex: number) => {
      const now = performance.now();
      if (previewCount >= 32 || (previewCount > 0 && now - lastPreviewAt < 100)) return;
      const samples = mixLayers(layers);
      if (!samples.length) return;
      const duration = samples.length / OUTPUT_SAMPLE_RATE;
      const snapshot: ResponseMessage = {
        type: 'preview',
        samples,
        sampleRate: OUTPUT_SAMPLE_RATE,
        duration,
        words: plan.slice(0, completedIndex + 1).map((word) => word.display),
        warnings: [...warnings],
        timeline: clipTimelineToDuration(timeline, duration)
          .sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds),
      };
      scope.postMessage(snapshot, [samples.buffer]);
      previewCount += 1;
      lastPreviewAt = now;
    };
    const prepared = new Map<number, Awaited<ReturnType<typeof prepareWord>>>();
    const fitRates = new Map<number, number>();
    const fitGroups = fitGroupsOf(plan);
    if (fitGroups.size) {
      const items: FitItem[] = [];
      for (let index = 0; index < plan.length; index += 1) {
        const word = plan[index];
        const globalRate = data.options.rate ?? 1;
        if (word.pauseDuration !== undefined) {
          items.push(fitItemOf(word, globalRate, { pause: word.pauseDuration }));
          continue;
        }
        const item = await prepareWord(word);
        prepared.set(index, item);
        const gaps = (item.phraseTimeline ?? []).filter((entry) => entry.kind === 'gap').reduce((sum, entry) => sum + entry.endSeconds - entry.startSeconds, 0);
        items.push(fitItemOf(word, globalRate, { kind: item.sourceClip.kind, total: item.pitched.length / OUTPUT_SAMPLE_RATE, gaps }));
      }
      for (const result of solveFitRates(items, fitGroups, data.options.gap, fitOwnersOf(plan))) {
        fitRates.set(result.id, result.rate);
        if (result.clamped) warnings.push(fitWarning(result));
      }
    }
    for (let index = 0; index < plan.length; index += 1) {
      const word = plan[index];
      if (word.pauseDuration !== undefined) {
        if (!Number.isFinite(word.pauseDuration) || word.pauseDuration < 0 || word.pauseDuration > 120) {
          throw new Error('Pause duration exceeds the 120-second limit.');
        }
        const track = word.track ?? 0;
        const cursor = cursorOf(track);
        const start = Math.max(0, word.spacing !== undefined
          ? cursor.start + word.spacing + (word.sleep ?? 0)
          : nextClipStart(cursor.end, cursor.kind, 'pause', data.options.gap, word.sleep ?? 0));
        const samples = new Float32Array(Math.ceil(word.pauseDuration * OUTPUT_SAMPLE_RATE));
        if (cursor.started && start > cursor.end && word.gapSourceStart !== undefined && word.gapSourceEnd !== undefined) {
          addEntry(word, { startSeconds: cursor.end, endSeconds: start, sourceStart: word.gapSourceStart, sourceEnd: word.gapSourceEnd, kind: 'gap' });
        }
        addEntry(word, { startSeconds: start, endSeconds: start + samples.length / OUTPUT_SAMPLE_RATE, sourceStart: word.sourceStart ?? 0, sourceEnd: word.sourceEnd ?? 0, kind: 'gap' });
        if (samples.length) {
          audioSampleCount += samples.length;
          if (audioSampleCount > maxLayerSamples) throw new Error('Audio content exceeds the five-minute processing limit.');
          layers.push({ samples, start: Math.floor(start * OUTPUT_SAMPLE_RATE), track });
        }
        Object.assign(cursor, { end: start + samples.length / OUTPUT_SAMPLE_RATE, start, kind: 'pause', started: true });
        timelineEnd = Math.max(timelineEnd, cursor.end);
        if (samples.length) publishPreview(index);
        if (timelineEnd > 120) throw new Error('Rendered audio exceeds the 120-second limit.');
        completedCount += 1;
        reportProgress();
        continue;
      }
      const { sourceClip, decoded, source, pitched, phraseTimeline: preparedTimeline } = prepared.get(index) ?? await prepareWord(word);
      prepared.delete(index);
      let phraseTimeline = preparedTimeline;
      const rate = fitRates.get(word.fits?.at(-1)?.id ?? 0) ?? (word.rate ?? 1) * (data.options.rate ?? 1);
      const voice: VoiceOptions = {
        pitchSemitones: word.voice?.pitchSemitones ?? data.options.voice?.pitchSemitones ?? 0,
        breathiness: word.voice?.breathiness ?? data.options.voice?.breathiness ?? 0,
        formantSemitones: word.voice?.formantSemitones ?? data.options.voice?.formantSemitones ?? 0,
        loudnessDb: word.voice?.loudnessDb ?? data.options.voice?.loudnessDb ?? 0,
        tension: word.voice?.tension ?? data.options.voice?.tension ?? 0,
      };
      let voiceProcessed = pitched;
      if (sourceClip.kind === 'word' && word.timelineKind !== 'cue' && !isNeutralVoice(voice)) {
        const gaps = phraseTimeline?.filter((entry) => entry.kind === 'gap') ?? [];
        voiceProcessed = await processVoicePreservingGaps(pitched, OUTPUT_SAMPLE_RATE, gaps, (speech) => processVoice(speech, voice));
      }
      let samples = voiceProcessed;
      if (sourceClip.kind === 'word') {
        if (phraseTimeline) {
          const stretched = stretchSpeechPreservingGaps(voiceProcessed, OUTPUT_SAMPLE_RATE, rate, phraseTimeline);
          samples = stretched.samples;
          phraseTimeline = stretched.timeline;
        } else samples = stretchSpeechRate(voiceProcessed, OUTPUT_SAMPLE_RATE, rate);
      }
      if (word.startAt !== undefined && word.startAt >= source.length / OUTPUT_SAMPLE_RATE) {
        warnings.push(`Start time skipped all of “${word.display}”.`);
      }
      const track = word.track ?? 0;
      const cursor = cursorOf(track);
      const start = Math.max(0, word.joinPrevious
        ? cursor.end
        : word.spacing !== undefined
        ? cursor.start + word.spacing + (word.sleep ?? 0)
        : nextClipStart(cursor.end, cursor.kind, sourceClip.kind, data.options.gap, word.sleep ?? 0));
      const frameStart = Math.floor(start * OUTPUT_SAMPLE_RATE);
      const actualStart = frameStart / OUTPUT_SAMPLE_RATE;
      const actualEnd = actualStart + samples.length / OUTPUT_SAMPLE_RATE;
      if (cursor.started && actualStart > cursor.end && word.gapSourceStart !== undefined && word.gapSourceEnd !== undefined) {
        addEntry(word, { startSeconds: cursor.end, endSeconds: actualStart, sourceStart: word.gapSourceStart, sourceEnd: word.gapSourceEnd, kind: 'gap' });
      }
      if (phraseTimeline) {
        for (const entry of phraseTimeline) addEntry(word, { ...entry, startSeconds: entry.startSeconds + actualStart, endSeconds: entry.endSeconds + actualStart });
      } else {
        addEntry(word, { startSeconds: actualStart, endSeconds: actualEnd, sourceStart: word.sourceStart ?? 0, sourceEnd: word.sourceEnd ?? 0, kind: word.timelineKind ?? (sourceClip.kind === 'effect' ? 'cue' : 'word') });
      }
      if (samples.length && frameStart + samples.length > 0) {
        audioSampleCount += samples.length;
        if (audioSampleCount > maxLayerSamples) throw new Error('Audio content exceeds the five-minute processing limit.');
        layers.push({ samples, start: frameStart, track });
      }
      Object.assign(cursor, { end: start + samples.length / OUTPUT_SAMPLE_RATE, start, kind: sourceClip.kind, started: true });
      timelineEnd = Math.max(timelineEnd, cursor.end);
      if (samples.length) publishPreview(index);
      if (timelineEnd > 120) throw new Error('Rendered audio exceeds the 120-second limit.');
      completedCount += 1;
      reportProgress();
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
    world?.dispose();
    decoder?.free();
  }
};
