export interface EditorInsertion {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export function boundedNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function tagEnd(text: string, start: number): number {
  let quote = "";
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index + 1;
  }
  return text.length;
}

export function phonemeInsertion(text: string, start: number, end: number, phone: string): EditorInsertion {
  const selectionStart = Math.max(0, Math.min(text.length, Math.min(start, end)));
  const selectionEnd = Math.max(selectionStart, Math.min(text.length, Math.max(start, end)));
  const validPhone = phone.trim();
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] === "<") {
      cursor = tagEnd(text, cursor);
      continue;
    }
    if (text[cursor] !== "/") {
      cursor += 1;
      continue;
    }
    const match = text.slice(cursor).match(/^\/\s*[^/\r\n]{1,256}?\s*\//u)?.[0];
    if (!match) {
      cursor += 1;
      continue;
    }
    const blockEnd = cursor + match.length;
    const innerStart = cursor + 1;
    const innerEnd = blockEnd - 1;
    if (selectionStart >= innerStart && selectionEnd <= innerEnd && validPhone) {
      const before = text[selectionStart - 1] ?? "";
      const after = text[selectionEnd] ?? "";
      const inserted = `${before && !/\s/u.test(before) ? " " : ""}${validPhone}${after && !/\s/u.test(after) ? " " : ""}`;
      return { value: inserted, selectionStart: inserted.length, selectionEnd: inserted.length };
    }
    cursor = blockEnd;
  }
  const insertion = `/ ${validPhone} /`;
  const inner = insertion.length - 2;
  return { value: insertion, selectionStart: inner, selectionEnd: inner };
}
