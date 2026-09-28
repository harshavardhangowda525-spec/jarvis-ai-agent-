/**
 * ULTRON's voice effect — deep, cold, a little metallic, in a dark room.
 *
 * Applied in the browser to ULTRON's text-to-speech audio (never to JARVIS,
 * EV or DARWIN), with the Web Audio API:
 *
 *   voice ─┬─ low-shelf boost ─ mud cut ─ soft saturation ─┬─ compressor ─ out
 *          ├─ ring modulator (metallic edge) ─ band-pass ──┤
 *          ├─ short modulated delay (doubled, "two voices") ┤
 *          └─────────────────── dark reverb ───────────────┘
 *
 * plus playing the clip a touch slower with the pitch allowed to drop, which
 * lowers the voice without any artefacts. Everything here is plain numbers or
 * pure functions so it's easy to tune; `buildUltronFx` wires the nodes.
 */

export const ULTRON_FX = {
  /** Clip speed with pitch allowed to fall: 0.9 ≈ 1.8 semitones deeper, 10% slower. */
  playbackRate: 0.9,
  lowShelf: { frequency: 170, gain: 6 },        // chest
  mudCut: { frequency: 420, q: 1.1, gain: -3 },   // keeps the lows from getting boomy
  presence: { frequency: 3200, q: 0.9, gain: 2.5 }, // consonants still cut through
  drive: 2.2,                                    // soft saturation (0 = clean)
  dry: 0.9,
  ring: { frequency: 42, mix: 0.16, bandHz: 1400 }, // metallic undertone
  doubler: { delayMs: 19, depthMs: 3, rateHz: 0.23, mix: 0.22 },
  reverb: { seconds: 1.9, decay: 3.2, mix: 0.2, lowpassHz: 3200 },
  compressor: { threshold: -20, ratio: 4, attack: 0.004, release: 0.2 },
  master: 0.95,
} as const;

/** A soft-clipping curve for the WaveShaper (tanh-like; 0 drive = straight line). */
export function saturationCurve(drive: number, n = 1024): Float32Array {
  const curve = new Float32Array(n);
  const k = Math.max(0, drive);
  const norm = k > 0 ? Math.tanh(k) : 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = k > 0 ? Math.tanh(k * x) / norm : x;
  }
  return curve;
}

/**
 * A dark, decaying impulse response for the reverb: stereo noise that fades
 * out, with the highs dying faster (seeded, so it's the same every time).
 */
export function darkImpulse(sampleRate: number, seconds: number, decay: number, seed = 7): [Float32Array, Float32Array] {
  const len = Math.max(1, Math.round(sampleRate * seconds));
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff * 2 - 1; };
  const out: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
  for (const ch of out) {
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const white = rand();
      // a one-pole low-pass whose cutoff falls over time → the tail gets darker
      const a = 0.15 + 0.8 * t;
      lp = lp + (1 - a) * (white - lp);
      ch[i] = lp * Math.pow(1 - t, decay);
    }
  }
  return out;
}

export interface UltronFxChain { input: AudioNode; output: AudioNode; stop: () => void }

/** Wire ULTRON's effect between `input` and the context's speakers. */
export function buildUltronFx(ctx: BaseAudioContext, fx = ULTRON_FX): UltronFxChain {
  const input = ctx.createGain();
  const out = ctx.createGain();
  out.gain.value = fx.master;

  // body: low shelf → mud cut → presence → saturation
  const shelf = ctx.createBiquadFilter();
  shelf.type = "lowshelf"; shelf.frequency.value = fx.lowShelf.frequency; shelf.gain.value = fx.lowShelf.gain;
  const mud = ctx.createBiquadFilter();
  mud.type = "peaking"; mud.frequency.value = fx.mudCut.frequency; mud.Q.value = fx.mudCut.q; mud.gain.value = fx.mudCut.gain;
  const presence = ctx.createBiquadFilter();
  presence.type = "peaking"; presence.frequency.value = fx.presence.frequency; presence.Q.value = fx.presence.q; presence.gain.value = fx.presence.gain;
  const shaper = ctx.createWaveShaper();
  shaper.curve = saturationCurve(fx.drive) as Float32Array<ArrayBuffer>;
  shaper.oversample = "2x";
  const dry = ctx.createGain(); dry.gain.value = fx.dry;
  input.connect(shelf).connect(mud).connect(presence).connect(shaper).connect(dry);

  // metallic edge: ring modulation (gain driven by a low sine), band-passed
  const ring = ctx.createGain(); ring.gain.value = 0;
  const carrier = ctx.createOscillator(); carrier.type = "sine"; carrier.frequency.value = fx.ring.frequency;
  carrier.connect(ring.gain);
  const band = ctx.createBiquadFilter(); band.type = "bandpass"; band.frequency.value = fx.ring.bandHz; band.Q.value = 0.8;
  const ringMix = ctx.createGain(); ringMix.gain.value = fx.ring.mix;
  input.connect(ring).connect(band).connect(ringMix);

  // doubler: a short delay whose time drifts → a second, slightly-off voice
  const delay = ctx.createDelay(0.1); delay.delayTime.value = fx.doubler.delayMs / 1000;
  const lfo = ctx.createOscillator(); lfo.frequency.value = fx.doubler.rateHz;
  const lfoDepth = ctx.createGain(); lfoDepth.gain.value = fx.doubler.depthMs / 1000;
  lfo.connect(lfoDepth).connect(delay.delayTime);
  const dblMix = ctx.createGain(); dblMix.gain.value = fx.doubler.mix;
  shaper.connect(delay).connect(dblMix);

  // dark room
  const conv = ctx.createConvolver();
  const [l, r] = darkImpulse(ctx.sampleRate, fx.reverb.seconds, fx.reverb.decay);
  const ir = ctx.createBuffer(2, l.length, ctx.sampleRate);
  ir.copyToChannel(l as Float32Array<ArrayBuffer>, 0); ir.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
  conv.buffer = ir;
  const verbTone = ctx.createBiquadFilter(); verbTone.type = "lowpass"; verbTone.frequency.value = fx.reverb.lowpassHz;
  const verbMix = ctx.createGain(); verbMix.gain.value = fx.reverb.mix;
  shaper.connect(conv).connect(verbTone).connect(verbMix);

  // glue
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = fx.compressor.threshold; comp.ratio.value = fx.compressor.ratio;
  comp.attack.value = fx.compressor.attack; comp.release.value = fx.compressor.release;
  for (const n of [dry, ringMix, dblMix, verbMix]) n.connect(comp);
  comp.connect(out);

  carrier.start(); lfo.start();
  return {
    input, output: out,
    stop: () => { try { carrier.stop(); lfo.stop(); } catch { /* already stopped */ } },
  };
}
