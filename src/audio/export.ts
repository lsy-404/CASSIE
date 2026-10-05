import { FFmpeg } from '@ffmpeg/ffmpeg';
import { encodeWav } from './engine';

type CoreManifest = {
  bytes: number;
  compression: 'gzip';
  compressedBytes: number;
  sha256: string;
  parts: { file: string; bytes: number; sha256: string }[];
};

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(hash, (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function encodeOpus(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (value: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  const ffmpeg = new FFmpeg();
  let wasmURL: string | undefined;
  const abort = () => ffmpeg.terminate();
  signal?.addEventListener('abort', abort, { once: true });
  const progress = (value: number) => onProgress?.(Math.min(1, Math.max(0, value)));
  try {
    progress(0);
    const response = await fetch('/ffmpeg/manifest.json', { signal });
    if (!response.ok) throw new Error('Could not load the Opus encoder. Please retry.');
    const manifest = await response.json() as CoreManifest;
    if (!Number.isInteger(manifest.bytes) || manifest.bytes <= 0 || manifest.bytes > 64 * 1024 * 1024
      || manifest.compression !== 'gzip' || !Number.isInteger(manifest.compressedBytes)
      || manifest.compressedBytes < 1 || manifest.compressedBytes > 24 * 1024 * 1024
      || !Array.isArray(manifest.parts) || manifest.parts.length < 1 || manifest.parts.length > 8) {
      throw new Error('Invalid Opus encoder manifest.');
    }
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    for (const [index, part] of manifest.parts.entries()) {
      if (!/^ffmpeg-core\.wasm\.gz\.\d{2}$/.test(part.file)) throw new Error('Invalid encoder chunk path.');
      const chunkResponse = await fetch(`/ffmpeg/${part.file}`, { signal });
      if (!chunkResponse.ok) throw new Error('Could not load an Opus encoder chunk. Please retry.');
      const chunk = new Uint8Array(await chunkResponse.arrayBuffer());
      if (chunk.byteLength !== part.bytes || await sha256(chunk) !== part.sha256) {
        throw new Error('Opus encoder integrity check failed. Please reload.');
      }
      parts.push(chunk);
      bytes += chunk.byteLength;
      progress(0.4 * (index + 1) / manifest.parts.length);
    }
    if (bytes !== manifest.compressedBytes) throw new Error('Incomplete Opus encoder.');
    const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream('gzip'));
    const wasm = new Uint8Array(await new Response(stream).arrayBuffer());
    if (wasm.byteLength !== manifest.bytes) throw new Error('Invalid decompressed Opus encoder.');
    if (await sha256(wasm) !== manifest.sha256) throw new Error('Opus encoder integrity check failed.');
    signal?.throwIfAborted();
    wasmURL = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
    await ffmpeg.load({ coreURL: '/ffmpeg/ffmpeg-core.js', wasmURL }, { signal });
    progress(0.5);
    ffmpeg.on('progress', ({ progress: value }) => progress(0.5 + value * 0.49));
    await ffmpeg.writeFile('announcement.wav', new Uint8Array(await encodeWav(samples, sampleRate).arrayBuffer()), { signal });
    const code = await ffmpeg.exec([
      '-i', 'announcement.wav', '-ac', '1', '-c:a', 'libopus', '-b:a', '64k',
      '-application', 'audio', '-y', 'announcement.opus',
    ], 120_000, { signal });
    if (code !== 0) throw new Error('Opus encoding failed or timed out. Try a shorter announcement.');
    const output = await ffmpeg.readFile('announcement.opus', undefined, { signal });
    if (typeof output === 'string') throw new Error('Opus encoder returned invalid audio.');
    const copy = new Uint8Array(output.length);
    copy.set(output);
    progress(1);
    return new Blob([copy], { type: 'audio/ogg' });
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Opus export cancelled.', 'AbortError');
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    ffmpeg.terminate();
    if (wasmURL) URL.revokeObjectURL(wasmURL);
  }
}
