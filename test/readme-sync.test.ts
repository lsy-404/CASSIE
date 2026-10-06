import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeText, createWordPlan } from '../src/audio/parser';
import type { Bank } from '../src/audio/types';

const bank = JSON.parse(readFileSync(new URL('../public/bank.json', import.meta.url), 'utf8')) as Bank;
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const section = readme.slice(readme.indexOf('Examples of `<sync>`:'), readme.indexOf('Inside `<fit>`'));
const examples = [...section.matchAll(/^- [^:]+: `([^`]+)`/gm)].map((match) => match[1]);

describe('README sync examples', () => {
  it('lists harmony, echo and call-and-response', () => {
    expect(examples).toHaveLength(3);
  });

  it.each(examples)('parses without errors: %s', (text) => {
    const result = createWordPlan(text, bank);
    const analysis = analyzeText(text, bank);
    expect([...result.notices, ...analysis.notices]).toEqual([]);
    expect(analysis.tokens.filter((token) => token.kind === 'error')).toEqual([]);
    expect(result.unresolvedWords).toEqual([]);
    expect(new Set(result.plan.map((item) => item.track ?? 0)).size).toBeGreaterThan(1);
  });
});
