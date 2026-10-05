import nspell from 'nspell';

type Request = { id: number; words: string[] };
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: { id: number; misspelled?: string[]; error?: string }) => void;
};

async function loadDocument(extension: string): Promise<string> {
  const response = await fetch(new URL(`/spelling/en.${extension}`, self.location.origin));
  if (!response.ok) throw new Error('The English spelling dictionary could not be loaded.');
  return response.text();
}

const dictionary = Promise.all([loadDocument('aff'), loadDocument('dic')]).then(([aff, dic]) => nspell(aff, dic));
scope.onmessage = async ({ data }) => {
  try {
    if (data.words.length > 512) throw new Error('The spelling request exceeds the word limit.');
    const spell = await dictionary;
    const words = [...new Set(data.words)].filter((word) => /^[a-z]+(?:[-'][a-z]+)*$/i.test(word) && word.length <= 128);
    scope.postMessage({ id: data.id, misspelled: words.filter((word) => !spell.correct(word)) });
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'English spelling hints are unavailable.' });
  }
};
