import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('audio license', () => {
  it('ships a notice naming CC BY-SA 3.0 and the changes', () => {
    const notice = read('public/audio/LICENSE.txt');
    expect(notice).toContain('CC BY-SA 3.0');
    expect(notice).toContain('Northwood Studios');
    expect(notice).toMatch(/Changes made/);
  });

  it('serves the legal code identical to the repository copy', () => {
    expect(existsSync(new URL('../public/licenses/CC-BY-SA-3.0.txt', import.meta.url))).toBe(true);
    expect(read('public/licenses/CC-BY-SA-3.0.txt')).toBe(read('data/licenses/CC-BY-SA-3.0.txt'));
  });

  it('keeps the audio notice and license texts in public', () => {
    expect(existsSync(new URL('../public/audio/LICENSE.txt', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../public/licenses/AGPL-3.0.txt', import.meta.url))).toBe(true);
  });
});

describe('README deployment', () => {
  const readme = read('README.md');
  const deployment = readme.indexOf('## Deployment');
  it('comes before the interface and syntax sections', () => {
    expect(deployment).toBeGreaterThan(0);
    expect(deployment).toBeLessThan(readme.indexOf('## Interface'));
    expect(deployment).toBeLessThan(readme.indexOf('## Announcement syntax'));
  });
  it('lists Overture first', () => {
    const section = readme.slice(deployment, readme.indexOf('## Interface'));
    expect(section.indexOf('Overture')).toBeGreaterThan(-1);
    expect(section.indexOf('Overture')).toBeLessThan(section.indexOf('Manual'));
  });
});
