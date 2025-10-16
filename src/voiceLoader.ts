export class VoiceLoader {
  private pathTemplate: string;
  private totalCount: number;
  private initialLoadCount: number;

  // 已加载的音频缓存 Map<index, AudioBuffer>
  private loadedAudios: Map<number, AudioBuffer> = new Map();
  // 待播放音频列表（索引）
  private pendingQueue: number[] = [];
  // 正在加载的音频索引
  private loading: Set<number> = new Set();
  // 音频上下文
  private audioContext: AudioContext;

  /**
   * @param pathTemplate 音频路径模板，使用 {index} 作为占位符，例如 '/audio/voice_{index}.mp3'
   * @param totalCount 音频总数
   * @param initialLoadCount 初始加载的音频数量
   * @param audioContext WebAudio 上下文
   */
  constructor(pathTemplate: string, totalCount: number, initialLoadCount: number, audioContext: AudioContext) {
    this.pathTemplate = pathTemplate;
    this.totalCount = totalCount;
    this.initialLoadCount = Math.min(initialLoadCount, totalCount);
    this.audioContext = audioContext;

    // 初始化时随机加载 n 个音频
    this.loadInitialAudios();
  }

  private async loadInitialAudios() {
    const indices = this.getRandomIndices(this.totalCount, this.initialLoadCount);
    await Promise.all(indices.map((index) => this.loadAudio(index)));
  }

  /**
   * 从范围 [0, max) 中随机选择 count 个不重复的索引
   */
  private getRandomIndices(max: number, count: number): number[] {
    const indices: number[] = [];
    const available = Array.from({ length: max }, (_, i) => i);

    for (let i = 0; i < count; i++) {
      const randomIdx = Math.floor(Math.random() * available.length);
      indices.push(available[randomIdx]);
      available.splice(randomIdx, 1);
    }

    return indices;
  }

  /**
   * 加载指定索引的音频
   */
  private async loadAudio(index: number): Promise<void> {
    if (this.loadedAudios.has(index) || this.loading.has(index)) {
      return; // 已加载或正在加载
    }

    this.loading.add(index);
    const url = this.pathTemplate.replace('{index}', index.toString());

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      this.loadedAudios.set(index, audioBuffer);
      this.pendingQueue.push(index);
    } catch (error) {
      console.error(`Failed to load audio ${url}:`, error);
    } finally {
      this.loading.delete(index);
    }
  }

  /**
   * 尝试加载一个未加载的音频
   */
  private async tryLoadNextAudio(): Promise<void> {
    if (this.loadedAudios.size >= this.totalCount) {
      return; // 所有音频都已加载
    }

    // 找到一个未加载的索引
    for (let i = 0; i < this.totalCount; i++) {
      if (!this.loadedAudios.has(i) && !this.loading.has(i)) {
        await this.loadAudio(i);
        break;
      }
    }
  }

  /**
   * 重新填充待播放队列
   */
  private refillQueue() {
    if (this.loadedAudios.size === 0) {
      return;
    }

    // 用所有已加载的音频重新填充队列
    this.pendingQueue = Array.from(this.loadedAudios.keys());
  }

  /**
   * 消费一个音频：从待播放列表中随机取出一个，并尝试加载新音频
   * @returns AudioBuffer 或 null（如果没有可用音频）
   */
  public consumeAudio(): AudioBuffer | null {
    // 如果队列为空，重新填充
    if (this.pendingQueue.length === 0) {
      this.refillQueue();
    }

    if (this.pendingQueue.length === 0) {
      return null; // 仍然没有可用音频
    }

    // 随机选择一个
    const randomIdx = Math.floor(Math.random() * this.pendingQueue.length);
    const audioIndex = this.pendingQueue[randomIdx];

    // 从队列中移除
    this.pendingQueue.splice(randomIdx, 1);

    // 尝试加载一个新音频（异步，不阻塞）
    this.tryLoadNextAudio();

    return this.loadedAudios.get(audioIndex) || null;
  }

  /**
   * 获取已加载的音频数量
   */
  public getLoadedCount(): number {
    return this.loadedAudios.size;
  }

  /**
   * 获取待播放队列长度
   */
  public getPendingCount(): number {
    return this.pendingQueue.length;
  }
}
