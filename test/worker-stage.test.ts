import { describe, expect, it } from 'vitest';
import { withStage } from '../src/startup/worker-stage';

describe('withStage', () => {
  it('names the last reported stage', () => {
    expect(withStage('boom', 'running engine')).toBe('boom (last stage: running engine)');
  });

  it('reports a worker that never spoke as never started', () => {
    expect(withStage('boom')).toBe('boom (last stage: never started)');
  });
});
