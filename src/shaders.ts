// src/shaders.ts

export const computeWGSL = `
    // 动态数据：每帧都会变化的数据
    struct DynamicParticle {
        pos: vec2<f32>,      // 位置
        vel: vec2<f32>,      // 速度
        rotation: f32,       // 当前旋转角度
        padding: f32,        // 对齐到 16 字节
    };

    // 静态数据：创建时设置，之后不变的数据
    struct StaticParticle {
        scale: f32,          // 缩放
        aspectRatio: f32,    // 图片宽高比
        angularVel: f32,     // 角速度
        texIndex: u32,       // 纹理索引
        uvScale: vec2<f32>,  // UV 缩放
        padding: vec2<f32>,  // 对齐到 16 字节
    };

    struct DynamicParticles {
        particles: array<DynamicParticle>,
    };

    struct StaticParticles {
        particles: array<StaticParticle>,
    };

    struct Uniforms {
        deltaTime: f32,
        particleCount: u32,
        aspectRatio: f32,    // canvas 宽高比 (width / height)
        padding: f32,
    };

    @group(0) @binding(0) var<storage, read> dynamic_in: DynamicParticles;
    @group(0) @binding(1) var<storage, read_write> dynamic_out: DynamicParticles;
    @group(0) @binding(2) var<storage, read> static_data: StaticParticles;
    @group(0) @binding(3) var<uniform> uniforms: Uniforms;

    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let index = global_id.x;
        if (index >= uniforms.particleCount) { return; }

        let d_in = dynamic_in.particles[index];
        let s = static_data.particles[index];
        
        // 更新位置和旋转
        var pos = d_in.pos + d_in.vel * uniforms.deltaTime;
        var vel = d_in.vel;
        var rotation = d_in.rotation + s.angularVel * uniforms.deltaTime;
        
        // 计算粒子在 NDC 空间中的半尺寸
        // 使用简化的坐标系统：Y 方向范围是 [-1, 1]，X 方向根据 canvas 宽高比调整
        let half_height = s.scale * 0.5;
        let half_width = half_height * s.aspectRatio;
        
        // 计算边界（考虑 canvas 的宽高比）
        let bound_x = uniforms.aspectRatio;
        let bound_y = 1.0;

        // 边界碰撞检测（X 方向）
        if (pos.x - half_width < -bound_x) {
            pos.x = -bound_x + half_width;
            vel.x = abs(vel.x);
        } else if (pos.x + half_width > bound_x) {
            pos.x = bound_x - half_width;
            vel.x = -abs(vel.x);
        }

        // 边界碰撞检测（Y 方向）
        if (pos.y - half_height < -bound_y) {
            pos.y = -bound_y + half_height;
            vel.y = abs(vel.y);
        } else if (pos.y + half_height > bound_y) {
            pos.y = bound_y - half_height;
            vel.y = -abs(vel.y);
        }

        // 写入更新后的动态数据
        dynamic_out.particles[index].pos = pos;
        dynamic_out.particles[index].vel = vel;
        dynamic_out.particles[index].rotation = rotation;
        dynamic_out.particles[index].padding = 0.0;
    }
`;

export const renderWGSL = `
    struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
        @location(1) @interpolate(flat) tex_index: u32,
        @location(2) uv_scale: vec2<f32>,
    };

    struct Uniforms {
        deltaTime: f32,
        particleCount: u32,
        aspectRatio: f32,
        padding: f32,
    };

    @group(0) @binding(0) var mySampler: sampler;
    @group(0) @binding(1) var myTextures: texture_2d_array<f32>;
    @group(0) @binding(2) var<uniform> uniforms: Uniforms;

    @vertex
    fn vs_main(
        @builtin(vertex_index) vertex_index: u32,
        @location(0) pos: vec2<f32>,           // 动态：位置
        @location(1) vel: vec2<f32>,           // 动态：速度（未使用，但保持结构）
        @location(2) rotation: f32,            // 动态：旋转角度
        @location(3) scale: f32,               // 静态：缩放
        @location(4) aspectRatio: f32,         // 静态：图片宽高比
        @location(5) angularVel: f32,          // 静态：角速度（未使用）
        @location(6) texIndex: u32,            // 静态：纹理索引
        @location(7) uvScale: vec2<f32>        // 静态：UV 缩放
    ) -> VertexOutput {
        // 四边形的顶点位置（局部坐标，以原点为中心）
        let quad_positions = array<vec2<f32>, 6>(
            vec2<f32>(-0.5, -0.5), vec2<f32>( 0.5, -0.5), vec2<f32>(-0.5,  0.5),
            vec2<f32>(-0.5,  0.5), vec2<f32>( 0.5, -0.5), vec2<f32>( 0.5,  0.5)
        );
        let uvs = array<vec2<f32>, 6>(
            vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
            vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0)
        );

        var out: VertexOutput;
        out.uv = uvs[vertex_index];
        out.tex_index = texIndex;
        out.uv_scale = uvScale;
        
        // 旋转矩阵
        let c = cos(rotation);
        let s = sin(rotation);
        let rot_matrix = mat2x2<f32>(c, -s, s, c);
        
        // 变换顶点
        var local_pos = quad_positions[vertex_index];
        
        // 1. 应用图片的宽高比
        local_pos.x = local_pos.x * aspectRatio;
        
        // 2. 旋转
        local_pos = rot_matrix * local_pos;
        
        // 3. 缩放
        local_pos = local_pos * scale;
        
        // 4. 平移到粒子位置
        local_pos = local_pos + pos;
        
        // 5. 转换到 NDC 坐标
        // X 方向需要除以 canvas 的宽高比，Y 方向已经在 [-1, 1] 范围内
        local_pos.x = local_pos.x / uniforms.aspectRatio;

        out.position = vec4<f32>(local_pos, 0.0, 1.0);
        return out;
    }

    @fragment
    fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
        let scaled_uv = in.uv * in.uv_scale;
        let color = textureSample(myTextures, mySampler, scaled_uv, in.tex_index);

        if (color.a < 0.1) {
            discard;
        }
        return color;
    }
`;