import nspell from 'nspell';

type Request = { id: number; words: string[] };
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: { id: number; misspelled?: string[]; suggestions?: Record<string, string>; error?: string }) => void;
};

async function loadDocument(language: string, extension: string): Promise<string> {
  const response = await fetch(new URL(`/spelling/${language}.${extension}`, self.location.origin));
  if (!response.ok) throw new Error('The English spelling dictionary could not be loaded.');
  return response.text();
}

const dictionaries = Promise.all(['en', 'en-gb'].map(async (language) => {
  const [aff, dic] = await Promise.all([loadDocument(language, 'aff'), loadDocument(language, 'dic')]);
  return nspell(aff, dic);
}));
scope.onmessage = async ({ data }) => {
  try {
    if (data.words.length > 512) throw new Error('The spelling request exceeds the word limit.');
    const spells = await dictionaries;
    const words = [...new Set(data.words)].filter((word) => /^[a-z]+(?:[-'][a-z]+)*$/i.test(word) && word.length <= 128);
    const misspelled = words.filter((word) => !spells.some((spell) => spell.correct(word)));
    const suggestions = Object.fromEntries(misspelled.map((word) => [word, spells.flatMap((spell) => spell.suggest(word))[0] ?? '']));
    scope.postMessage({ id: data.id, misspelled, suggestions });
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'English spelling hints are unavailable.' });
  }
};
