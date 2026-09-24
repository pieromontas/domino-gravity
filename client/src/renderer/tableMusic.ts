/**
 * Dominican patio bachata playlist — two royalty-free Pixabay MP3s with a
 * seamless A↔B crossfade. Tracks are bundled with the game only (not
 * redistributed as standalone downloads). Pixabay Content License:
 * commercial/game use OK, attribution not required.
 *
 * - Bachata Street by MiguelBono
 *   https://pixabay.com/music/acoustic-group-bachata-street-381811/
 * - Bajo la Luna Bailando by susan-lu4esm
 *   https://pixabay.com/music/bachata-bajo-la-luna-bailando-461721/
 */

export const STORAGE_MUTED = 'dg-patio-music-muted';
export const STORAGE_VOLUME = 'dg-patio-music-volume';
export const DEFAULT_VOLUME = 0.22;
export const CROSSFADE_SECONDS = 3;

export const PATIO_TRACKS = [
  {
    url: '/audio/bachata-street.mp3',
    title: 'Bachata Street',
    artist: 'MiguelBono'
  },
  {
    url: '/audio/bajo-la-luna-bailando.mp3',
    title: 'Bajo la Luna Bailando',
    artist: 'susan-lu4esm'
  }
] as const;

/** Seconds before the end of a track to start fading in the other. */
export function fadeLeadIn(duration: number, crossfade = CROSSFADE_SECONDS): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(crossfade, duration / 2);
}

export function nextTrackIndex(current: number, count = PATIO_TRACKS.length): number {
  return ((current % count) + 1) % count;
}

type TrackSlot = {
  element: HTMLAudioElement;
  gain: GainNode;
};

class TableMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private slots: TrackSlot[] = [];
  private sources: MediaElementAudioSourceNode[] = [];
  private current = 0;
  private playing = false;
  private muted = true;
  private volume = DEFAULT_VOLUME;
  private watchTimer: number | null = null;
  private fadeTimer: number | null = null;
  private fading = false;
  private graphReady = false;

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
    if (this.muted) {
      this.pauseAll();
      this.disarmWatch();
      return;
    }
    this.ensureContext();
    this.ensureGraph();
    if (this.playing) void this.resumeOrStart();
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
   * Start the playlist when the DR table is active. Safe to call repeatedly.
   * Stays silent until the player unmutes (default OFF so it never fights voice chat).
   */
  public start() {
    this.playing = true;
    this.ensureContext();
    this.ensureGraph();
    this.applyGain();
    if (this.muted) return;
    void this.resumeOrStart();
  }

  public stop() {
    this.playing = false;
    this.fading = false;
    this.disarmWatch();
    if (this.fadeTimer != null) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.pauseAll();
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

  private ensureGraph() {
    if (this.graphReady || !this.ctx || !this.master) return;
    for (const track of PATIO_TRACKS) {
      const element = new Audio(track.url);
      element.preload = 'auto';
      element.loop = false;
      element.crossOrigin = 'anonymous';
      element.volume = 1;
      const source = this.ctx.createMediaElementSource(element);
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.master);
      this.sources.push(source);
      this.slots.push({ element, gain });
    }
    this.graphReady = true;
  }

  private applyGain() {
    if (!this.master || !this.ctx) return;
    const target = this.playing && !this.muted ? this.volume : 0;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04);
  }

  private pauseAll() {
    for (const slot of this.slots) {
      slot.element.pause();
      slot.gain.gain.cancelScheduledValues(0);
      slot.gain.gain.value = 0;
    }
    this.fading = false;
  }

  private activeSlot(): TrackSlot | null {
    return this.slots[this.current] ?? null;
  }

  private async resumeOrStart() {
    this.ensureContext();
    this.ensureGraph();
    if (!this.ctx || this.muted || !this.playing) return;
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        return;
      }
    }

    const slot = this.activeSlot();
    if (!slot) return;

    const el = slot.element;
    const nearEnd = Number.isFinite(el.duration)
      && el.duration > 0
      && el.currentTime >= el.duration - 0.2;

    if (!el.paused && !el.ended) {
      this.armWatch();
      return;
    }

    if (el.currentTime > 0 && !el.ended && !nearEnd) {
      try {
        await el.play();
      } catch {
        return;
      }
      if (slot.gain.gain.value < 0.01) {
        slot.gain.gain.setValueAtTime(1, this.ctx.currentTime);
      }
      this.armWatch();
      return;
    }

    await this.beginPlayback(false);
  }

  private async beginPlayback(fadeIn: boolean) {
    if (!this.ctx || this.muted || !this.playing) return;
    const slot = this.activeSlot();
    if (!slot) return;

    this.fading = fadeIn;
    slot.element.currentTime = 0;
    try {
      await slot.element.play();
    } catch {
      this.fading = false;
      return;
    }

    const now = this.ctx.currentTime;
    slot.gain.gain.cancelScheduledValues(now);
    if (fadeIn) {
      slot.gain.gain.setValueAtTime(0, now);
      slot.gain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SECONDS);
    } else {
      slot.gain.gain.setValueAtTime(1, now);
    }

    this.armWatch();
  }

  private armWatch() {
    if (this.watchTimer != null) return;
    this.watchTimer = window.setInterval(() => this.watch(), 250);
  }

  private disarmWatch() {
    if (this.watchTimer != null) {
      window.clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  private watch() {
    if (!this.playing || this.muted || this.fading) return;
    const slot = this.activeSlot();
    if (!slot) return;
    const { element } = slot;
    const duration = element.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    const lead = fadeLeadIn(duration);
    const remaining = duration - element.currentTime;
    if (remaining <= lead || element.ended) {
      void this.crossfadeToNext();
    }
  }

  private async crossfadeToNext() {
    if (!this.ctx || this.fading || this.muted || !this.playing) return;
    const from = this.slots[this.current];
    const next = nextTrackIndex(this.current);
    const to = this.slots[next];
    if (!from || !to) return;

    this.fading = true;
    this.current = next;

    to.element.currentTime = 0;
    try {
      await to.element.play();
    } catch {
      this.fading = false;
      return;
    }

    const now = this.ctx.currentTime;
    const fade = fadeLeadIn(from.element.duration);
    from.gain.gain.cancelScheduledValues(now);
    from.gain.gain.setValueAtTime(from.gain.gain.value, now);
    from.gain.gain.linearRampToValueAtTime(0, now + fade);

    to.gain.gain.cancelScheduledValues(now);
    to.gain.gain.setValueAtTime(0, now);
    to.gain.gain.linearRampToValueAtTime(1, now + fade);

    if (this.fadeTimer != null) window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      from.element.pause();
      from.element.currentTime = 0;
      from.gain.gain.setValueAtTime(0, this.ctx?.currentTime ?? 0);
      this.fading = false;
      this.fadeTimer = null;
    }, fade * 1000);
  }
}

export const tableMusic = new TableMusic();
