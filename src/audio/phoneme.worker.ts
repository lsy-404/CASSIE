type RequestMessage = { words: string[] };
type ResponseMessage = { phones: Record<string, string> } | { error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RequestMessage>) => void) | null;
  postMessage: (message: ResponseMessage) => void;
};

scope.onmessage = async ({ data }) => {
  try {
    if (!Array.isArray(data.words) || data.words.length > 512 || data.words.some((word) => typeof word !== 'string' || word.length > 256)) {
      throw new Error('English phonemizer input is invalid.');
    }
    const { phonemize } = await import('phonemizer');
    const phones: Record<string, string> = {};
    for (const word of data.words) {
      const result = await phonemize(word, 'en-us');
      const phonetic = result.find((item) => item.trim());
      if (phonetic) phones[word.toLocaleLowerCase('en-US')] = phonetic;
    }
    scope.postMessage({ phones });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : 'English phonemizer failed.' });
  }
};
