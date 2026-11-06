import { describe, it, expect } from 'vitest';
import { htmlToText } from '../src/tools/search.js';

describe('htmlToText — link targets', () => {
  it('turns an anchor into markdown text (URL)', () => {
    expect(htmlToText('<p>See <a href="https://ex.com/guide">our guide</a> now.</p>')).toBe(
      'See [our guide](https://ex.com/guide) now.'
    );
  });

  it('reads a single-quoted href', () => {
    expect(htmlToText("<a href='https://ex.com'>site</a>")).toBe('[site](https://ex.com)');
  });

  it('strips formatting tags from the anchor text but keeps the words', () => {
    expect(htmlToText('<a href="https://e.com"><strong>Bold</strong> link</a>')).toBe(
      '[Bold link](https://e.com)'
    );
  });

  it('returns the bare URL when the anchor text is empty', () => {
    expect(htmlToText('<a href="https://e.com"></a>')).toBe('https://e.com');
  });

  // Regression guard — already passes; locks in current behavior so future refactors cannot regress.
  it('keeps the text and drops nothing else when the anchor has no href', () => {
    expect(htmlToText('<a name="top">Top</a>')).toBe('Top');
  });
});
