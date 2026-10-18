// The hosting site passes its main menu as <meta name="home-url">. Without it there is nothing to return to.
export function readHomeUrl(doc: Pick<Document, 'querySelector'> | undefined = globalThis.document): string {
  return doc?.querySelector<HTMLMetaElement>('meta[name="home-url"]')?.content?.trim() || '';
}
