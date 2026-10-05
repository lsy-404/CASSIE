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
  background: boolean;
  phonemes?: boolean;
}

export interface RenderResult {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
  words: string[];
  warnings: string[];
}

export interface WordPlan {
  clipId: string;
  prefixClipIds?: string[];
  suffixClipIds?: string[];
  display: string;
  pitch: number;
  volume: number;
  startAt?: number;
  maxDuration?: number;
  sleep?: number;
  spacing?: number;
  stutter?: { position: number; length: number; repeats: number };
  phonemeUnits?: PhonemeUnit[];
}

export interface PhonemeUnit {
  clipId: string;
  startSeconds: number;
  endSeconds: number;
  ipa: string;
  sourceDurationSeconds: number;
  sourceSha256: string;
  stretchFactor?: number;
}
