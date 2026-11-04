const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const noLineStart = new Set(Array.from('。，、；：！？）】》」』”’…％‰℃,.;:!?%)]}'));
const noLineEnd = new Set(Array.from('（【《「『“‘([{'));
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Empty syllables create break opportunities without inserting hyphens. */
export function pdfWordBreaks(word: string): string[] {
  const isCjk = cjk.test(word);
  if (!isCjk && Array.from(word).length <= 32) return [word];
  const characters = Array.from(graphemes.segment(word), part => part.segment);
  if (!characters.length) return [word];
  const latinBoundaries = new Set<number>();
  if (isCjk) for (const match of word.matchAll(/[A-Za-z0-9_]+/g)) {
    if (match[0].length <= 32) for (let offset = 1; offset < match[0].length; offset++) latinBoundaries.add(match.index + offset);
  }
  const pieces: string[] = [];
  let piece = characters[0], offset = piece.length;
  for (let index = 1; index < characters.length; index++) {
    const previous = characters[index - 1], current = characters[index];
    const joinedPunctuation = noLineEnd.has(previous) || noLineStart.has(current)
      || ((previous === '—' || previous === '…') && previous === current);
    if (joinedPunctuation || latinBoundaries.has(offset)) piece += current;
    else { pieces.push(piece); piece = current; }
    offset += current.length;
  }
  pieces.push(piece);
  return pieces.flatMap(part => [part, '']);
}
