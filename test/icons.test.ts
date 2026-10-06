import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url));

describe('site icons', () => {
  it('apple touch icon is a 180x180 PNG', () => {
    const png = read('apple-touch-icon.png');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(180);
    expect(png.readUInt32BE(20)).toBe(180);
  });

  it('favicon.ico has a valid header with 16, 32 and 48 px PNG frames', () => {
    const ico = read('favicon.ico');
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3]);
    const sizes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const entry = 6 + i * 16;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      expect(ico.subarray(offset + 1, offset + 4).toString()).toBe('PNG');
      expect(ico.readUInt32BE(offset + 16)).toBe(ico[entry]);
      sizes.push(ico[entry]);
    }
    expect(sizes).toEqual([16, 32, 48]);
  });
});
