/** True when version `a` (like "0.7.0") is older than `b`. Pre-release tags count as older. */
export function isOlderVersion(a, b) {
  const parse = v => {
    const [core, pre] = String(v).trim().replace(/^v/, '').split('-');
    return { n: core.split('.').map(x => Number.parseInt(x, 10) || 0), pre: pre ?? null };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) < (y.n[i] ?? 0);
  if (x.pre && !y.pre) return true;
  if (!x.pre && y.pre) return false;
  return (x.pre ?? '') < (y.pre ?? '');
}
