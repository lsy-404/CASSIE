import { describe, expect, it } from 'vitest';
import { readHomeUrl } from '../src/home-url';

const page = (content?: string) => ({
  querySelector: (selector: string) => (selector === 'meta[name="home-url"]' && content !== undefined ? { content } : null),
}) as unknown as Pick<Document, 'querySelector'>;

describe('readHomeUrl', () => {
  it('returns the home URL the hosting site writes into the page', () => {
    expect(readHomeUrl(page('/'))).toBe('/');
    expect(readHomeUrl(page(' https://tiny.leisiyu.dev/ '))).toBe('https://tiny.leisiyu.dev/');
  });

  it('returns nothing without a usable meta, so no return link is shown', () => {
    expect(readHomeUrl(page())).toBe('');
    expect(readHomeUrl(page('  '))).toBe('');
    expect(readHomeUrl(undefined)).toBe('');
  });
});
