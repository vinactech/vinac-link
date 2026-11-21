// Hides secret values in a program's output (`vinac run`): if the program prints a
// value, the terminal (and an agent reading it) sees [hidden: NAME] instead.
// It catches the value as printed; it can't catch a value the program changes
// first (encodes, splits, reverses), so approving a run is still the real check.
import { Transform } from 'node:stream';

/** `secrets`: { NAME: value }. Values shorter than 4 characters are not hidden (too many false matches). */
export function redactor(secrets) {
  const list = Object.entries(secrets)
    .filter(([, v]) => typeof v === 'string' && v.length >= 4)
    .map(([name, v]) => [Buffer.from(v, 'utf8'), Buffer.from(`[hidden: ${name}]`, 'utf8')])
    .sort((a, b) => b[0].length - a[0].length);                // longest first
  const keep = Math.max(0, ...list.map(([v]) => v.length)) - 1;  // a value split across chunks
  let tail = Buffer.alloc(0);
  const scrub = buf => {
    for (const [v, r] of list) {
      let at = buf.indexOf(v);
      if (at < 0) continue;
      const parts = [];
      let from = 0;
      while (at >= 0) { parts.push(buf.subarray(from, at), r); from = at + v.length; at = buf.indexOf(v, from); }
      parts.push(buf.subarray(from));
      buf = Buffer.concat(parts);
    }
    return buf;
  };
  return new Transform({
    transform(chunk, _enc, done) {
      if (!list.length) return done(null, chunk);
      const buf = scrub(Buffer.concat([tail, chunk]));
      // Hold back the last bytes in case a value continues in the next chunk.
      const cut = Math.max(0, buf.length - keep);
      tail = buf.subarray(cut);
      done(null, buf.subarray(0, cut));
    },
    flush(done) { done(null, scrub(tail)); },
  });
}
