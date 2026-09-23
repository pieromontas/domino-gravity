/**
 * Original synthesized Caribbean patio loop for the DR table.
 * Not a recording, sample, or transcription of any commercial bachata track.
 * Güira-like scrape, bongo taps, and a short plucked ostinato — loopable and royalty-free.
 */
const STORAGE_MUTED = 'dg-patio-music-muted';
const STORAGE_VOLUME = 'dg-patio-music-volume';
const DEFAULT_VOLUME = 0.22;

class TableMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private playing = false;
  private muted = true;
  private volume = DEFAULT_VOLUME;
  private nextNoteTime = 0;
  private timer: number | null = null;
  private step = 0;
  private readonly bpm = 126;
  private readonly stepsPerBeat = 4;

  constructor() {
    try {
      const storedMute = localStorage.getItem(STORAGE_MUTED);
      if (storedMute === '0') this.muted = false;
      const storedVol = localStorage.getItem(STORAGE_VOLUME);
      if (storedVol != null) {
        const parsed = Number(storedVol);
        if (Number.isFinite(parsed)) this.volume = Math.min(0.6, Math.max(0, parsed));
      }
    } catch {
      // localStorage may be blocked in some embeds
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public getVolume(): number {
    return this.volume;
  }

  public isPlaying(): boolean {
    return this.playing && !this.muted;
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    this.persist();
    this.applyGain();
    if (this.playing && !this.muted) {
      this.ensureContext();
      if (this.timer == null) this.scheduleLoop();
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return !this.muted;
  }

  public setVolume(volume: number) {
    this.volume = Math.min(0.6, Math.max(0, volume));
    this.persist();
    this.applyGain();
  }

  /**
   * Start the loop when the DR table is active. Safe to call repeatedly.
   * Stays silent until the player unmutes (default OFF so it never fights voice chat).
   */
  public start() {
    this.playing = true;
    this.ensureContext();
    this.applyGain();
    if (this.muted || this.timer != null) return;
    this.scheduleLoop();
  }

  public stop() {
    this.playing = false;
    if (this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.applyGain();
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_MUTED, this.muted ? '1' : '0');
      localStorage.setItem(STORAGE_VOLUME, String(this.volume));
    } catch {
      // ignore
    }
  }

  private ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext
        || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  private applyGain() {
    if (!this.master || !this.ctx) return;
    const target = this.playing && !this.muted ? this.volume : 0;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04);
  }

  private scheduleLoop() {
    if (!this.ctx) return;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedulerTick(), 25);
  }

  private schedulerTick() {
    if (!this.ctx || !this.playing || this.muted) return;
    const secondsPerStep = 60 / this.bpm / this.stepsPerBeat;
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += secondsPerStep;
      this.step = (this.step + 1) % 16;
    }
  }

  private playStep(step: number, time: number) {
    if (!this.ctx || !this.master) return;
    const beat = step % 4;

    // Güira-like metallic scrape on every 16th, accented on the beat.
    this.scrape(time, beat === 0 ? 0.045 : 0.022);

    // Bongo tumbao suggestion: open tone on 1, slap on the "and" of 2, low on 4.
    if (step === 0) this.bongo(time, 210, 0.09);
    if (step === 6) this.bongo(time, 340, 0.06);
    if (step === 12) this.bongo(time, 165, 0.08);
    if (step === 14) this.bongo(time, 390, 0.04);

    // Original two-bar plucked ostinato (not a known melody).
    const guitar: Record<number, number> = {
      0: 220,
      2: 261.63,
      4: 329.63,
      8: 196,
      10: 246.94,
      12: 293.66
    };
    const freq = guitar[step];
    if (freq) this.pluck(time, freq, 0.045);
  }

  private scrape(time: number, gain: number) {
    if (!this.ctx || !this.master) return;
    const length = Math.floor(this.ctx.sampleRate * 0.035);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(4200, time);
    filter.Q.setValueAtTime(3.2, time);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(time);
    src.stop(time + 0.035);
  }

  private bongo(time: number, freq: number, gain: number) {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, time + 0.08);
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.11);
    osc.connect(g);
    g.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.12);
  }

  private pluck(time: number, freq: number, gain: number) {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    osc.connect(g);
    g.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.3);
  }
}

export const tableMusic = new TableMusic();
