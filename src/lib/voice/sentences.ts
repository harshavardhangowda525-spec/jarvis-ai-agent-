/**
 * Splits a reply that is still streaming in into speakable pieces, so the voice
 * can start on the first sentence while the model writes the rest. Pure and
 * client-safe.
 */

const FIRST_MIN = 2; // speak the very first sentence as soon as it is complete
const NEXT_MIN = 40; // later pieces are merged a little so the voice flows

// End of a sentence: . ! ? … (optionally closed by a quote/bracket) + whitespace, or a line break.
const BOUNDARY = /[.!?…]+["')\]]*\s+|\n+/g;

/**
 * Take the complete sentences off the front of `buffer`.
 * @param first whether nothing has been spoken yet (lower threshold)
 * @param flush the reply is finished — return everything left
 */
export function takeSentences(buffer: string, first: boolean, flush = false): { pieces: string[]; rest: string } {
  const pieces: string[] = [];
  let start = 0;
  let pending = "";
  let m: RegExpExecArray | null;
  BOUNDARY.lastIndex = 0;
  while ((m = BOUNDARY.exec(buffer))) {
    const end = m.index + m[0].length;
    pending += buffer.slice(start, end);
    start = end;
    const min = first && pieces.length === 0 ? FIRST_MIN : NEXT_MIN;
    if (cleanForSpeech(pending).length >= min) { pieces.push(pending); pending = ""; }
  }
  let rest = pending + buffer.slice(start);
  if (flush && rest.trim()) { pieces.push(rest); rest = ""; }
  return { pieces: pieces.map(cleanForSpeech).filter(Boolean), rest };
}

/** Remove markdown/URLs that sound wrong when read aloud. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>|]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
