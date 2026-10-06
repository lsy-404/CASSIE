import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createWordPlan } from '../src/audio/parser';
import type { Bank } from '../src/audio/types';
import { defaultAnnouncement } from '../src/defaultAnnouncement';

const bank = JSON.parse(readFileSync(new URL('../public/bank.json', import.meta.url), 'utf8')) as Bank;

describe('default announcement', () => {
  const result = createWordPlan(defaultAnnouncement, bank);

  it('parses against the real voice bank with no markup errors', () => {
    expect(result.notices.filter((notice) => !notice.text.startsWith('No audio clip for'))).toEqual([]);
    expect(result.plan.length).toBeGreaterThan(20);
  });

  it('keeps unrecorded words to a minimum', () => {
    expect(result.unresolvedWords.sort()).toEqual(['democracy', 'fun', 'managed', 'mandatory']);
  });

  it('showcases the editor tags', () => {
    for (const tag of ['<start>', '<end>', '<pause', '<stutter', '<pitch', '<volume', '<rate', '<voice', '<fit seconds=']) {
      expect(defaultAnnouncement).toContain(tag);
    }
  });
});
