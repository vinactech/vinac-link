// Page language: English (the source) or French (fr-CA). The page is written in English; when
// French is on, this swaps interface text for its translation as the page draws it: text nodes and
// the title / placeholder / aria-label attributes. It never touches what people or agents wrote
// (message bodies, code, names, typed values): those live in elements it skips.
// Dictionary: i18n-fr.js, keyed by the exact English text; PATTERNS cover text with numbers or names.

const SKIP = 'code, pre, kbd, textarea, input, script, style, svg, [translate="no"], .bubble, .quote, .args, .value, .use-cmd';
const ATTRS = ['title', 'placeholder', 'aria-label'];
const KEY = 'vinac.lang';

let dict = null, patterns = [], lang = 'en', observer = null;

export function chosenLang() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); if (v === 'en' || v === 'fr') return v; } catch { /* private mode */ }
  return 'auto';
}
const autoLang = () => ((navigator.languages || [navigator.language || 'en']).find(l => /^(en|fr)/i.test(l)) || 'en').slice(0, 2).toLowerCase();
export const currentLang = () => lang;

/** Translates one string (exact, then patterns); unknown text stays English. */
export function t(s) {
  if (lang !== 'fr' || !dict || typeof s !== 'string') return s;
  return translate(s, dict, patterns);
}
function translate(s, d, p) {
  const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], core = s.trim();
  if (!core) return s;
  const hit = d.get(core.replace(/\s+/g, ' '));
  if (hit != null) return lead + hit + trail;
  for (const [re, fr] of p) {
    const m = core.match(re);
    if (m) return lead + fr.replace(/\{(\d)\}/g, (_, i) => translate(m[Number(i) + 1], d, p)) + trail;
  }
  return s;
}
/** For tests and tools: a translate function for a dictionary, and whether a string is covered. */
export function translatorFor(entries) {
  const { d, p } = compileEntries(entries);
  return { t: s => translate(s, d, p), covered: s => d.has(s.replace(/\s+/g, ' ').trim()) || p.some(([re]) => re.test(s.trim())) };
}

function skipped(el) { return !!el?.closest?.(SKIP); }

function translateNode(node) {
  if (node.nodeType === 3) {
    if (skipped(node.parentElement)) return;
    const v = node.nodeValue, n = t(v);
    if (n !== v) node.nodeValue = n;
    return;
  }
  if (node.nodeType !== 1) return;
  // Text boxes: their hint (placeholder, label) is interface text; what is typed in them is not.
  if ((node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') && !node.parentElement?.closest(SKIP)) {
    for (const a of ATTRS) { const v = node.getAttribute(a); if (v) { const n = t(v); if (n !== v) node.setAttribute(a, n); } }
    return;
  }
  if (skipped(node)) return;
  for (const a of ATTRS) {
    const v = node.getAttribute(a);
    if (v) { const n = t(v); if (n !== v) node.setAttribute(a, n); }
  }
  // Device, agent and key names (in lists and menus too) stay as they are: only labels are in the dictionary.
  for (const c of node.childNodes) translateNode(c);
}

function compileEntries(entries) {
  const d = new Map(Object.entries(entries.exact || {}));
  const p = (entries.patterns || []).map(([en, fr]) => {
    // "{0} waiting" → /^(.+?) waiting$/ ; placeholders are numbered in order of appearance
    const re = new RegExp(`^${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\d\\\}/g, '(.+?)')}$`, 's');
    return [re, fr];
  });
  return { d, p };
}
function compile(entries) { ({ d: dict, p: patterns } = compileEntries(entries)); }

/** Starts the page in the chosen language. Call once, before the first render. */
export async function startI18n() {
  const choice = chosenLang();
  lang = choice === 'auto' ? autoLang() : choice;
  document.documentElement.lang = lang === 'fr' ? 'fr-CA' : 'en';
  if (lang !== 'fr') return;
  try { compile((await import('/web/i18n-fr.js')).default); } catch { lang = 'en'; document.documentElement.lang = 'en'; return; }
  translateNode(document.body);
  observer = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') translateNode(m.target);
      else if (m.type === 'attributes') translateNode(m.target);
      else for (const n of m.addedNodes) translateNode(n);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

/** The person picked a language: remember it in this browser and reload. */
export function setLang(choice) {
  try { if (choice === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* private mode */ }
  location.reload();
}

/** Dates and times in the page's language. */
export const locale = () => (lang === 'fr' ? 'fr-CA' : undefined);
