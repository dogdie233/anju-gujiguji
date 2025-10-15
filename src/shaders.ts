// src/shaders.ts

export const computeWGSL = `
    struct Particle {
        pos: vec2<f32>,
        vel: vec2<f32>,
        // Pack scale, rotation, angular_vel, tex_index into a vec4
        props: vec4<f32>,
        // Pack aspect_ratio, uv_scale.x, uv_scale.y, and padding into a vec4
        extra: vec4<f32>,
    };

    struct Particles {
        particles: array<Particle>,
    };

    struct Uniforms {
        deltaTime: f32,
        particleCount: u32,
        canvasSize: vec2<f32>, // {aspectRatio, 1.0}
    };

    @group(0) @binding(0) var<storage, read> particles_in: Particles;
    @group(0) @binding(1) var<storage, read_write> particles_out: Particles;
    @group(0) @binding(2) var<uniform> uniforms: Uniforms;

    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let index = global_id.x;
        if (index >= uniforms.particleCount) { return; }

        var p_in = particles_in.particles[index];
        var pos = p_in.pos + p_in.vel * uniforms.deltaTime;
        var vel = p_in.vel;
        
        // Unpack properties
        let p_scale = p_in.props.x;
        var rotation = p_in.props.y + p_in.props.z * uniforms.deltaTime;
        let p_aspect_ratio = p_in.extra.x;
        
        // Calculate the particle's half-size in a coordinate system that is aware of the viewport aspect ratio.
        // The Y dimension is our reference (-1 to 1). We scale the X dimension accordingly.
        let world_scale_y = p_scale / 2.0;
        let world_scale_x = world_scale_y * p_aspect_ratio / uniforms.canvasSize.x;
        let world_half_size = vec2<f32>(world_scale_x, world_scale_y);
        let world_area = vec2<f32>(uniforms.canvasSize.x, uniforms.canvasSize.y);

        if (pos.x - world_half_size.x < -world_area.x) {
            pos.x = -world_area.x + world_half_size.x;
            vel.x = abs(vel.x);
        } else if (pos.x + world_half_size.x > world_area.x) {
            pos.x = world_area.x - world_half_size.x;
            vel.x = -abs(vel.x);
        }

        if (pos.y - world_half_size.y < -world_area.y) {
            pos.y = -world_area.y + world_half_size.y;
            vel.y = abs(vel.y);
        } else if (pos.y + world_half_size.y > world_area.y) {
            pos.y = world_area.y - world_half_size.y;
            vel.y = -abs(vel.y);
        }

        particles_out.particles[index].pos = pos;
        particles_out.particles[index].vel = vel;
        particles_out.particles[index].props.y = rotation; // Update rotation
        
        // Pass other data through
        particles_out.particles[index].props.x = p_in.props.x;
        particles_out.particles[index].props.z = p_in.props.z;
        particles_out.particles[index].props.w = p_in.props.w;
        particles_out.particles[index].extra = p_in.extra;
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
        canvasSize: vec2<f32>,
    };

    @group(0) @binding(0) var mySampler: sampler;
    @group(0) @binding(1) var myTextures: texture_2d_array<f32>;
    @group(0) @binding(2) var<uniform> uniforms: Uniforms;

    @vertex
    fn vs_main(
        @builtin(vertex_index) vertex_index: u32,
        @location(0) pos: vec2<f32>,
        @location(1) vel: vec2<f32>,
        @location(2) props: vec4<f32>, // scale, rotation, angular_vel, tex_index
        @location(3) extra: vec4<f32>  // aspect_ratio, uv_scale.x, uv_scale.y, padding
    ) -> VertexOutput {
        let p_scale = props.x;
        let p_rotation = props.y;
        let p_tex_index = u32(round(props.w));
        let p_aspect_ratio = extra.x;
        let p_uv_scale = extra.yz;

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
        out.tex_index = p_tex_index;
        out.uv_scale = p_uv_scale;
        
        let angle = p_rotation;
        let c = cos(angle);
        let s = sin(angle);
        let rot_matrix = mat2x2<f32>(c, -s, s, c);
        
        var transformed_pos = quad_positions[vertex_index];
        transformed_pos.x = transformed_pos.x * p_aspect_ratio;
        transformed_pos = rot_matrix * transformed_pos;
        transformed_pos = transformed_pos * p_scale;
        transformed_pos = transformed_pos + pos;
        transformed_pos.x = transformed_pos.x / uniforms.canvasSize.x;

        out.position = vec4<f32>(transformed_pos, 0.0, 1.0);
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