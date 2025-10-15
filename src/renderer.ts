import { IMAGE_URLS, MAX_PARTICLES, WORKGROUP_SIZE, TEXTURE_SIZE } from './config';
import { computeWGSL, renderWGSL } from './shaders';

// 由于增加了 aspect_ratio 和 padding，更新数据结构和步长
// pos(vec2), vel(vec2) -> 16 bytes
// props(vec4) -> 16 bytes
// extra(vec4) -> 16 bytes
// Total: 48 bytes
const PARTICLE_STRIDE = 48;

interface LoadedImage {
    textureIndex: number
    bitmap: ImageBitmap
}

export class WebGPURenderer {
    private canvas: HTMLCanvasElement;
    private button: HTMLButtonElement;

    private adapter!: GPUAdapter;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;

    private computePipeline!: GPUComputePipeline;
    private renderPipeline!: GPURenderPipeline;

    private particleBuffers!: [GPUBuffer, GPUBuffer];
    private uniformsBuffer!: GPUBuffer;
    private textureArray!: GPUTexture;
    private sampler!: GPUSampler;

    private computeBindGroups!: [GPUBindGroup, GPUBindGroup];
    private renderBindGroup!: GPUBindGroup;

    private particleCount = 0;
    private loadedImages = new Map<string, LoadedImage>();
    private nextTextureIndex = 0;
    private frame = 0;
    private lastTime = 0;

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

        this.button.addEventListener('click', () => this.addParticle());
        return true;
    }

    private configureCanvas() {
        const devicePixelRatio = window.devicePixelRatio || 1;
        this.canvas.width = this.canvas.clientWidth * devicePixelRatio;
        this.canvas.height = this.canvas.clientHeight * devicePixelRatio;
        this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: 'premultiplied',
        });
        console.info(`Canvas configured: ${this.canvas.width}x${this.canvas.height}`);
    }

    private createAssets() {
        // Buffers
        this.particleBuffers = [
            this.device.createBuffer({
                size: MAX_PARTICLES * PARTICLE_STRIDE,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            }),
            this.device.createBuffer({
                size: MAX_PARTICLES * PARTICLE_STRIDE,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            }),
        ];
        this.uniformsBuffer = this.device.createBuffer({
            size: 16, // deltaTime, particleCount, canvasSize.xy
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Texture and Sampler
        this.textureArray = this.device.createTexture({
            size: [TEXTURE_SIZE, TEXTURE_SIZE, IMAGE_URLS.length],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    }

    private createPipelines() {
        const computeShaderModule = this.device.createShaderModule({ code: computeWGSL });
        const renderShaderModule = this.device.createShaderModule({ code: renderWGSL });

        // Compute Pipeline
        const computeBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
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
                buffers: [{
                    arrayStride: PARTICLE_STRIDE,
                    stepMode: 'instance',
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x2' },  // pos
                        { shaderLocation: 1, offset: 8, format: 'float32x2' },  // vel
                        { shaderLocation: 2, offset: 16, format: 'float32x4' }, // scale, rot, angular_vel, tex_idx
                        { shaderLocation: 3, offset: 32, format: 'float32x4' },   // extra
                    ],
                }],
            },
            fragment: {
                module: renderShaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: this.presentationFormat }],
            },
            primitive: { topology: 'triangle-list' },
        });

        // Bind Groups
        this.computeBindGroups = [
            this.device.createBindGroup({
                layout: computeBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.particleBuffers[0] } },
                    { binding: 1, resource: { buffer: this.particleBuffers[1] } },
                    { binding: 2, resource: { buffer: this.uniformsBuffer } },
                ],
            }),
            this.device.createBindGroup({
                layout: computeBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.particleBuffers[1] } },
                    { binding: 1, resource: { buffer: this.particleBuffers[0] } },
                    { binding: 2, resource: { buffer: this.uniformsBuffer } },
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

    private async addParticle() {
        if (this.particleCount >= MAX_PARTICLES) return;

        const imageIndex = Math.floor(Math.random() * IMAGE_URLS.length);
        const url = IMAGE_URLS[imageIndex];
        let image: LoadedImage;

        if (this.loadedImages.has(url)) {
            image = this.loadedImages.get(url)!;
        } else {
            if (this.nextTextureIndex >= IMAGE_URLS.length) {
                console.warn("Texture array is full.");
                return;
            }
            try {
                const response = await fetch(url, { mode: 'cors' });
                const blob = await response.blob();
                const imageBitmap = await createImageBitmap(blob);

                const index = this.nextTextureIndex;
                this.device.queue.copyExternalImageToTexture(
                    { source: imageBitmap },
                    { texture: this.textureArray, origin: [0, 0, index] },
                    [imageBitmap.width, imageBitmap.height]
                );

                this.loadedImages.set(url, { bitmap: imageBitmap, textureIndex: index });
                this.nextTextureIndex++;
                image = this.loadedImages.get(url)!;
            } catch (e) {
                console.error(`Failed to load image: ${url}`, e);
                return;
            }
        }

        const particleData = new Float32Array(PARTICLE_STRIDE / 4);

        const velSpeed = (Math.random() + 1) * 0.5;
        const velAngle = Math.random() * 2 * Math.PI;
        const velX = Math.cos(velAngle) * velSpeed;
        const velY = Math.sin(velAngle) * velSpeed;

        particleData[0] = 0.0; // pos.x
        particleData[1] = 0.0; // pos.y
        particleData[2] = velX; // vel.x
        particleData[3] = velY; // vel.y
        particleData[4] = 0.3; // Math.random() * 0.5 + 0.5; // scale
        particleData[5] = 0.0; // rotation
        particleData[6] = (Math.random() - 0.5) * 5.0; // angular velocity
        particleData[7] = image.textureIndex; // texture index
        particleData[8] = image.bitmap.width / image.bitmap.height; // aspect_ratio
        particleData[9] = image.bitmap.width / TEXTURE_SIZE;      // uv_scale.x
        particleData[10] = image.bitmap.height / TEXTURE_SIZE;     // uv_scale.y

        this.device.queue.writeBuffer(
            this.particleBuffers[this.frame % 2],
            this.particleCount * PARTICLE_STRIDE,
            particleData.buffer
        );

        this.particleCount++;
        this.button.textContent = `添加一张图片 (${this.particleCount})`;
    }

    private renderLoop = () => {
        const now = performance.now();
        const deltaTime = this.lastTime > 0 ? Math.min(0.1, (now - this.lastTime) / 1000.0) : 0.016;
        this.lastTime = now;

        const uniformsData = new Float32Array(4);
        uniformsData[0] = deltaTime;
        const u32View = new Uint32Array(uniformsData.buffer);
        u32View[1] = this.particleCount;
        uniformsData[2] = this.canvas.width / this.canvas.height;
        uniformsData[3] = 1.0;
        this.device.queue.writeBuffer(this.uniformsBuffer, 0, uniformsData.buffer);

        const commandEncoder = this.device.createCommandEncoder();

        if (this.particleCount > 0) {
            const computePass = commandEncoder.beginComputePass();
            computePass.setPipeline(this.computePipeline);
            computePass.setBindGroup(0, this.computeBindGroups[this.frame % 2]);
            computePass.dispatchWorkgroups(Math.ceil(this.particleCount / WORKGROUP_SIZE));
            computePass.end();
        }

        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });

        if (this.particleCount > 0) {
            renderPass.setPipeline(this.renderPipeline);
            renderPass.setVertexBuffer(0, this.particleBuffers[(this.frame + 1) % 2]);
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
        requestAnimationFrame(this.renderLoop);
    }
}