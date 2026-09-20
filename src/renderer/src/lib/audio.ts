class SoundPlayer {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /** Gentle two-tone chime when reminder starts (C5 -> E5). */
  playRestStart(volume = 0.6): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(Math.min(1, Math.max(0, volume)), now);
    master.connect(ctx.destination);

    // Tone 1: 523.25 Hz (C5)
    this.playTone(ctx, master, 523.25, now, 0.6);
    // Tone 2: 659.25 Hz (E5)
    this.playTone(ctx, master, 659.25, now + 0.16, 0.9);
  }

  /** Bright, peaceful completion triad when break finishes (C5 -> E5 -> G5 -> C6). */
  playRestComplete(volume = 0.6): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(Math.min(1, Math.max(0, volume)), now);
    master.connect(ctx.destination);

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      this.playTone(ctx, master, freq, now + i * 0.15, 1.4);
    });
  }

  private playTone(
    ctx: AudioContext,
    destination: AudioNode,
    freq: number,
    startTime: number,
    duration: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    // Warm, soft attack and exponential release
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.35, startTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(destination);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }
}

export const soundPlayer = new SoundPlayer();
