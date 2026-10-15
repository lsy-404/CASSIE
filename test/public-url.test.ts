import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { publicUrl } from '../src/public-url';

describe('public asset paths', () => {
  it('resolves root-style paths under the configured application base', () => {
    expect(publicUrl('/bank.json', '/projects/cassie/')).toBe('/projects/cassie/bank.json');
    expect(publicUrl('/audio/cassie.opus', '/projects/cassie/')).toBe('/projects/cassie/audio/cassie.opus');
    expect(publicUrl('/ffmpeg/manifest.json', '/projects/cassie/')).toBe('/projects/cassie/ffmpeg/manifest.json');
    expect(publicUrl('/projects/cassie/audio/cassie.opus', '/projects/cassie/')).toBe('/projects/cassie/audio/cassie.opus');
  });

  it('keeps the public bank manifest clip paths rooted at audio', async () => {
    const manifest = await readFile(new URL('../public/bank.json', import.meta.url), 'utf8');
    expect(JSON.parse(manifest).clips[0].file).toMatch(/^\/audio\//);
  });
});
