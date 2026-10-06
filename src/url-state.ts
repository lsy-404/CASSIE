export type AppLocale = 'zh' | 'en';
export type ExportFormat = 'wav' | 'opus';

export interface VoiceUrlOptions {
  pitchSemitones: number;
  breathiness: number;
  formantSemitones: number;
  loudnessDb: number;
  tension: number;
}

export interface RenderUrlOptions {
  pitch: number;
  volume: number;
  gap: number;
  rate: number;
  phonemes: boolean;
  voice: VoiceUrlOptions;
}

export interface ShareUrlInput {
  text: string;
  options?: Partial<Omit<RenderUrlOptions, 'voice'>> & { voice?: Partial<VoiceUrlOptions> };
  locale?: AppLocale;
  export?: ExportFormat;
}

export interface DecodedUrlState {
  text: string;
  options: RenderUrlOptions;
  locale?: AppLocale;
  export?: ExportFormat;
}

const MAX_DATA_BYTES = 64 * 1024;
const MAX_TEXT_BYTES = 16 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_DATA_BYTES / 3) * 4;

const DEFAULT_OPTIONS: RenderUrlOptions = {
  pitch: 1,
  volume: 1,
  gap: 0.24,
  rate: 1,
  phonemes: true,
  voice: {
    pitchSemitones: 0,
    breathiness: 0,
    formantSemitones: 0,
    loudnessDb: 0,
    tension: 0,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Unknown ${name} field: ${key}`);
  }
}

function boundedNumber(value: unknown, fallback: number, key: string, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${key} value.`);
  }
  return value;
}

function booleanOption(value: unknown, fallback: boolean, key: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${key} value.`);
  return value;
}

function normalizeOptions(value: unknown): RenderUrlOptions {
  if (value === undefined) return structuredClone(DEFAULT_OPTIONS);
  if (!isRecord(value)) throw new Error('Invalid options object.');
  rejectUnknownKeys(value, ['pitch', 'volume', 'gap', 'rate', 'phonemes', 'voice'], 'options');
  const voiceValue = value.voice;
  let voice = structuredClone(DEFAULT_OPTIONS.voice);
  if (voiceValue !== undefined) {
    if (!isRecord(voiceValue)) throw new Error('Invalid voice options object.');
    rejectUnknownKeys(voiceValue, ['pitchSemitones', 'breathiness', 'formantSemitones', 'loudnessDb', 'tension'], 'voice');
    voice = {
      pitchSemitones: boundedNumber(voiceValue.pitchSemitones, voice.pitchSemitones, 'voice.pitchSemitones', -12, 12),
      breathiness: boundedNumber(voiceValue.breathiness, voice.breathiness, 'voice.breathiness', 0, 1),
      formantSemitones: boundedNumber(voiceValue.formantSemitones, voice.formantSemitones, 'voice.formantSemitones', -6, 6),
      loudnessDb: boundedNumber(voiceValue.loudnessDb, voice.loudnessDb, 'voice.loudnessDb', -24, 12),
      tension: boundedNumber(voiceValue.tension, voice.tension, 'voice.tension', -1, 1),
    };
  }
  return {
    pitch: boundedNumber(value.pitch, DEFAULT_OPTIONS.pitch, 'pitch', 0.65, 1.35),
    volume: boundedNumber(value.volume, DEFAULT_OPTIONS.volume, 'volume', 0, 1),
    gap: boundedNumber(value.gap, DEFAULT_OPTIONS.gap, 'gap', 0, 0.8),
    rate: boundedNumber(value.rate, DEFAULT_OPTIONS.rate, 'rate', 0.5, 2),
    phonemes: booleanOption(value.phonemes, DEFAULT_OPTIONS.phonemes, 'phonemes'),
    voice,
  };
}

function validateText(text: unknown): asserts text is string {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Announcement text is required.');
  if (new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) throw new Error('Announcement text exceeds 16 KiB.');
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64(value: string): Uint8Array {
  if (value.length > MAX_BASE64_CHARS || !/^[A-Za-z0-9+/_-]*={0,2}$/u.test(value)) {
    throw new Error('Invalid or oversized base64 data.');
  }
  const paddingIndex = value.indexOf('=');
  const body = paddingIndex < 0 ? value : value.slice(0, paddingIndex);
  const suppliedPadding = value.length - body.length;
  const expectedPadding = (4 - body.length % 4) % 4;
  if (body.length % 4 === 1 || (suppliedPadding > 0 && (value.length % 4 !== 0 || suppliedPadding !== expectedPadding))) {
    throw new Error('Invalid base64 length.');
  }
  const standard = body.replaceAll('-', '+').replaceAll('_', '/');
  const padded = standard + '='.repeat((4 - standard.length % 4) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('Invalid base64 data.');
  }
  if (binary.length > MAX_DATA_BYTES) throw new Error('URL data exceeds 64 KiB.');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeUrlState(input: ShareUrlInput): string {
  validateText(input.text);
  if (input.locale !== undefined && input.locale !== 'zh' && input.locale !== 'en') throw new Error('Invalid locale.');
  if (input.export !== undefined && input.export !== 'wav' && input.export !== 'opus') throw new Error('Invalid export format.');
  const payload = {
    text: input.text,
    options: normalizeOptions(input.options),
    ...(input.locale ? { locale: input.locale } : {}),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (bytes.byteLength > MAX_DATA_BYTES) throw new Error('URL data exceeds 64 KiB.');
  const query = new URLSearchParams({ data: encodeBase64Url(bytes) });
  if (input.export) query.set('export', input.export);
  return `?${query.toString()}`;
}

export function decodeUrlState(search: string): DecodedUrlState | null {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (!query.size) return null;
  for (const key of query.keys()) {
    if (key !== 'data' && key !== 'export') throw new Error(`Unknown URL parameter: ${key}`);
  }
  const dataValues = query.getAll('data');
  const exportValues = query.getAll('export');
  if (dataValues.length > 1 || exportValues.length > 1) throw new Error('Duplicate URL parameters are not allowed.');
  const encoded = dataValues[0];
  const exportFormat = exportValues[0];
  if (encoded === undefined) {
    if (exportFormat !== undefined) throw new Error('An export format requires announcement data.');
    return null;
  }
  if (exportFormat !== undefined && exportFormat !== 'wav' && exportFormat !== 'opus') throw new Error('Invalid export format.');

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(encoded)));
  } catch (error) {
    if (error instanceof Error && /base64|64 KiB/u.test(error.message)) throw error;
    throw new Error('URL data must contain valid UTF-8 JSON.');
  }
  if (!isRecord(payload)) throw new Error('URL data must be a JSON object.');
  rejectUnknownKeys(payload, ['text', 'options', 'locale'], 'payload');
  validateText(payload.text);
  if (payload.locale !== undefined && payload.locale !== 'zh' && payload.locale !== 'en') throw new Error('Invalid locale.');
  return {
    text: payload.text,
    options: normalizeOptions(payload.options),
    ...(payload.locale ? { locale: payload.locale } : {}),
    ...(exportFormat ? { export: exportFormat } : {}),
  };
}
