// Tone tuning: play test tones through this device's speaker, measure them
// with its microphone, and choose four tones that avoid weak spots.
const STEP_HZ = 300, MIN_SPACING_HZ = 600;

export async function measureTones(engine, { onProgress = () => {} } = {}) {
  const nyquist = engine.sampleRate / 2, rows = [];
  const candidates = [];
  for (let f = 15000; f <= 19800; f += STEP_HZ) if (f < nyquist - 600) candidates.push(f);
  await new Promise(r => setTimeout(r, 600));
  for (const f of candidates) {
    const playing = engine.playTone(f, 400, 0.10);
    await new Promise(r => setTimeout(r, 250)); // read while the tone is still playing
    const sp = engine.readSpectrum();
    await playing;
    let db = -120;
    if (sp) { const bin = Math.round(f / sp.sampleRate * sp.fftSize); db = sp.data[Math.min(sp.data.length - 1, Math.max(0, bin))]; }
    rows.push({ f, db: Math.round(db * 10) / 10 });
    onProgress(rows.length / candidates.length);
    await new Promise(r => setTimeout(r, 80));
  }
  return rows;
}

/**
 * Four tones at least 600 Hz apart whose weakest level is as high as possible.
 * Within 0.5 dB, higher (less audible) tones win.
 */
export function pickTones(rows) {
  const r = [...rows].sort((a, b) => a.f - b.f);
  let best = null;
  for (let a = 0; a < r.length; a++) for (let b = a + 1; b < r.length; b++)
    for (let c = b + 1; c < r.length; c++) for (let d = c + 1; d < r.length; d++) {
      const s = [r[a], r[b], r[c], r[d]];
      if (s[1].f - s[0].f < MIN_SPACING_HZ || s[2].f - s[1].f < MIN_SPACING_HZ || s[3].f - s[2].f < MIN_SPACING_HZ) continue;
      const worst = Math.min(...s.map(x => x.db)), sum = s.reduce((t, x) => t + x.f, 0);
      if (!best || worst > best.worst + 0.5 || (Math.abs(worst - best.worst) <= 0.5 && sum > best.sum)) best = { worst, sum, tones: s.map(x => x.f) };
    }
  return best ? best.tones : null;
}
