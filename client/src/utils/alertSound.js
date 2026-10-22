// A short, urgent two-tone beep, generated with the Web Audio API rather
// than an audio file — one less asset to bundle/cache, and it still works
// with no network at all, consistent with the rest of this app's offline-
// first approach.
let audioCtx = null;

function getContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

function beep(ctx, startTime, frequency, duration) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(frequency, startTime);
  // Quick fade in/out avoids an audible click at the start/end of each beep.
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

// Best-effort: browsers block audio before the user has interacted with the
// page at all. By the time a poll surfaces a real alert, the person has
// almost always clicked something already — but if this fails, the toast
// itself (Phase 2) still shows, so a blocked sound is never the only signal.
export function playAlertSound() {
  try {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    // Two urgent high-low beeps, like a basic siren pulse.
    beep(ctx, now, 880, 0.18);
    beep(ctx, now + 0.22, 660, 0.18);
  } catch {
    // No audio support / blocked — the visual toast still carries the alert.
  }
}
