// Runs before the page draws: dark by default, or the visitor's own choice from the header switch.
// The choice stays in this browser only (localStorage); nothing is sent anywhere.
(() => {
  let saved = null;
  try { saved = localStorage.getItem('vinac-site-theme'); } catch { /* storage blocked */ }
  document.documentElement.dataset.theme = saved === 'light' ? 'light' : 'dark';
})();
