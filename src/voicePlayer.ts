import { VoiceLoader } from './voiceLoader';

export class VoicePlayer {
  private audioContext: AudioContext;
  private voiceLoader: VoiceLoader;
  private continuousInterval: number | null = null;
  private readonly CONTINUOUS_INTERVAL_MS = 800; // 持续发射间隔

  constructor(voiceLoader: VoiceLoader, audioContext: AudioContext) {
    this.voiceLoader = voiceLoader;
    this.audioContext = audioContext;
  }

  /**
   * 立即播放一次音频
   */
  public shotVoice(): void {
    const audioBuffer = this.voiceLoader.consumeAudio();
    if (!audioBuffer) {
      console.warn('No audio available to play');
      return;
    }

    this.playAudioBuffer(audioBuffer);
  }

  /**
   * 播放一个 AudioBuffer
   */
  private playAudioBuffer(audioBuffer: AudioBuffer): void {
    try {
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      source.start(0);
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  }

  /**
   * 开始持续发射音频（每 800ms 一次）
   */
  public startContinuousShot(): void {
    if (this.continuousInterval !== null) {
      return; // 已经在持续发射中
    }

    // 立即发射一次
    this.shotVoice();

    // 然后每隔 800ms 发射一次
    this.continuousInterval = window.setInterval(() => {
      this.shotVoice();
    }, this.CONTINUOUS_INTERVAL_MS);
  }

  /**
   * 停止持续发射音频
   */
  public stopContinuousShot(): void {
    if (this.continuousInterval !== null) {
      clearInterval(this.continuousInterval);
      this.continuousInterval = null;
    }
  }

  /**
   * 检查是否正在持续发射
   */
  public isContinuousShooting(): boolean {
    return this.continuousInterval !== null;
  }
}
