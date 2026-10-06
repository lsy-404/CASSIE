import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeText, createWordPlan } from '../src/audio/parser';
import type { Bank } from '../src/audio/types';
import { defaultAnnouncement } from '../src/defaultAnnouncement';

const bank = JSON.parse(readFileSync(new URL('../public/bank.json', import.meta.url), 'utf8')) as Bank;

describe('default announcement', () => {
  const result = createWordPlan(defaultAnnouncement, bank);
  const analysis = analyzeText(defaultAnnouncement, bank);

  it('parses against the real voice bank with no markup errors', () => {
    const markupNotices = [...result.notices, ...analysis.notices].filter((notice) => !notice.text.startsWith('No audio clip for') && !notice.text.startsWith('No verified letter-name'));
    expect(markupNotices).toEqual([]);
    expect(analysis.tokens.filter((token) => token.kind === 'error' && !/^[A-Za-z-]+$/.test(token.text))).toEqual([]);
    expect(result.plan.length).toBeGreaterThan(60);
  });

  it('keeps unrecorded words to a minimum', () => {
    expect(result.unresolvedWords.length).toBeLessThanOrEqual(12);
    expect(result.unresolvedWords.sort()).toEqual(['elite', 'familiar', 'happening', 'hero', 'legend', 'letter:D', 'part', 'prove', 'scenes', 'skill', 'unless', 'become'].sort());
    expect(result.unresolvedWords).not.toContain('class-d');
  });

  it('showcases the editor tags with exactly one fit tag', () => {
    for (const tag of ['<start>', '<end>', '<pause', '<stutter', '<pitch', '<volume', '<rate', '<voice', '<fit seconds=']) {
      expect(defaultAnnouncement).toContain(tag);
    }
    expect(defaultAnnouncement.match(/<fit\b/g)).toHaveLength(1);
  });

  it('is a Foundation recruitment ad', () => {
    expect(defaultAnnouncement).toContain('Become Class D.');
    expect(defaultAnnouncement.toLowerCase()).not.toContain('democracy');
  });
});
