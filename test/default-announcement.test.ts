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

  it('pins the unrecorded words that must be synthesised', () => {
    expect([...result.unresolvedWords].sort()).toEqual(['become', 'class-d']);
  });

  it('showcases the editor tags with exactly one fit tag', () => {
    for (const tag of ['<start>', '<end>', '<pause', '<stutter', '<pitch', '<volume', '<rate', '<voice', '<fit seconds=']) {
      expect(defaultAnnouncement).toContain(tag);
    }
    expect(defaultAnnouncement.match(/<fit\b/g)).toHaveLength(1);
  });

  it('is an original Foundation recruitment ad', () => {
    expect(defaultAnnouncement).toContain('Become Class-D.');
    const lower = defaultAnnouncement.toLowerCase();
    for (const banned of ['democracy', 'helldiver', 'super earth', 'look familiar', 'elite force', 'become a hero', 'become the legend', 'could be next', 'decision of your life']) {
      expect(lower).not.toContain(banned);
    }
  });
});
