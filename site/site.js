// Small page behaviours: copy buttons, the light/dark switch, the header pill, and the feature tabs.
// No cookies, no tracking; the theme choice stays in this browser.

// Copy buttons
document.addEventListener('click', async e => {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  const text = btn.parentElement.querySelector('pre')?.innerText ?? '';
  try { await navigator.clipboard.writeText(text.trim()); btn.textContent = 'Copied'; }
  catch { btn.textContent = 'Select and copy'; }
  setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
});

// Light / dark switch
const themeBtn = document.querySelector('.theme-toggle');
const syncThemeBtn = () => themeBtn?.setAttribute('aria-label', document.documentElement.dataset.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
themeBtn?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('vinac-site-theme', next); } catch { /* storage blocked: still switches for this page */ }
  syncThemeBtn();
});
syncThemeBtn();

// Header: becomes a floating pill once the page scrolls
const siteHeader = document.querySelector('.top');
const onScroll = () => siteHeader?.classList.toggle('scrolled', window.scrollY > 24);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Phone menu: the hamburger button opens the links; a link, Escape, a click outside or a wider
// window closes it.
const menuBtn = document.querySelector('.menu-toggle');
const setMenu = open => {
  siteHeader?.classList.toggle('open', open);
  menuBtn?.setAttribute('aria-expanded', String(open));
  menuBtn?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
};
menuBtn?.addEventListener('click', () => setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
document.querySelector('.nav')?.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
document.addEventListener('click', e => { if (siteHeader?.classList.contains('open') && !e.target.closest('.top')) setMenu(false); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && siteHeader?.classList.contains('open')) { setMenu(false); menuBtn?.focus(); }
});
window.matchMedia('(min-width: 1001px)').addEventListener('change', e => { if (e.matches) setMenu(false); });

// Contact and newsletter forms: send to /contact.php or /subscribe.php on this site (no outside
// service). Without this script the forms still post normally and the server answers with a page.
for (const contactForm of document.querySelectorAll('.contact-form, .signup-form')) {
  const started = contactForm.querySelector('input[name="t"]');
  if (started) started.value = String(Math.floor(Date.now() / 1000));
  // Links like /?topic=relay#contact pre-select a topic.
  const wanted = new URLSearchParams(location.search).get('topic');
  const option = wanted && contactForm.querySelector(`option[data-topic="${CSS.escape(wanted)}"]`);
  if (option) option.selected = true;
  const status = contactForm.querySelector('.form-status');
  const button = contactForm.querySelector('button[type="submit"]');
  contactForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!contactForm.reportValidity()) return;
    button.disabled = true;
    status.className = 'form-status';
    status.textContent = contactForm.classList.contains('signup-form') ? 'Subscribing…' : 'Sending…';
    try {
      const r = await fetch(contactForm.action, { method: 'POST', body: new FormData(contactForm), headers: { accept: 'application/json' } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'The message could not be sent.');
      contactForm.reset();
      if (started) started.value = String(Math.floor(Date.now() / 1000));
      status.className = 'form-status ok';
      status.textContent = contactForm.dataset.ok || 'Thank you. Your message is on its way, and we will reply by email.';
    } catch (err) {
      status.className = 'form-status bad';
      status.textContent = `${err.message} You can also write to hello@vinac.tech.`;
    } finally {
      button.disabled = false;
    }
  });
}

// How it works: the 3D stage tilts a little toward the pointer (not with reduced motion, not on touch).
const stage = document.querySelector('.stage3d');
if (stage && matchMedia('(prefers-reduced-motion: no-preference) and (hover: hover)').matches) {
  stage.addEventListener('pointermove', e => {
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    stage.style.setProperty('--ty', `${(x * 7).toFixed(2)}deg`);
    stage.style.setProperty('--tx', `${(5 - y * 6).toFixed(2)}deg`);
  });
  stage.addEventListener('pointerleave', () => { stage.style.removeProperty('--ty'); stage.style.removeProperty('--tx'); });
}

// Tabs (without this script every panel simply shows, one after another)
for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[e.key];
      if (d === undefined) return;
      e.preventDefault();
      select(tabs[(i + d + tabs.length) % tabs.length], true);
    });
  });
  list.closest('.tabs')?.classList.add('ready');
  select(tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0]);
}
