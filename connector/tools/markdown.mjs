// A small Markdown-to-HTML converter for the website (no dependencies). It covers what the docs
// use: headings, paragraphs, lists (with code blocks or more paragraphs inside items), fenced code,
// tables, block quotes, rules, and inline code, links, bold, italics and strikethrough.
// Raw HTML in the Markdown is escaped, never passed through; HTML comments are dropped.

const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function slug(text) {
  return String(text).toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '')
    .replace(/[`*_~[\]()]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
}

/**
 * Inline Markdown. `link(href, label)` returns the URL to use, `{ href, text }` to also replace the
 * label (given and returned as HTML), or null to show the text without a link.
 */
export function inline(text, link = h => h) {
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(`<code>${escapeHtml(c)}</code>`) - 1}\u0000`);
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const r = link(href.replace(/&amp;/g, '&'), label);
    const url = r && typeof r === 'object' ? r.href : r;
    const text = r && typeof r === 'object' ? r.text : label;
    return url ? `<a href="${escapeHtml(url)}"${/^https?:/.test(url) ? ' rel="noopener"' : ''}>${text}</a>` : label;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?!\s)([^_]+?)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const LIST_ITEM = /^( {0,3})([-*]|\d+\.)\s+(.*)$/;
const FENCE = /^\s*```(\w*)\s*$/;
const isTableSep = l => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));

/** Block Markdown -> HTML. Returns { html, headings: [{ level, text, id }] }. */
export function render(markdown, { link = h => h } = {}) {
  const headings = [];
  const ids = new Map();
  const uniqueId = text => {
    const base = slug(text) || 'section';
    const n = ids.get(base) || 0; ids.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
  const blocks = lines => {
    const out = [];
    let i = 0;
    const startsBlock = l => FENCE.test(l) || /^#{1,6}\s/.test(l) || LIST_ITEM.test(l) || /^>/.test(l) || /^\s*\|/.test(l) || /^\s*<!--/.test(l) || /^(-{3,}|\*{3,})\s*$/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (/^\s*<!--/.test(line)) { while (i < lines.length && !lines[i].includes('-->')) i++; i++; continue; }
      const fence = FENCE.exec(line);
      if (fence) {
        const body = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
        i++;
        out.push(`<pre><code${fence[1] ? ` class="lang-${escapeHtml(fence[1])}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`);
        continue;
      }
      const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) {
        const level = h[1].length, html = inline(h[2], link), id = uniqueId(h[2]);
        headings.push({ level, text: html.replace(/<[^>]+>/g, ''), id });
        out.push(`<h${level} id="${id}">${html}</h${level}>`);
        i++; continue;
      }
      if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push(`<div class="table"><table><thead><tr>${head.map(c => `<th>${inline(c, link)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c, link)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (/^>/.test(line)) {
        const body = [];
        while (i < lines.length && /^>/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
        out.push(`<blockquote>${blocks(body)}</blockquote>`);
        continue;
      }
      const item = LIST_ITEM.exec(line);
      if (item) {
        const ordered = /\d/.test(item[2]);
        const start = ordered ? parseInt(item[2], 10) : 1;
        const items = [];
        while (i < lines.length) {
          const m = LIST_ITEM.exec(lines[i]);
          if (!m || /\d/.test(m[2]) !== ordered || m[1].length !== item[1].length) break;
          const indent = m[1].length + m[2].length + 1;
          const body = [m[3]];
          let loose = false;
          i++;
          while (i < lines.length) {
            const l = lines[i];
            if (!l.trim()) {
              // a blank line continues the item only if the next line is indented
              if (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !LIST_ITEM.test(lines[i + 1])) { body.push(''); loose = true; i++; continue; }
              break;
            }
            if (LIST_ITEM.exec(l)?.[1].length === item[1].length) break;
            if (/^\s{2,}/.test(l)) { body.push(l.replace(new RegExp(`^ {0,${indent}}`), '')); i++; continue; }
            if (startsBlock(l)) break;
            body.push(l); i++; // lazy continuation
          }
          const simple = !loose && !body.some(l => startsBlock(l));
          items.push(simple ? inline(body.join(' '), link) : blocks(body));
        }
        out.push(ordered
          ? `<ol${start !== 1 ? ` start="${start}"` : ''}>${items.map(x => `<li>${x}</li>`).join('')}</ol>`
          : `<ul>${items.map(x => `<li>${x}</li>`).join('')}</ul>`);
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i]))) para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join(' '), link)}</p>`);
    }
    return out.join('\n');
  };
  const html = blocks(String(markdown).replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n'));
  return { html, headings };
}
