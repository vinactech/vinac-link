// The website (vinac.tech): Markdown rendering, links, and a full build without the download.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { render, inline } from '../tools/markdown.mjs';
import { build, PAGES, PLAIN, resolveLink, publicMarkdown } from '../tools/build-site.mjs';

test('markdown: blocks, inline marks, and raw HTML is escaped', () => {
  const { html, headings } = render([
    '# Title', '', 'Some **bold**, *em*, `a<b>` and [a link](https://x.y).', '',
    '- one', '- two with `code`', '', '1. first', '2. second', '   ```', '   npm test', '   ```', '',
    '| A | B |', '|---|---|', '| 1 | `x|y` |', '', '> quoted', '', '<script>alert(1)</script>', '<!-- hidden -->', 'Text <!-- also hidden --> stays.', '', '## Again', '## Again',
  ].join('\n'));
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>, <em>em<\/em>, <code>a&lt;b&gt;<\/code>/);
  assert.match(html, /<a href="https:\/\/x.y" rel="noopener">a link<\/a>/);
  assert.match(html, /<ul><li>one<\/li><li>two with <code>code<\/code><\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li><p>second<\/p>\n<pre><code>npm test<\/code><\/pre><\/li><\/ol>/);
  assert.match(html, /<table>.*<th>A<\/th>.*<td>1<\/td>/s);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /hidden/);
  assert.deepEqual(headings.map(h => h.id), ['title', 'again', 'again-1']);
  assert.equal(inline('snake_case_name stays'), 'snake_case_name stays');
});

test('site: every link in the published docs has a page; internal notes are never published', () => {
  assert.ok(!PAGES.some(p => /LAUNCH|ROADMAP|CHANGELOG/.test(p[0])));
  const missing = [];
  for (const [source] of PAGES) {
    const md = publicMarkdown(fs.readFileSync(path.join(import.meta.dirname, '../..', source), 'utf8'));
    render(md, { link: href => resolveLink(source, href, missing) });
  }
  assert.deepEqual(missing, []);
  assert.equal(resolveLink('docs/getting-started.md', 'guide/pairing.md#codes'), '/docs/guide/pairing.html#codes');
  assert.equal(resolveLink('docs/guide/agents.md', '../../openclaw/README.md'), '/docs/openclaw.html');
});

test('site: builds every page with no leftover placeholders, no outside requests and no trackers', () => {
  const out = tempHome('site');
  const r = build({ out, withKit: false });
  assert.equal(r.missing.length, 0);
  // The phone vault app (/app/) is its own small page, checked below.
  const files = fs.readdirSync(out, { recursive: true }).filter(f => f.endsWith('.html') && !f.replaceAll('\\', '/').startsWith('app/')).map(f => path.join(out, f));
  assert.equal(files.length, PAGES.length + PLAIN.length + 2); // + home + 404
  const appPage = fs.readFileSync(path.join(out, 'app', 'index.html'), 'utf8');
  assert.doesNotMatch(appPage, /<(script|img|link)[^>]+(src|href)="https?:/i, 'the phone vault loads nothing from other sites');
  for (const f of ['app/app.js', 'app/sw.js', 'app/web/phone-crypto.js', 'app/web/phone-frame.js', 'app/lab/js/audio.js', 'app/lab/worklets/vinac-tx-processor.js']) assert.ok(fs.existsSync(path.join(out, f)), f);
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'app', 'sw.js'), 'utf8'), /\{\{version\}\}/);
  for (const f of ['privacy.html', 'terms.html', 'about.html']) assert.ok(fs.existsSync(path.join(out, f)), f);
  for (const f of files) {
    const html = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(html, /\{\{\w+\}\}/, f);
    // The bottom bar on every page: GitHub, PayPal, newsletter (our own script, consent box required).
    assert.match(html, /<aside class="sbar"[\s\S]*href="https:\/\/paypal\.me\/vinactech"[\s\S]*action="\/subscribe\.php"[\s\S]*name="consent" type="checkbox" value="yes" required/, `${f} has the bottom bar`);
    assert.doesNotMatch(html, /<(script|img|iframe|video|source)[^>]+src="https?:|<link(?![^>]*rel="canonical")[^>]+href="https?:/i, `${f} loads something from another site`);
    assert.doesNotMatch(html, /LAUNCH\.md|ROADMAP\.md|CHANGELOG\.md|TODO|googletagmanager|gtag\(|connect\.facebook/, f);
    assert.doesNotMatch(html, /MacBook|Workstation|OpenClawGateway|ivadesk|SilentAuth|C:\\Users/i, `${f} has a device name or internal detail`);
  }
  const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(home, /Mexley Marketing Inc\./);
  assert.match(fs.readFileSync(path.join(out, '_headers'), 'utf8'), /frame-ancestors 'none'/);
  // The contact form posts only to our own script, which keeps its spam and header-injection guards.
  assert.match(home, /<form class="card contact-form" action="\/contact\.php" method="post">/);
  assert.match(home, /name="website"/, 'hidden trap field');
  const php = fs.readFileSync(path.join(out, 'contact.php'), 'utf8');
  for (const guard of ['MAX_PER_HOUR', 'MIN_SECONDS', "$_POST['website']", 'FILTER_VALIDATE_EMAIL', 'HTTP_ORIGIN', '[\\x00-\\x1F\\x7F]']) assert.ok(php.includes(guard), `contact.php keeps ${guard}`);
  // The newsletter form: our own script, an unticked consent box (CASL), the same guards, and
  // nothing ever sent to the address that was typed in (so it can't be used to spam people).
  assert.match(home, /<form class="signup-form" action="\/subscribe\.php" method="post"/);
  assert.match(home, /name="consent" type="checkbox" value="yes" required>/);
  assert.doesNotMatch(home, /name="consent"[^>]*checked/);
  const sub = fs.readFileSync(path.join(out, 'subscribe.php'), 'utf8');
  for (const guard of ['MAX_PER_HOUR', 'MIN_SECONDS', "$_POST['website']", "$_POST['consent']", 'FILTER_VALIDATE_EMAIL', 'HTTP_ORIGIN', '[\\x00-\\x1F\\x7F]', 'dirname(__DIR__)']) assert.ok(sub.includes(guard), `subscribe.php keeps ${guard}`);
  assert.equal((sub.match(/\bmail\((?!\))/g) || []).length, 1, 'one mail(), to us only');
  assert.match(sub, /mail\(TO,/);
  // The demo is the voiced walkthrough; the old explainer stays out of the site.
  assert.match(home, /<source src="\/media\/walkthrough\.mp4"/);
  assert.ok(!fs.existsSync(path.join(out, 'media', 'demo.mp4')));
  for (const f of ['.htaccess', '_headers']) {
    const h = fs.readFileSync(path.join(out, f), 'utf8');
    assert.match(h, /form-action 'self'/, `${f}: the form may post to this site`);
    assert.match(h, /same-origin/, `${f}: the browser sends Origin on the form post`);
  }
});
