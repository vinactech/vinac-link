#!/usr/bin/env node
// Builds the website (vinac.tech) into dist/site: the home page, every doc rendered from Markdown,
// a fresh tester package to download, security headers, sitemap and 404. Static files only; no
// cookies, no trackers, no outside requests. Deploy dist/site to any static host.
//   node connector/tools/build-site.mjs [--out DIR] [--no-kit]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { render } from './markdown.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'site');
const ORIGIN = 'https://vinac.tech';
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const DEFAULT_OUT = path.resolve(outArg >= 0 ? args[outArg + 1] : path.join(ROOT, 'dist', 'site'));
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

// Every page built from Markdown: source -> URL, title in the sidebar, sidebar group.
// docs/LAUNCH.md is internal and never published.
export const PAGES = [
  ['docs/README.md', '/docs/', 'Overview', 'Start'],
  ['docs/getting-started.md', '/docs/getting-started.html', 'Getting started', 'Start'],
  ['docs/guide/pairing.md', '/docs/guide/pairing.html', 'Pairing', 'Guide'],
  ['docs/guide/messages-and-requests.md', '/docs/guide/messages-and-requests.html', 'Messages, requests, files', 'Guide'],
  ['docs/guide/firewall.md', '/docs/guide/firewall.html', 'The firewall', 'Guide'],
  ['docs/guide/secrets.md', '/docs/guide/secrets.html', 'Secrets', 'Guide'],
  ['docs/guide/networks.md', '/docs/guide/networks.html', 'Networks and ports', 'Guide'],
  ['docs/guide/offline.md', '/docs/guide/offline.html', 'Offline use', 'Guide'],
  ['docs/guide/agents.md', '/docs/guide/agents.html', 'Connecting agents', 'Guide'],
  ['docs/guide/auto-mode.md', '/docs/guide/auto-mode.html', 'Auto mode', 'Guide'],
  ['docs/guide/cli.md', '/docs/guide/cli.html', 'Command line', 'Guide'],
  ['docs/guide/troubleshooting.md', '/docs/guide/troubleshooting.html', 'Troubleshooting', 'Guide'],
  ['openclaw/README.md', '/docs/openclaw.html', 'OpenClaw', 'Guide'],
  ['docs/intents/README.md', '/docs/intents/', 'Intents', 'Intents'],
  ['docs/intents/catalog.md', '/docs/intents/catalog.html', 'Intent catalog', 'Intents'],
  // The website's own short security page; the full SECURITY.md (threat model, known limits) stays
  // in the repository for reviewers.
  ['site/security.md', '/security.html', 'Security', 'Reference'],
];
// Pages with the plain layout: source in site/, URL, title, description, active nav item.
export const PLAIN = [
  ['about.md', '/about.html', 'About', 'Why we built VINAC Link: AI agents on several computers, some offline, and no safe way to share keys and requests between them.', 'about'],
  ['privacy.md', '/privacy.html', 'Privacy Policy', 'What Mexley Marketing Inc. collects through vinac.tech and VINAC Link (very little), and how we handle it.', ''],
  ['terms.md', '/terms.html', 'Terms of Use', 'The terms for using vinac.tech and downloading VINAC Link, including how our name and logo may be used.', ''],
];
// Not on the website: internal notes (launch plan, roadmap, changelog) and the deep technical
// design (architecture, protocol spec), which stay in the repository for reviewers and auditors.
// Links to them show as plain text, and list items that only point at them are left out.
const INTERNAL = ['docs/LAUNCH.md', 'docs/ROADMAP.md', 'CHANGELOG.md', 'docs/ARCHITECTURE.md', 'docs/NOISE.md'];
const INTERNAL_LINE = /^\s*[-*]\s+\[[^\]]+\]\((?:\.\.\/)*(?:docs\/)?(?:LAUNCH|ROADMAP|CHANGELOG|ARCHITECTURE|NOISE)\.md[^)]*\)/;
export const publicMarkdown = md => md.split('\n').filter(l => !INTERNAL_LINE.test(l) && !l.includes('LAUNCH.md')).join('\n');
const BY_SOURCE = new Map(PAGES.map(p => [p[0], p]));
// Repository files that are not pages but still have a home on the site.
const OTHER = { 'LICENSE': '/LICENSE.txt', 'NOTICE': '/NOTICE.txt', 'README.md': '/', 'docs/intents': '/docs/intents/', 'SECURITY.md': '/security.html' };

// Apps in the "works with" strip: name, logo file, and how the logo adapts to the theme
// (ink-black: a black logo, shown white on dark; ink-white: a white logo, shown black on light).
const WORKS = [
  ['Claude Code', 'claude.svg'], ['Codex', 'codex.svg', 'ink-white'], ['OpenClaw', 'openclaw.svg'],
  ['LM Studio', 'lmstudio.svg', 'ink-white'], ['Ollama', 'ollama.svg', 'ink-white'], ['Goose', 'goose.svg'],
  ['Open WebUI', 'openwebui.svg'], ['Cursor', 'cursor.svg', 'ink-white'], ['LibreChat', 'librechat.svg'],
  ['Any MCP app', 'mcp.svg', 'ink-black'],
];

const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Maps a link inside `source` to a site URL; null when the target has no page (shown as text). */
export function resolveLink(source, href, missing = []) {
  if (/^(https?:|mailto:)/.test(href) || href.startsWith('#') || href.startsWith('/')) return href;
  const [p, hash] = href.split('#');
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(source), p)).replace(/\/$/, '');
  if (INTERNAL.includes(target)) return null; // not published: shown as plain text
  const page = BY_SOURCE.get(target) || BY_SOURCE.get(`${target}/README.md`);
  const url = page ? page[1] : OTHER[target];
  if (!url) { missing.push(`${source} -> ${href}`); return null; }
  return hash ? `${url}#${hash}` : url;
}

// The VINAC Link icon (sizes made by connector/tools/make-icons.ps1 from site/brand/vinac-icon.png).
const ICON = '<img class="mark" src="/brand/icon-128.png" alt="" width="30" height="30">';
const ICON_BIG = '<img class="mark big" src="/brand/icon-128.png" alt="" width="56" height="56">';

const header = active => `<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="/" aria-label="VINAC Link home">${ICON}<span>VINAC Link</span></a>
    <nav class="nav" aria-label="Main">
      <a href="/#how"${active === 'how' ? ' aria-current="page"' : ''}>How it works</a>
      <a href="/about.html"${active === 'about' ? ' aria-current="page"' : ''}>About</a>
      <a href="/docs/"${active === 'docs' ? ' aria-current="page"' : ''}>Docs</a>
      <a href="/security.html"${active === 'security' ? ' aria-current="page"' : ''}>Security</a>
      <button class="theme-toggle" type="button" aria-label="Switch theme"><svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg></button>
      <a class="btn small primary" href="/#download">Download</a>
    </nav>
  </div>
</header>`;

const footer = `<footer class="foot">
  <div class="wrap foot-in">
    <div class="foot-brand">${ICON}<div><strong>VINAC Link™</strong><span>Verified Intent Network for Agent Communication</span></div></div>
    <nav class="foot-links" aria-label="Footer">
      <a href="/docs/">Docs</a><a href="/security.html">Security</a><a href="/about.html">About</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/LICENSE.txt">License</a><a href="/#contact">Contact</a>
    </nav>
    <p class="fine">© 2026 Mexley Marketing Inc. · Free and open source under Apache-2.0 · This site sets no cookies and loads no trackers. VINAC and VINAC Link are trademarks of Mexley Marketing Inc. Other product names and logos belong to their owners and are shown only to say what VINAC Link works with.</p>
  </div>
</footer>`;

const head = ({ title, description, url, scripts = [] }) => `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${ORIGIN}${url}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${ORIGIN}${url}">
<meta property="og:image" content="${ORIGIN}/brand/icon-512.png">
<meta name="theme-color" content="#09090b">
<meta name="color-scheme" content="dark light">
<link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">
<link rel="icon" type="image/png" sizes="128x128" href="/brand/icon-128.png">
<link rel="apple-touch-icon" href="/brand/icon-512.png">
<script src="/theme.js?v=${version}"></script>
<link rel="stylesheet" href="/styles.css?v=${version}">
${['site.js', ...scripts].map(s => `<script src="/${s}?v=${version}" defer></script>`).join('\n')}
</head>`;

function docPage([source, url, title, group], body, headings) {
  const groups = [...new Set(PAGES.map(p => p[3]))];
  const side = groups.map(g => `<div class="side-group"><h2>${g}</h2>${PAGES.filter(p => p[3] === g).map(p => `<a href="${p[1]}"${p[1] === url ? ' aria-current="page"' : ''}>${escapeHtml(p[2])}</a>`).join('')}</div>`).join('');
  const toc = headings.filter(h => h.level === 2);
  const firstPara = (body.match(/<p>([\s\S]*?)<\/p>/) || [, ''])[1].replace(/<[^>]+>/g, '').slice(0, 160);
  const active = url === '/security.html' ? 'security' : 'docs';
  return `${head({ title: `${title} · VINAC Link`, description: firstPara || `VINAC Link documentation: ${title}.`, url })}
<body class="doc-page">
<a class="skip" href="#content">Skip to content</a>
${header(active)}
<div class="wrap doc">
  <details class="side-mobile"><summary>Documentation</summary><nav aria-label="Documentation">${side}</nav></details>
  <aside class="side"><nav aria-label="Documentation">${side}</nav></aside>
  <main id="content" class="prose">${body}</main>
  ${toc.length > 2 ? `<aside class="toc"><h2>On this page</h2>${toc.map(h => `<a href="#${h.id}">${escapeHtml(h.text)}</a>`).join('')}</aside>` : '<span></span>'}
</div>
${footer}
</body>
</html>
`;
}

const urlToFile = url => (url.endsWith('/') ? `${url}index.html` : url).slice(1);

export function build({ out: OUT = DEFAULT_OUT, withKit = !args.includes('--no-kit') } = {}) {
  const write = (rel, data) => {
    const file = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // 1. The tester package, built fresh into /download
  let kit = null;
  if (withKit) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'connector/tools/make-kit.mjs'), '--out', path.join(OUT, 'download')], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`make-kit failed:\n${r.stderr}`);
    const name = `vinac-link-${version}.zip`;
    const bytes = fs.readFileSync(path.join(OUT, 'download', name));
    kit = { name, url: `/download/${name}`, kb: Math.round(bytes.length / 1024), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }

  // 1b. Installers (connector/tools/installers/build-installers.mjs; the .dmg is made on a Mac),
  // copied when present; each download card falls back to the zip package when its installer is missing.
  const INST = path.join(ROOT, 'build', 'installers', 'out');
  const dl = {};
  const installer = (key, file, step, fallbackStep) => {
    const src = path.join(INST, file);
    if (kit && fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(OUT, 'download', file));
      const bytes = fs.readFileSync(src);
      fs.appendFileSync(path.join(OUT, 'download', 'SHA256SUMS.txt'), `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${file}\n`);
      dl[key] = { href: `/download/${file}`, step, size: `${Math.round(bytes.length / 1048576)} MB` };
    } else dl[key] = { href: kit ? kit.url : '#download', step: fallbackStep, size: kit ? `${kit.kb} KB zip` : '' };
  };
  installer('win', `VINAC-Link-Setup-${version}.exe`, 'Run the installer. If Windows SmartScreen appears, choose <b>More info → Run anyway</b>.', 'Unzip, then double-click <b>Start VINAC Link.cmd</b> (needs Node.js 22+)');
  installer('mac', `VINAC-Link-${version}.dmg`, 'Open the .dmg and drag VINAC Link to Applications. The first time, allow it in <b>System Settings → Privacy &amp; Security</b>.', 'Unzip, then right-click <b>Start VINAC Link.command</b> → Open (needs Node.js 22+)');
  installer('linux', `VINAC-Link-${version}-linux-x64.tar.gz`, 'Extract it, then run <b>sh install.sh</b>. It adds VINAC Link to your app menu.', 'Unzip, then run <b>sh start-linux.sh</b> (needs Node.js 22+)');

  // 2. Static assets
  for (const f of ['styles.css', 'site.js', 'theme.js', 'field.js', '_headers', '.htaccess', 'robots.txt', 'contact.php']) fs.copyFileSync(path.join(SITE, f), path.join(OUT, f));
  if (fs.existsSync(path.join(SITE, 'media'))) fs.cpSync(path.join(SITE, 'media'), path.join(OUT, 'media'), { recursive: true });
  // The icon sizes only; the 1.4 MB source image (vinac-icon.png) stays out of the site.
  fs.mkdirSync(path.join(OUT, 'brand'), { recursive: true });
  for (const f of ['icon-512.png', 'icon-128.png', 'favicon-32.png']) fs.copyFileSync(path.join(SITE, 'brand', f), path.join(OUT, 'brand', f));
  fs.copyFileSync(path.join(SITE, 'brand', 'favicon-32.png'), path.join(OUT, 'favicon.png'));
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(OUT, 'LICENSE.txt'));
  fs.copyFileSync(path.join(ROOT, 'NOTICE'), path.join(OUT, 'NOTICE.txt'));
  const demoFile = ['demo.mp4', 'demo.webm'].find(f => fs.existsSync(path.join(SITE, 'media', f)));

  if (fs.existsSync(path.join(SITE, 'logos'))) fs.cpSync(path.join(SITE, 'logos'), path.join(OUT, 'logos'), { recursive: true, filter: f => !f.endsWith('.md') });

  // The "works with" strip: real logos (site/logos, sources in its README) plus names, twice for the loop.
  const row = hidden => `<ul class="marquee-row"${hidden ? ' aria-hidden="true"' : ''}>${WORKS.map(([name, file, ink]) => `<li><img${ink ? ` class="${ink}"` : ''} src="/logos/${file}" alt="" width="34" height="34">${escapeHtml(name)}</li>`).join('')}</ul>`;
  const works = `${row(false)}\n    ${row(true)}`;

  // 3. Home page
  const demo = demoFile
    ? `<video class="demo-video" controls preload="metadata" playsinline${fs.existsSync(path.join(SITE, 'media', 'poster.jpg')) ? ' poster="/media/poster.jpg"' : ''}><source src="/media/${demoFile}" type="video/${demoFile.split('.').pop()}">Your browser can't play this video. <a href="/media/${demoFile}">Download it</a>.</video>`
    : `<div class="demo-soon">${ICON_BIG}<p><strong>Video coming soon.</strong> Until then, the <a href="/docs/getting-started.html">quick start</a> takes about five minutes on two computers.</p></div>`;
  const home = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8')
    .replaceAll('{{head}}', head({ title: 'VINAC Link · A secure link between your AI agents', description: 'Pair your computers once, by sound or a short code. Then their AI agents can pass each other API keys, tokens and requests, and your rules decide what each agent receives. No cloud, no account.', url: '/', scripts: ['field.js'] }))
    .replaceAll('{{header}}', header('home'))
    .replaceAll('{{footer}}', footer)
    .replaceAll('{{demo}}', demo)
    .replace(/\{\{(win|mac|linux)_(href|step|size)\}\}/g, (_, os, k) => dl[os][k])
    .replaceAll('{{works}}', works)
    .replaceAll('{{version}}', version)
    .replaceAll('{{kit_url}}', kit ? kit.url : '#download')
    .replaceAll('{{kit_name}}', kit ? kit.name : `vinac-link-${version}.zip`)
    .replaceAll('{{kit_kb}}', kit ? String(kit.kb) : '…')
    .replaceAll('{{kit_sha256}}', kit ? kit.sha256 : 'built with the site');
  if (/\{\{\w+\}\}/.test(home)) throw new Error(`index.html has an unknown placeholder: ${home.match(/\{\{\w+\}\}/)[0]}`);
  write('index.html', home);

  // 4. Docs
  const missing = [];
  for (const page of PAGES) {
    // Lines that point at the internal launch plan are left out of the public site.
    const md = publicMarkdown(fs.readFileSync(path.join(ROOT, page[0]), 'utf8'));
    const { html, headings } = render(md, { link: (href, label) => {
      const url = resolveLink(page[0], href, missing);
      // A link shown as a file name ("guide/pairing.md") reads better as the page's title.
      const target = url && PAGES.find(p => p[1] === url.split('#')[0]);
      return target && /^(<code>)?[\w./-]+\.md(#[\w-]+)?(<\/code>)?$/.test(label) ? { href: url, text: escapeHtml(target[2]) } : url;
    } });
    write(urlToFile(page[1]), docPage(page, html, headings));
  }

  // 5. Plain pages (no docs sidebar): About, Privacy Policy, Terms of Use
  for (const [file, url, title, description, active] of PLAIN) {
    const { html } = render(fs.readFileSync(path.join(SITE, file), 'utf8'), { link: href => resolveLink(`site/${file}`, href, missing) });
    write(url.slice(1), `${head({ title: `${title} · VINAC Link`, description, url })}
<body class="plain-page">
<a class="skip" href="#content">Skip to content</a>
${header(active)}
<main id="content" class="wrap narrow prose about">${html}</main>
${footer}
</body>
</html>
`);
  }

  // 6. 404, sitemap
  write('404.html', `${head({ title: 'Not found · VINAC Link', description: 'This page does not exist.', url: '/404.html' })}
<body>
${header('')}
<main id="content" class="wrap notfound"><h1>Nothing here.</h1><p>That page doesn't exist. Try the <a href="/">home page</a> or the <a href="/docs/">docs</a>.</p></main>
${footer}
</body>
</html>
`);
  const urls = ['/', ...PLAIN.map(p => p[1]), ...PAGES.map(p => p[1])];
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${ORIGIN}${u}</loc></url>`).join('\n')}\n</urlset>\n`);

  return { out: OUT, kit, pages: PAGES.length + 2, missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = build();
  console.log(`site: ${r.out}\n  ${r.pages} pages${r.kit ? `, download ${r.kit.name} (${r.kit.kb} KB)` : ''}`);
  if (r.missing.length) { console.log(`  links shown as text (no page on the site):\n    ${r.missing.join('\n    ')}`); }
  // --zip: one archive whose contents go straight into the web root (e.g. SiteGround's public_html).
  if (args.includes('--zip')) {
    const zip = path.join(path.dirname(r.out), `vinac-tech-site-${version}.zip`);
    fs.rmSync(zip, { force: true });
    // The big installers stay out of the site zip: upload them on their own into public_html/download/.
    const z = spawnSync('tar', ['-a', '-c', '-f', zip, '--exclude', 'download/VINAC-Link-*', '-C', r.out, ...fs.readdirSync(r.out)], { encoding: 'utf8' });
    if (z.status !== 0) throw new Error(`zip failed (needs bsdtar: Windows 10+, macOS): ${z.stderr}`);
    console.log(`  upload package: ${zip} (${Math.round(fs.statSync(zip).size / 1024)} KB)`);
    const big = fs.readdirSync(path.join(r.out, 'download')).filter(f => f.startsWith('VINAC-Link-'));
    if (big.length) console.log(`  upload these separately into public_html/download/:\n    ${big.map(f => path.join(r.out, 'download', f)).join('\n    ')}`);
  }
}
