import { IMAGE_URLS, MAX_PARTICLES, WORKGROUP_SIZE, TEXTURE_SIZE, DYNAMIC_PARTICLE_STRIDE, STATIC_PARTICLE_STRIDE } from './config';
import { computeWGSL, renderWGSL } from './shaders';
import { TextureLoader } from './textureLoader';
import { getClearColorFromCSS } from './themeUtils';

export class WebGPURenderer {
    private canvas: HTMLCanvasElement;
    private button: HTMLButtonElement;

    private adapter!: GPUAdapter;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;

    private computePipeline!: GPUComputePipeline;
    private renderPipeline!: GPURenderPipeline;

    // 动态数据缓冲区（双缓冲，用于乒乓交换）
    private dynamicBuffers!: [GPUBuffer, GPUBuffer];
    // 静态数据缓冲区（只写入一次）
    private staticBuffer!: GPUBuffer;
    private uniformsBuffer!: GPUBuffer;
    private textureArray!: GPUTexture;
    private sampler!: GPUSampler;

    private computeBindGroups!: [GPUBindGroup, GPUBindGroup];
    private renderBindGroup!: GPUBindGroup;

    private particleCount = 0;
    private textureLoader!: TextureLoader;
    private frame = 0;
    private lastTime = 0;
    // RGBA clear color normalized to [0,1]
    private clearColor: [number, number, number, number] = [0.05, 0.05, 0.05, 1.0];

    // FPS tracking
    private fpsFrames = 0;
    private fpsLastTime = 0;
    private currentFPS = 0;
    private fpsOverlay?: HTMLDivElement;

    // Public setter/getter so app can override clear color if needed.
    public setClearColor(r: number, g: number, b: number, a = 1.0) {
        const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
        this.clearColor = [clamp(r), clamp(g), clamp(b), clamp(a)];
    }
    public getClearColor(): [number, number, number, number] {
        return this.clearColor.slice() as [number, number, number, number];
    }

    constructor(canvas: HTMLCanvasElement, button: HTMLButtonElement) {
        this.canvas = canvas;
        this.button = button;
    }

    public async init(): Promise<boolean> {
        if (!navigator.gpu) return false;

        this.adapter = (await navigator.gpu.requestAdapter())!;
        this.device = await this.adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu')!;
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();

        this.configureCanvas();
        window.addEventListener('resize', () => this.configureCanvas());

        this.createAssets();
        this.createPipelines();

        // Initialize clear color from CSS variables and listen for theme changes
        try {
            const c = getClearColorFromCSS();
            this.clearColor = c;
        } catch (e) {
            // keep default
        }
        try {
            const mql = window.matchMedia('(prefers-color-scheme: dark)');
            if (typeof mql.addEventListener === 'function') {
                mql.addEventListener('change', () => {
                    try { this.clearColor = getClearColorFromCSS(); } catch (e) {}
                });
            } else if (typeof (mql as any).addListener === 'function') {
                // fallback for older browsers
                (mql as any).addListener(() => { try { this.clearColor = getClearColorFromCSS(); } catch (e) {} });
            }
        } catch (e) {
            // ignore if matchMedia is unavailable
        }

        this.createFPSOverlay();
        return true;
    }

    private createFPSOverlay() {
        this.fpsOverlay = document.createElement('div');
        this.fpsOverlay.id = 'fps-overlay';
        this.fpsOverlay.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.7);
            color: #0f0;
            padding: 8px 12px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            border-radius: 4px;
            z-index: 9999;
            display: none;
            pointer-events: none;
        `;
        this.fpsOverlay.textContent = 'FPS: --';
        document.body.appendChild(this.fpsOverlay);
    }

    public toggleFPS(show?: boolean) {
        if (!this.fpsOverlay) return;
        if (show === undefined) {
            this.fpsOverlay.style.display = this.fpsOverlay.style.display === 'none' ? 'block' : 'none';
        } else {
            this.fpsOverlay.style.display = show ? 'block' : 'none';
        }
    }

    public getFPS(): number {
        return this.currentFPS;
    }

    private configureCanvas(): void {
        const devicePixelRatio = window.devicePixelRatio || 1;
        const clientWidth = this.canvas.clientWidth;
        const clientHeight = this.canvas.clientHeight;
        
        // 设置物理像素尺寸
        this.canvas.width = Math.floor(clientWidth * devicePixelRatio);
        this.canvas.height = Math.floor(clientHeight * devicePixelRatio);
        
        this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: 'premultiplied',
        });
    }

    private createAssets() {
        // 动态数据缓冲区（双缓冲）
        this.dynamicBuffers = [
            this.device.createBuffer({
                size: MAX_PARTICLES * DYNAMIC_PARTICLE_STRIDE,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            }),
            this.device.createBuffer({
                size: MAX_PARTICLES * DYNAMIC_PARTICLE_STRIDE,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            }),
        ];

        // 静态数据缓冲区（只写入一次）
        this.staticBuffer = this.device.createBuffer({
            size: MAX_PARTICLES * STATIC_PARTICLE_STRIDE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        // Uniforms: deltaTime(f32), particleCount(u32), aspectRatio(f32), zoomScale(f32) = 16 bytes
        this.uniformsBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Texture and Sampler
        this.textureArray = this.device.createTexture({
            size: [TEXTURE_SIZE, TEXTURE_SIZE, IMAGE_URLS.length],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

        // 初始化纹理加载器
        this.textureLoader = new TextureLoader(
            this.device,
            this.textureArray,
            IMAGE_URLS.length
        );
    }

    // ...parsing helpers moved to src/themeUtils.ts

    // ...clear color logic moved to src/themeUtils.ts

    private createPipelines() {
        const computeShaderModule = this.device.createShaderModule({ code: computeWGSL });
        const renderShaderModule = this.device.createShaderModule({ code: renderWGSL });

        // Compute Pipeline
        const computeBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // dynamic_in
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },          // dynamic_out
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // static_data
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },          // uniforms
            ],
        });
        this.computePipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] }),
            compute: { module: computeShaderModule, entryPoint: 'main' },
        });

        // Render Pipeline
        const renderBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
                { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            ],
        });
        this.renderPipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
            vertex: {
                module: renderShaderModule,
                entryPoint: 'vs_main',
                buffers: [
                    {
                        // 动态数据
                        arrayStride: DYNAMIC_PARTICLE_STRIDE,
                        stepMode: 'instance',
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x2' },  // pos
                            { shaderLocation: 1, offset: 8, format: 'float32x2' },  // vel
                            { shaderLocation: 2, offset: 16, format: 'float32' },   // rotation
                        ],
                    },
                    {
                        // 静态数据
                        arrayStride: STATIC_PARTICLE_STRIDE,
                        stepMode: 'instance',
                        attributes: [
                            { shaderLocation: 3, offset: 0, format: 'float32' },    // scale
                            { shaderLocation: 4, offset: 4, format: 'float32' },    // aspectRatio
                            { shaderLocation: 5, offset: 8, format: 'float32' },    // angularVel
                            { shaderLocation: 6, offset: 12, format: 'uint32' },    // texIndex
                            { shaderLocation: 7, offset: 16, format: 'float32x2' }, // uvScale
                        ],
                    },
                ],
            },
            fragment: {
                module: renderShaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: this.presentationFormat }],
            },
            primitive: { topology: 'triangle-list' },
        });

        // Bind Groups for Compute (双缓冲乒乓交换)
        this.computeBindGroups = [
            this.device.createBindGroup({
                layout: computeBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.dynamicBuffers[0] } },
                    { binding: 1, resource: { buffer: this.dynamicBuffers[1] } },
                    { binding: 2, resource: { buffer: this.staticBuffer } },
                    { binding: 3, resource: { buffer: this.uniformsBuffer } },
                ],
            }),
            this.device.createBindGroup({
                layout: computeBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.dynamicBuffers[1] } },
                    { binding: 1, resource: { buffer: this.dynamicBuffers[0] } },
                    { binding: 2, resource: { buffer: this.staticBuffer } },
                    { binding: 3, resource: { buffer: this.uniformsBuffer } },
                ],
            }),
        ];

        this.renderBindGroup = this.device.createBindGroup({
            layout: renderBindGroupLayout,
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.textureArray.createView() },
                { binding: 2, resource: { buffer: this.uniformsBuffer } },
            ],
        });
    }

    public async addParticle() {
        if (this.particleCount >= MAX_PARTICLES) return;

        let cnt = Math.round(Math.random() * 3 + 2.5);
        while (cnt-- > 0) {
            const imageIndex = Math.floor(Math.random() * IMAGE_URLS.length);
            const url = IMAGE_URLS[imageIndex];

            try {
                const texture = await this.textureLoader.loadTexture(url);

                // 动态数据：pos, vel, rotation, padding
                const dynamicData = new Float32Array(DYNAMIC_PARTICLE_STRIDE / 4);
                const velSpeed = (Math.random() + 1) * 0.5;
                const velAngle = Math.random() * 2 * Math.PI;
                dynamicData[0] = 0.0; // pos.x
                dynamicData[1] = 0.0; // pos.y
                dynamicData[2] = Math.cos(velAngle) * velSpeed; // vel.x
                dynamicData[3] = Math.sin(velAngle) * velSpeed; // vel.y
                dynamicData[4] = 0.0; // rotation
                dynamicData[5] = 0.0; // padding

                // 静态数据：scale, aspectRatio, angularVel, texIndex, uvScale, padding
                const staticData = new Float32Array(STATIC_PARTICLE_STRIDE / 4);
                staticData[0] = 0.3; // scale
                staticData[1] = texture.bitmap.width / texture.bitmap.height; // aspectRatio
                staticData[2] = (Math.random() - 0.5) * 5.0; // angularVel
                const u32View = new Uint32Array(staticData.buffer);
                u32View[3] = texture.textureIndex; // texIndex (as u32)
                staticData[4] = texture.bitmap.width / TEXTURE_SIZE;  // uvScale.x
                staticData[5] = texture.bitmap.height / TEXTURE_SIZE; // uvScale.y
                staticData[6] = 0.0; // padding
                staticData[7] = 0.0; // padding

                // 写入动态数据到两个缓冲区（初始状态相同）
                this.device.queue.writeBuffer(
                    this.dynamicBuffers[0],
                    this.particleCount * DYNAMIC_PARTICLE_STRIDE,
                    dynamicData.buffer
                );
                this.device.queue.writeBuffer(
                    this.dynamicBuffers[1],
                    this.particleCount * DYNAMIC_PARTICLE_STRIDE,
                    dynamicData.buffer
                );

                // 写入静态数据（只写一次）
                this.device.queue.writeBuffer(
                    this.staticBuffer,
                    this.particleCount * STATIC_PARTICLE_STRIDE,
                    staticData.buffer
                );

                this.particleCount++;
                this.button.textContent = `更多珠珠 (${this.particleCount})`;
            } catch (error) {
                console.error('Failed to add particle:', error);
            }
        }
    }

    private renderLoop = () => {
        const now = performance.now();
        const deltaTime = this.lastTime > 0 ? Math.min(0.1, (now - this.lastTime) / 1000.0) : 0.016;
        this.lastTime = now;

        // Update FPS
        this.fpsFrames++;
        if (now - this.fpsLastTime >= 1000) {
            this.currentFPS = Math.round((this.fpsFrames * 1000) / (now - this.fpsLastTime));
            if (this.fpsOverlay && this.fpsOverlay.style.display !== 'none') {
                this.fpsOverlay.textContent = `FPS: ${this.currentFPS}`;
            }
            this.fpsFrames = 0;
            this.fpsLastTime = now;
        }

        // 更新 uniforms：deltaTime, particleCount, aspectRatio, padding
        const uniformsData = new Float32Array(4);
        uniformsData[0] = deltaTime;
        const u32View = new Uint32Array(uniformsData.buffer);
        u32View[1] = this.particleCount;
        uniformsData[2] = this.canvas.clientWidth / this.canvas.clientHeight; // aspectRatio (CSS 像素)
        uniformsData[3] = 0.0; // padding
        this.device.queue.writeBuffer(this.uniformsBuffer, 0, uniformsData.buffer);

        const commandEncoder = this.device.createCommandEncoder();

        if (this.particleCount > 0) {
            const computePass = commandEncoder.beginComputePass();
            computePass.setPipeline(this.computePipeline);
            computePass.setBindGroup(0, this.computeBindGroups[this.frame % 2]);
            computePass.dispatchWorkgroups(Math.ceil(this.particleCount / WORKGROUP_SIZE));
            computePass.end();
        }

        const [r, g, b, a] = this.clearColor;
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r, g, b, a },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });

        if (this.particleCount > 0) {
            renderPass.setPipeline(this.renderPipeline);
            // 绑定动态数据（使用计算着色器的输出缓冲区）
            renderPass.setVertexBuffer(0, this.dynamicBuffers[(this.frame + 1) % 2]);
            // 绑定静态数据
            renderPass.setVertexBuffer(1, this.staticBuffer);
            renderPass.setBindGroup(0, this.renderBindGroup);
            renderPass.draw(6, this.particleCount, 0, 0);
        }
        renderPass.end();

        this.device.queue.submit([commandEncoder.finish()]);
        this.frame++;

        requestAnimationFrame(this.renderLoop);
    };

    public start() {
        this.lastTime = performance.now();
        this.fpsLastTime = performance.now();
        requestAnimationFrame(this.renderLoop);
    }
}