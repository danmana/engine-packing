/** Low rumble plus crackle, synthesised from noise. Starts on first use. */
export class Rumble {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crackle: GainNode | null = null;

  private noiseBuffer(ctx: AudioContext, brown: boolean) {
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = white;
    }
    return buf;
  }

  private init() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);

    const low = ctx.createBufferSource();
    low.buffer = this.noiseBuffer(ctx, true);
    low.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const lowGain = ctx.createGain();
    lowGain.gain.value = 1.4;
    low.connect(lp).connect(lowGain).connect(master);

    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noiseBuffer(ctx, false);
    hiss.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 650;
    bp.Q.value = 0.5;
    const crackle = ctx.createGain();
    crackle.gain.value = 0.1;
    hiss.connect(bp).connect(crackle).connect(master);

    low.start();
    hiss.start();
    this.ctx = ctx;
    this.master = master;
    this.crackle = crackle;
  }

  /** Call from a user gesture so the browser allows audio. */
  wake() {
    if (!this.enabled) return;
    this.init();
    void this.ctx?.resume();
  }

  update(thrust: number) {
    if (!this.ctx || !this.master || !this.crackle) return;
    const t = this.ctx.currentTime;
    const level = this.enabled ? Math.sqrt(thrust) * 0.55 : 0;
    this.master.gain.setTargetAtTime(level, t, 0.12);
    this.crackle.gain.setTargetAtTime(0.05 + Math.random() * 0.22, t, 0.02);
  }
}
