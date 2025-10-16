// src/config.ts

export const IMAGE_URLS = [
  '/assets/images/normal_2-歯ギター_歯ギターあんじゅ.png',
  '/assets/images/normal-main_n.png',
  '/assets/images/normal-キャラ_杏珠.png',
  '/assets/images/normal-グループ 1_あんじゅ_あんじゅ.png',
  '/assets/images/normal-杏珠_目_２燃えてくる1.png',
  '/assets/images/normal-背景_アイコン_iconあんじゅ.png',
  '/assets/images/normal-背景_ステッカー_stkあんじゅ.png',
  '/assets/images/normal-背景_肩書_肩書あんじゅset_肩書あんじゅ.png',
  '/assets/images/ciallo.png',
];

export const MAX_PARTICLES = 10000;
export const WORKGROUP_SIZE = 64;
// 将纹理尺寸设大一些，以容纳更大的图片
export const TEXTURE_SIZE = 1024;

// 动态粒子数据步长：pos(vec2), vel(vec2), rotation(f32), padding(f32) = 24 bytes
export const DYNAMIC_PARTICLE_STRIDE = 24;

// 静态粒子数据步长：scale(f32), aspectRatio(f32), angularVel(f32), texIndex(u32), uvScale(vec2), padding(vec2) = 32 bytes
export const STATIC_PARTICLE_STRIDE = 32;

// 音频配置
export const VOICE_PATH_TEMPLATE = '/assets/voices/random_{index}.ogg'; // 音频路径模板
export const VOICE_TOTAL_COUNT = 128; // 音频总数（根据实际情况调整）
export const VOICE_INITIAL_LOAD = 10; // 初始加载数量
