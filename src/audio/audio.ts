// Procedural WebAudio engine: no audio assets, all synthesized. Modular + pooled.
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private step = 0;
  muted = false;
  volume = 0.8;

  ensure(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.master);
    } catch { this.ctx = null; }
  }

  setVolume(v: number): void { this.volume = v; if (this.master && this.ctx) this.master.gain.value = this.muted ? 0 : v; }
  toggleMute(): boolean { this.muted = !this.muted; this.setVolume(this.volume); return this.muted; }

  private env(g: GainNode, t: number, peak: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0002, t + decay);
  }

  private osc(type: OscillatorType, freq: number, freqEnd: number, dur: number, peak: number, dest?: AudioNode): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t + dur);
    this.env(g, t, peak, dur);
    o.connect(g); g.connect(dest ?? this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private noise(dur: number, peak: number, filterFreq: number, type: BiquadFilterType = 'lowpass'): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain(); this.env(g, t, peak, dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }

  footstep(run: boolean): void { this.noise(run ? 0.09 : 0.06, run ? 0.25 : 0.14, run ? 900 : 600); }
  jump(): void { this.noise(0.12, 0.15, 700); }
  land(hard: boolean): void { this.noise(hard ? 0.22 : 0.12, hard ? 0.4 : 0.2, hard ? 500 : 700); this.osc('sine', 120, 45, 0.18, hard ? 0.3 : 0.15); }
  swoosh(): void { this.noise(0.16, 0.3, 3200, 'bandpass'); }
  clash(): void { this.osc('square', 2400, 900, 0.2, 0.16); this.noise(0.14, 0.3, 5200, 'highpass'); }
  parry(): void { this.osc('triangle', 1800, 2600, 0.16, 0.25); this.noise(0.1, 0.22, 6000, 'highpass'); }
  hit(): void { this.osc('sawtooth', 220, 60, 0.2, 0.3); this.noise(0.12, 0.28, 1200); }
  assassinate(): void { this.noise(0.3, 0.2, 900); this.osc('sine', 300, 60, 0.35, 0.3); }
  alert(): void { this.osc('sawtooth', 660, 880, 0.28, 0.22); this.osc('sawtooth', 440, 587, 0.28, 0.18); }
  suspicious(): void { this.osc('sine', 520, 660, 0.2, 0.16); }
  pickup(): void { this.osc('sine', 660, 990, 0.12, 0.2); }
  ui(): void { this.osc('sine', 880, 880, 0.06, 0.12); }
  vault(): void { this.noise(0.1, 0.16, 1000); }

  /** Dark ambient loop: bass pulse + hats, timer-based (cheap). */
  startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    const tick = (): void => {
      if (!this.ctx || !this.musicGain || this.muted) return;
      const seq = [55, 55, 65.4, 49];
      const n = seq[this.step % seq.length];
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = n;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0002, t + 0.5);
      o.connect(f); f.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + 0.6);
      this.step++;
    };
    this.musicTimer = window.setInterval(tick, 420);
  }
  stopMusic(): void { if (this.musicTimer !== null) { clearInterval(this.musicTimer); this.musicTimer = null; } }
}
