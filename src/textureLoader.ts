/**
 * 纹理加载器模块
 * 负责管理图片资源的加载和 GPU 纹理的创建，避免重复加载
 */

export interface LoadedTexture {
  textureIndex: number;
  bitmap: ImageBitmap;
}

export class TextureLoader {
  private device: GPUDevice;
  private textureArray: GPUTexture;
  private maxTextures: number;

  // 已加载的纹理缓存 (URL -> LoadedTexture)
  private loadedTextures = new Map<string, LoadedTexture>();

  // 正在加载的 Promise 缓存 (URL -> Promise)
  // 用于防止同一个 URL 被同时加载多次
  private loadingPromises = new Map<string, Promise<LoadedTexture>>();

  // 下一个可用的纹理索引
  private nextTextureIndex = 0;

  constructor(device: GPUDevice, textureArray: GPUTexture, maxTextures: number) {
    this.device = device;
    this.textureArray = textureArray;
    this.maxTextures = maxTextures;
  }

  /**
   * 加载纹理，如果已经加载或正在加载则返回缓存的结果
   * @param url 图片 URL
   * @returns LoadedTexture 对象
   */
  async loadTexture(url: string): Promise<LoadedTexture> {
    // 如果已经加载完成，直接返回
    if (this.loadedTextures.has(url)) {
      return this.loadedTextures.get(url)!;
    }

    // 如果正在加载中，返回正在进行的 Promise
    if (this.loadingPromises.has(url)) {
      return this.loadingPromises.get(url)!;
    }

    // 检查纹理数组是否已满
    if (this.nextTextureIndex >= this.maxTextures) {
      throw new Error(`Texture array is full. Maximum ${this.maxTextures} textures allowed.`);
    }

    // 创建新的加载 Promise
    const loadingPromise = this._loadTextureInternal(url);

    // 缓存这个 Promise，防止重复加载
    this.loadingPromises.set(url, loadingPromise);

    try {
      const result = await loadingPromise;
      // 加载完成后，从 loading 缓存中移除
      this.loadingPromises.delete(url);
      return result;
    } catch (error) {
      // 加载失败，从 loading 缓存中移除，以便下次可以重试
      this.loadingPromises.delete(url);
      throw error;
    }
  }

  /**
   * 内部加载实现
   */
  private async _loadTextureInternal(url: string): Promise<LoadedTexture> {
    try {
      // 获取当前的纹理索引
      const textureIndex = this.nextTextureIndex;

      // 加载图片
      const response = await fetch(url, { mode: 'cors' });
      const blob = await response.blob();
      const imageBitmap = await createImageBitmap(blob);

      // 将图片数据复制到 GPU 纹理数组
      this.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: this.textureArray, origin: [0, 0, textureIndex] }, [
        imageBitmap.width,
        imageBitmap.height,
      ]);

      // 创建 LoadedTexture 对象
      const loadedTexture: LoadedTexture = {
        bitmap: imageBitmap,
        textureIndex: textureIndex,
      };

      // 缓存加载结果
      this.loadedTextures.set(url, loadedTexture);

      // 递增纹理索引
      this.nextTextureIndex++;

      console.log(`Texture loaded: ${url} -> index ${textureIndex}`);

      return loadedTexture;
    } catch (error) {
      console.error(`Failed to load texture: ${url}`, error);
      throw error;
    }
  }

  /**
   * 获取已加载的纹理信息
   */
  getLoadedTexture(url: string): LoadedTexture | undefined {
    return this.loadedTextures.get(url);
  }

  /**
   * 检查某个 URL 是否已加载
   */
  isLoaded(url: string): boolean {
    return this.loadedTextures.has(url);
  }

  /**
   * 检查某个 URL 是否正在加载中
   */
  isLoading(url: string): boolean {
    return this.loadingPromises.has(url);
  }

  /**
   * 获取已加载的纹理数量
   */
  getLoadedCount(): number {
    return this.loadedTextures.size;
  }

  /**
   * 获取下一个可用的纹理索引
   */
  getNextTextureIndex(): number {
    return this.nextTextureIndex;
  }

  /**
   * 清理所有缓存（如果需要重置）
   */
  clear() {
    this.loadedTextures.clear();
    this.loadingPromises.clear();
    this.nextTextureIndex = 0;
  }
}
