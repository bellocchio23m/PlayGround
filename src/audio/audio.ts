// Procedural WebAudio engine: no audio assets, all synthesized. Modular + pooled.
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private ambienceTimer: number | null = null;
  private ambienceNodes: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; lfo: OscillatorNode; lfoGain: GainNode } | null = null;
  private step = 0;
  muted = false;
  volume = 0.8;
  mood: 'stealth' | 'combat' | 'search' | 'escape' = 'stealth';
  // CENTRAL WIRING: central sets surface from ground material each frame (or on zone change),
  // then calls footstepAuto(run) instead of footstep(run, surface).
  // Mute persistence: central loads save.data.settings.muted → audio.muted → audio.applyMute();
  // toggling mute must also write back to save.data.settings.muted + save.save().
  // Wind: central calls whoosh(speed) per frame (sprint/parkour speed); speed<=0.5 stops (gain 0).
  surface: 'stone' | 'metal' | 'wood' = 'stone';
  private whooshNodes: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;

  setMood(m: 'stealth' | 'combat' | 'search' | 'escape'): void {
    if (this.mood !== m) { this.mood = m; this.step = 0; }
  }

  ensure(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.applyMute()).catch(() => undefined); this.applyMute(); return; }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.master);
    } catch { this.ctx = null; }
  }

  /** Enforce muted flag on master gain (central calls after loading save / toggling mute). */
  applyMute(): void {
    if (this.master && this.ctx) {
      try { this.master.gain.value = this.muted ? 0 : this.volume; } catch { /* ignore */ }
    }
    // whoosh routes through master (already muted), but zero its own gain too when muted
    if (this.muted && this.whooshNodes) {
      try { this.whooshNodes.gain.gain.value = 0; } catch { /* ignore */ }
    }
  }
  setVolume(v: number): void { this.volume = v; this.applyMute(); }
  toggleMute(): boolean { this.muted = !this.muted; this.applyMute(); return this.muted; }

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

  /** Central sets ground surface (UI/Audio/Save owns storage; detection lives in central/world). */
  setSurface(s: 'stone' | 'metal' | 'wood'): void { this.surface = s; }
  /** Footstep using stored surface (central calls after setSurface from ground material). */
  footstepAuto(run: boolean): void { this.footstep(run, this.surface); }
  footstep(run: boolean, surface: 'stone' | 'metal' | 'wood' = 'stone'): void {
    const cfg = {
      stone: { cut: run ? 900 : 600, peak: run ? 0.25 : 0.14 },
      metal: { cut: run ? 2400 : 1800, peak: run ? 0.2 : 0.11 },
      wood: { cut: run ? 500 : 380, peak: run ? 0.28 : 0.16 },
    }[surface];
    this.noise(run ? 0.09 : 0.06, cfg.peak, cfg.cut);
    if (surface === 'metal') this.osc('triangle', 1900, 1400, 0.07, 0.06);
    if (surface === 'wood') this.osc('sine', 180, 90, 0.09, 0.12);
  }
  jump(): void { this.noise(0.12, 0.15, 700); }
  land(hard: boolean): void { this.noise(hard ? 0.22 : 0.12, hard ? 0.4 : 0.2, hard ? 500 : 700); this.osc('sine', 120, 45, 0.18, hard ? 0.3 : 0.15); }
  swoosh(): void { this.noise(0.16, 0.3, 3200, 'bandpass'); }
  clash(): void { this.osc('square', 2400, 900, 0.2, 0.16); this.noise(0.14, 0.3, 5200, 'highpass'); }
  parry(): void { this.osc('triangle', 1800, 2600, 0.16, 0.25); this.noise(0.1, 0.22, 6000, 'highpass'); }
  hit(): void { this.osc('sawtooth', 220, 60, 0.2, 0.3); this.noise(0.12, 0.28, 1200); }
  assassinate(): void { this.noise(0.3, 0.2, 900); this.osc('sine', 300, 60, 0.35, 0.3); }
  alert(): void { this.osc('sawtooth', 660, 880, 0.28, 0.22); this.osc('sawtooth', 440, 587, 0.28, 0.18); }
  suspicious(): void { this.osc('sine', 520, 660, 0.2, 0.16); }
  /** Enemy voice barks: short procedural blips, distinct per kind (no assets). */
  bark(kind: 'alert' | 'suspicious' | 'attack' | 'down'): void {
    switch (kind) {
      case 'alert': this.osc('square', 700, 1050, 0.12, 0.2); this.osc('square', 700, 1050, 0.12, 0.16); break;
      case 'suspicious': this.osc('triangle', 420, 560, 0.18, 0.16); break;
      case 'attack': this.osc('sawtooth', 300, 140, 0.22, 0.26); this.noise(0.1, 0.2, 1400); break;
      case 'down': this.osc('sine', 380, 90, 0.4, 0.24); break;
    }
  }
  /** Detection stingers per state — distinct two-tone motifs from alert()/suspicious(). */
  sting(state: 'suspicious' | 'investigating' | 'combat' | 'lost'): void {
    switch (state) {
      case 'suspicious': this.osc('sine', 440, 554, 0.25, 0.18); this.osc('sine', 554, 659, 0.25, 0.14); break;
      case 'investigating': this.osc('triangle', 330, 392, 0.3, 0.18); this.osc('triangle', 392, 494, 0.3, 0.14); break;
      case 'combat': this.osc('sawtooth', 196, 392, 0.35, 0.24); this.osc('sawtooth', 147, 294, 0.35, 0.18); break;
      case 'lost': this.osc('sine', 659, 440, 0.3, 0.16); this.osc('sine', 440, 330, 0.3, 0.12); break;
    }
  }
  pickup(): void { this.osc('sine', 660, 990, 0.12, 0.2); }
  ui(): void { this.osc('sine', 880, 880, 0.06, 0.12); }
  vault(): void { this.noise(0.1, 0.16, 1000); }

  /** Dark ambient loop: bass pulse + hats. Tempo/character follow game mood. */
  startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    const tick = (): void => {
      if (!this.ctx || !this.musicGain || this.muted) return;
      // mood -> tempo + root movement (stealth sparse, combat driving)
      const cfg = {
        stealth: { gap: 560, seq: [55, 55, 65.4, 49], cut: 220, gain: 0.4 },
        search: { gap: 460, seq: [55, 58.3, 65.4, 58.3], cut: 300, gain: 0.5 },
        escape: { gap: 340, seq: [65.4, 73.4, 82.4, 98], cut: 420, gain: 0.55 },
        combat: { gap: 300, seq: [55, 55, 82.4, 73.4], cut: 520, gain: 0.65 },
      }[this.mood];
      const seq = cfg.seq;
      const n = seq[this.step % seq.length];
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = n;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cfg.cut;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(cfg.gain, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0002, t + 0.5);
      o.connect(f); f.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + 0.6);
      this.step++;
      if (this.musicTimer !== null) {
        clearInterval(this.musicTimer);
        this.musicTimer = window.setInterval(tick, cfg.gap);
      }
    };
    this.musicTimer = window.setInterval(tick, 560);
  }
  stopMusic(): void { if (this.musicTimer !== null) { clearInterval(this.musicTimer); this.musicTimer = null; } }

  /** Urban ambience: distant hum/traffic/wind loop via filtered noise + LFO. Cheap, idempotent, stoppable. */
  startAmbience(): void {
    if (!this.ctx || !this.master || this.ambienceTimer !== null || this.ambienceNodes) return;
    try {
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 240; filter.Q.value = 0.6;
      const gain = ctx.createGain();
      gain.gain.value = 0.05;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 0.13;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 90; // filter wobble ±90Hz (wind/traffic swell)
      lfo.connect(lfoGain); lfoGain.connect(filter.frequency);
      src.connect(filter); filter.connect(gain); gain.connect(this.master);
      src.start(); lfo.start();
      this.ambienceNodes = { src, filter, gain, lfo, lfoGain };
      // slow swell timer (single guarded interval): breathe the bed gain
      let t = 0;
      this.ambienceTimer = window.setInterval(() => {
        if (!this.ambienceNodes || this.muted) return;
        t += 0.8;
        this.ambienceNodes.gain.gain.value = 0.045 + Math.sin(t * 0.4) * 0.015;
      }, 800);
    } catch { this.ambienceNodes = null; }
  }
  stopAmbience(): void {
    if (this.ambienceTimer !== null) { clearInterval(this.ambienceTimer); this.ambienceTimer = null; }
    const n = this.ambienceNodes;
    this.ambienceNodes = null;
    if (!n) return;
    try {
      n.lfo.stop(); n.src.stop();
    } catch { /* already stopped */ }
    try {
      n.lfo.disconnect(); n.lfoGain.disconnect(); n.src.disconnect(); n.filter.disconnect(); n.gain.disconnect();
    } catch { /* already disconnected */ }
  }
  /** Sprint/parkour wind: filtered looped noise, gain by speed. Single persistent node (no leak). */
  whoosh(speed: number): void {
    if (!this.ctx || !this.master) return;
    const s = Number.isFinite(speed) ? speed : 0;
    if (this.muted || s <= 0.5) {
      if (this.whooshNodes) {
        try { this.whooshNodes.gain.gain.value = 0; } catch { /* ignore */ }
      }
      return;
    }
    try {
      if (!this.whooshNodes) {
        const ctx = this.ctx;
        const len = Math.max(1, Math.floor(ctx.sampleRate * 1));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass'; filter.frequency.value = 800; filter.Q.value = 0.7;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(filter); filter.connect(gain); gain.connect(this.master);
        src.start();
        this.whooshNodes = { src, filter, gain };
      }
      const g = Math.min(0.35, Math.max(0, s) * 0.03);
      this.whooshNodes.gain.gain.value = this.muted ? 0 : g;
      this.whooshNodes.filter.frequency.value = 500 + Math.min(2000, s * 120);
    } catch { /* ignore */ }
  }
  /** Background/visibility hooks (central calls on visibilitychange). Safe without ctx. Mute-aware: resume re-applies mute. */
  suspend(): void { try { void this.ctx?.suspend(); } catch { /* ignore */ } }
  resume(): void {
    try {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume().then(() => this.applyMute()).catch(() => undefined);
      }
    } catch { /* ignore */ }
    this.applyMute();
  }
}
