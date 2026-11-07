import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Bank } from '../src/audio/types';
import { parseGeneratedPhones, resolvePhoneUnits, type PhonemeCatalog } from '../src/audio/phonemes';

const bank = JSON.parse(readFileSync(new URL('../public/bank.json', import.meta.url), 'utf8')) as Bank;
const catalog = JSON.parse(readFileSync(new URL('../public/phonemes.json', import.meta.url), 'utf8')) as PhonemeCatalog;

describe('measured phoneme window selection', () => {
  it('chooses a plausible l window for multiple instead of an extreme continuous window', () => {
    const parsed = parseGeneratedPhones('mˈʌltɪpəl', catalog);
    expect(parsed.phones).toEqual(['m', 'ʌ', 'l', 't', 'ɪ', 'p', 'əl']);
    expect(parsed.warnings).toEqual([]);

    const result = resolvePhoneUnits(parsed.phones, catalog, bank);
    expect(result.warnings).toEqual([]);
    const lateral = result.units.find((unit) => unit.ipa.split(' ').includes('l'));
    expect(lateral).toMatchObject({ clipId: 'result', startSeconds: 0.46, endSeconds: 0.51, ipa: 'l' });
    expect(result.units.reduce((duration, unit) => duration + unit.endSeconds - unit.startSeconds, 0)).toBeLessThan(1);
  });

  it('keeps normal coarticulated phones on contiguous source windows', () => {
    const result = resolvePhoneUnits(['m', 'ʌ', 's', 't'], catalog, bank);
    expect(result.warnings).toEqual([]);
    expect(result.units).toHaveLength(1);
    expect(result.units[0]).toMatchObject({ clipId: 'must', startSeconds: 0.0215, endSeconds: 0.489812, ipa: 'm ʌ s t' });
  });

  it('keeps a contiguous source when same-class candidates differ in median distance', () => {
    const selectionBank: Bank = {
      version: 'selection-test',
      source: 'selection test',
      clips: ['continuous', 'median', 'other'].map((id, index) => ({
        id, file: `/audio/${id}.opus`, duration: 0.5, kind: 'word', sha256: String(index + 1).repeat(64),
      })),
    };
    const hashes = { continuous: '1'.repeat(64), median: '2'.repeat(64), other: '3'.repeat(64) };
    const window = (clipId: string, startSeconds: number, endSeconds: number, position: 'initial' | 'final') => ({
      clipId,
      ipa: position === 'initial' ? 'm' : 'ʌ',
      startSeconds,
      endSeconds,
      sourceDurationSeconds: 0.5,
      sourceSha256: hashes[clipId as keyof typeof hashes],
      position,
      previousIpa: position === 'initial' ? null : 'm',
      nextIpa: position === 'initial' ? 'ʌ' : null,
    });
    const selectionCatalog: PhonemeCatalog = {
      schemaVersion: 2,
      sourceBank: { version: selectionBank.version, sha256: '0'.repeat(64) },
      phones: {
        m: [window('continuous', 0.01, 0.13, 'initial')],
        ʌ: [
          window('continuous', 0.13, 0.35, 'final'),
          window('median', 0.01, 0.13, 'final'),
          window('other', 0.01, 0.11, 'final'),
        ],
      },
    };

    const result = resolvePhoneUnits(['m', 'ʌ'], selectionCatalog, selectionBank);
    expect(result.units).toHaveLength(1);
    expect(result.units[0]).toMatchObject({ clipId: 'continuous', startSeconds: 0.01, endSeconds: 0.35, ipa: 'm ʌ' });
  });
});
