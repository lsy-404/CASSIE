const FONT: Record<string, string[]> = {
  C: ['.XXX.', 'X...X', 'X....', 'X....', 'X....', 'X...X', '.XXX.'],
  A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
  I: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', 'XXXXX'],
  E: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
  D: ['XXXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'XXXX.'],
  J: ['..XXX', '...X.', '...X.', '...X.', '...X.', 'X..X.', '.XX..'],
  N: ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X', 'X...X'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  P: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X....', 'X....', 'X....'],
  R: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
  T: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..'],
  V: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.X.X.', '..X..'],
  '0': ['.XXX.', 'X...X', 'X..XX', 'X.X.X', 'XX..X', 'X...X', '.XXX.'],
  '1': ['..X..', '.XX..', '..X..', '..X..', '..X..', '..X..', '.XXX.'],
  '2': ['.XXX.', 'X...X', '....X', '...X.', '..X..', '.X...', 'XXXXX'],
  '3': ['XXXX.', '....X', '....X', '.XXX.', '....X', '....X', 'XXXX.'],
  '4': ['...X.', '..XX.', '.X.X.', 'X..X.', 'XXXXX', '...X.', '...X.'],
  '5': ['XXXXX', 'X....', 'XXXX.', '....X', '....X', 'X...X', '.XXX.'],
  '6': ['.XXX.', 'X....', 'X....', 'XXXX.', 'X...X', 'X...X', '.XXX.'],
  '7': ['XXXXX', '....X', '...X.', '..X..', '.X...', '.X...', '.X...'],
  '8': ['.XXX.', 'X...X', 'X...X', '.XXX.', 'X...X', 'X...X', '.XXX.'],
  '9': ['.XXX.', 'X...X', 'X...X', '.XXXX', '....X', '....X', '.XXX.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..X..'],
  '+': ['.....', '..X..', '..X..', 'XXXXX', '..X..', '..X..', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
const ADVANCE = GLYPH_WIDTH + 1;

export const cellPath = (x: number, y: number) => `M${x} ${y}h1v1h-1z`;

export function glyphPath(char: string, left: number, top: number): string {
  return FONT[char].map((row, y) => [...row].map((pixel, x) => (pixel === 'X' ? cellPath(left + x, top + y) : '')).join('')).join('');
}

export function textPath(text: string): string {
  return [...text].map((char, index) => glyphPath(char, index * ADVANCE, 0)).join('');
}

export const textCells = (text: string) => text.length * ADVANCE - 1;
