export type ClipKind = 'word' | 'effect';

export interface BankClip {
  id: string;
  file: string;
  duration: number;
  kind: ClipKind;
  sha256?: string;
}

export interface Bank {
  version: string;
  source: string;
  clips: BankClip[];
  manifestSha256?: string;
}

export interface RenderOptions {
  pitch: number;
  volume: number;
  gap: number;
  rate?: number;
  phonemes?: boolean;
  voice?: VoiceOptions;
}

export interface VoiceOptions {
  pitchSemitones: number;
  breathiness: number;
  formantSemitones: number;
  loudnessDb: number;
  tension: number;
}

export interface RenderResult {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
  words: string[];
  warnings: string[];
  timeline: TimelineEntry[];
}

export interface TimelineEntry {
  startSeconds: number;
  endSeconds: number;
  sourceStart: number;
  sourceEnd: number;
  kind: 'word' | 'gap' | 'cue';
}

export interface AnalysisToken {
  sourceStart: number;
  sourceEnd: number;
  kind: 'recorded' | 'synthesized' | 'error' | 'marker';
  text: string;
  spellingWord?: string;
}

export interface WordPlan {
  clipId: string;
  prefixClipIds?: string[];
  suffixClipIds?: string[];
  display: string;
  pitch: number;
  volume: number;
  rate?: number;
  voice?: Partial<VoiceOptions>;
  startAt?: number;
  maxDuration?: number;
  sleep?: number;
  spacing?: number;
  stutter?: { position: number; length: number; repeats: number };
  phonemeUnits?: PhonemeUnit[];
  pauseDuration?: number;
  sourceStart?: number;
  sourceEnd?: number;
  gapSourceStart?: number;
  gapSourceEnd?: number;
  timelineKind?: 'word' | 'gap' | 'cue';
  sourceWordTimings?: Array<{ text: string; startSeconds: number; endSeconds: number; sourceStart: number; sourceEnd: number }>;
  joinPrevious?: boolean;
  stutterScopes?: Array<{ id: number; repeats: number }>;
  stutterScopeEnds?: number[];
}

export interface PhonemeUnit {
  clipId: string;
  startSeconds: number;
  endSeconds: number;
  ipa: string;
  sourceDurationSeconds: number;
  sourceSha256: string;
  stretchFactor?: number;
  approximate?: boolean;
}
