/**
 * Native Web Audio API Procedural Sound Engine
 * Zero external audio assets. Synthesizes all sounds in real-time.
 */
export class SoundFX {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isMuted: boolean = false;
  private noiseBuffer: AudioBuffer | null = null;

  constructor() {
    // Check stored mute preference
    const storedMute = localStorage.getItem('mental_defrag_muted');
    if (storedMute !== null) {
      this.isMuted = storedMute === 'true';
    }
  }

  /**
   * Initialize or resume the AudioContext on user interaction
   */
  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) {
        return null;
      }
      this.ctx = new AudioCtxClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 1, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Pre-generate noise buffer for fast click playback
      this.createNoiseBuffer();
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  /**
   * Pre-generates 20ms of white noise for the damped click
   */
  private createNoiseBuffer(): void {
    if (!this.ctx) return;
    const duration = 0.02; // 20ms
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
  }

  /**
   * Spawn sound: Short, warm sine-wave sweep (300Hz to 650Hz over 70ms)
   */
  public playSpawn(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const duration = 0.07; // 70ms

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(650, now + duration);

    // Warm, click-free amplitude envelope
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + duration + 0.005);
  }

  /**
   * Drag/Collision tick: Subtle high-damped click using a band-pass noise burst
   */
  public playClick(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;

    const now = ctx.currentTime;
    const duration = 0.02; // 20ms

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;

    // Band-pass filter around 1400Hz with sharp Q for damped acoustic click
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.Q.setValueAtTime(4.0, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noiseSource.start(now);
    noiseSource.stop(now + duration);
  }

  /**
   * Defrag burst: Low-frequency resonant pulse (140Hz decaying to 45Hz) with exponential gain falloff
   */
  public playDefrag(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const duration = 0.38; // ~380ms

    // Primary resonant pulse
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + duration);

    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + duration + 0.01);

    // Deep sub-harmonic warmth
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();

    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(70, now);
    subOsc.frequency.exponentialRampToValueAtTime(32, now + duration * 0.85);

    subGain.gain.setValueAtTime(0.18, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.85);

    subOsc.connect(subGain);
    subGain.connect(this.masterGain);

    subOsc.start(now);
    subOsc.stop(now + duration * 0.85 + 0.01);
  }

  /**
   * Toggle mute state and return new muted status
   */
  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    localStorage.setItem('mental_defrag_muted', String(this.isMuted));

    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 1, this.ctx.currentTime);
    }
    return this.isMuted;
  }

  /**
   * Get current mute state
   */
  public getIsMuted(): boolean {
    return this.isMuted;
  }
}

export const soundFX = new SoundFX();
