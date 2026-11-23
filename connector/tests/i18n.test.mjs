// The page in French: the dictionary loads, covers every piece of interface text written in the
// page's HTML, and patterns fill in names and numbers. (The browser part, which swaps the text as the
// page draws it, is checked by hand in the browser.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fr from '../web/i18n-fr.js';
import { translatorFor } from '../web/i18n.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const { t, covered } = translatorFor(fr);

test('French: every interface text in the page\'s HTML has a translation', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<(code|pre|kbd)\b[\s\S]*?<\/\1>/g, '<x>')
    .replace(/<[^>]*translate="no"[^>]*>[^<]*/g, '<x>');
  const strings = new Set();
  const clean = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim();
  for (const m of html.matchAll(/>([^<>]+)</g)) { const s = clean(m[1]); if (/[A-Za-z]{2}/.test(s)) strings.add(s); }
  for (const m of html.matchAll(/\b(?:title|placeholder|aria-label)="([^"]+)"/g)) { const s = clean(m[1]); if (/[A-Za-z]{2}/.test(s)) strings.add(s); }
  const missing = [...strings].filter(s => !covered(s) && !/^[A-Z0-9_]+$/.test(s) && !/^(https?:|vinac |npx |[a-z]+\.[a-z]+)/.test(s));
  assert.deepEqual(missing, [], `untranslated:\n${missing.join('\n')}`);
});

test('French: values are filled in, names are kept, unknown text stays English', () => {
  for (const [k, v] of Object.entries(fr.exact)) assert.ok(typeof v === 'string' && v.length, `empty translation for "${k}"`);
  assert.equal(t('Pair a device'), 'Jumeler un appareil');
  assert.equal(t('  Pair a device  '), '  Jumeler un appareil  ', 'spaces around are kept');
  assert.equal(t('Send a secret to Mac Studio'), 'Envoyer un secret à Mac Studio');
  assert.equal(t('Default: Ask me'), 'Par défaut : Me demander', 'parts of a pattern are translated too');
  assert.equal(t('Rule for code.pr.merge'), 'Règle pour code.pr.merge');
  assert.equal(t('PC · 3 paired devices'), 'PC · 3 appareils jumelés');
  assert.equal(t('Something nobody translated'), 'Something nobody translated');
});
