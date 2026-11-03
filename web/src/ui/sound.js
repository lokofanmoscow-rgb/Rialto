// Простые синтезированные звуки (WebAudio), без внешних файлов.
let ctx = null;
let enabled = true;
try { enabled = localStorage.getItem('rialto.sound') !== '0'; } catch (e) { /* нет хранилища */ }

export function setSound(on) {
  enabled = on;
  try { localStorage.setItem('rialto.sound', on ? '1' : '0'); } catch (e) { /* ignore */ }
}
export function soundOn() { return enabled; }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, type = 'sine', vol = 0.15, delay = 0, slide = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.2, delay = 0, freq = 2500) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export function sfx(name) {
  if (!enabled) return;
  try {
    switch (name) {
      case 'dice':
        for (let k = 0; k < 7; k++) noise(0.05, 0.35, k * 0.09 + Math.random() * 0.03, 1800 + Math.random() * 1500);
        break;
      case 'step': tone(520 + Math.random() * 60, 0.06, 'triangle', 0.06); break;
      case 'coin': tone(1320, 0.09, 'square', 0.04); tone(1760, 0.14, 'square', 0.04, 0.07); break;
      case 'card': noise(0.18, 0.15, 0, 4000); break;
      case 'click': tone(800, 0.04, 'triangle', 0.05); break;
      case 'turn': tone(660, 0.12, 'sine', 0.1); tone(880, 0.18, 'sine', 0.1, 0.1); break;
      case 'bad': tone(300, 0.25, 'sawtooth', 0.06, 0, 0.6); break;
      case 'fanfare':
        [523, 659, 784, 1046].forEach((f, k) => tone(f, 0.3, 'triangle', 0.12, k * 0.12));
        break;
    }
  } catch (e) { /* звук недоступен */ }
}
