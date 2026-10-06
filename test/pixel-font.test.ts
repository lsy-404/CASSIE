import { describe, expect, it } from 'vitest';
import { textPath } from '../src/startup/pixel-font';

describe('pixel font', () => {
  it('draws prerelease version text and tolerates unknown characters', () => {
    expect(() => textPath('V1.0.0-RC.1')).not.toThrow();
    expect(() => textPath('V1~')).not.toThrow();
  });
});
