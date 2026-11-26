import * as THREE from 'three';
import {
  CAUSTIC_FPS_DEFAULT,
  CAUSTIC_SCROLL_DEFAULT,
  LIGHT_BANDS_DEFAULT,
  WATER_DEEP_DEFAULT,
  WATER_FOG_CAP,
  WATER_FOG_START_DEFAULT,
  WATER_HALO_SCALE,
  WATER_TINT_DEFAULT,
  causticPhase,
  fogDensityFromClarity,
  gradeMul,
} from './waterSettings';

/**
 * Trailbound water sphere, look v2.
 * The mesh is only a shell. The fragment shader ray-traces the real sphere,
 * posterizes the background, and swaps outside/inside when the camera crosses the radius.
 * Spec: public/stadium/textures/water/water_look_spec.json
 */

export const WATER = ['#163A48', '#1F6066', '#2E8A84', '#2A9EAE', '#3EB8D8', '#5ED2DC', '#8CE6E8', '#BDF6F0', '#E8FFF6'] as const;

export type WaterPresetName = 'Mockup' | 'Clearer' | 'Deeper';

const vertexShader = /* glsl */ `
out vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fragmentShader = /* glsl */ `
precision highp float;
in vec3 vWorld;
out vec4 fragColor;

uniform vec3  uCenter;
uniform float uRadius;
uniform mat4  uInvProj;
uniform mat4  uCamWorld;
uniform mat4  uViewProj;
uniform mat4  uView;
uniform vec2  uResolution;
uniform float uPixel;
uniform float uDitherScale;
uniform float uInside;

uniform sampler2D uBg;
uniform float uRefraction;
uniform float uBgIsLinear;
uniform float uLensScale;
uniform float uBodyGain;
uniform float uBodyBias;
uniform float uLowerDarken;
uniform float uFallbackOpacity;
uniform float uFallbackBlend;
uniform sampler2D uBodyLUT;
uniform float uBodySteps;

uniform sampler2D uRimLUT;
uniform vec4  uRimF;
uniform float uRimWidth;
uniform sampler2D uHaloLUT;
uniform vec3  uHaloR;

uniform sampler2D uWeb;
uniform float uWebFrame;
uniform float uWebFrames;
uniform float uTime;
uniform float uScroll;
uniform float uWebTile;
uniform float uInsideWebTile;
uniform float uWebMaxF;
uniform float uWebScreen;
uniform float uWebScreenTile;
uniform vec3  uWebColor;

uniform vec3  uHlDir;
uniform vec2  uHlSteps;
uniform vec3  uHlColA;
uniform vec3  uHlColB;
uniform vec2  uArcF;
uniform float uArcQuad;

uniform sampler2D uFogLUT;
uniform vec3  uFogSteps;
uniform float uFogDensity;
uniform float uFogStart;
uniform float uFogCap;
uniform float uInsideBgGain;
uniform vec3  uInsideCaustic;
uniform float uInsideCausticCover;
uniform float uRays;
uniform vec3  uRay;
uniform vec3  uGradeTint;
uniform vec3  uGradeDeep;

const float B4[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
float bayer(vec2 vp) {
  ivec2 c = ivec2(mod(floor(vp / uDitherScale), 4.0));
  return (B4[c.y * 4 + c.x] + 0.5) / 16.0;
}
vec4 lut(sampler2D t, float i, float n) { return texture(t, vec2((i + 0.5) / n, 0.5)); }
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float luma(vec3 c) { if (uBgIsLinear > 0.5) c = toSrgb(c); return dot(c, vec3(0.30, 0.59, 0.11)); }

float webAt(vec2 uv, float frame) {
  return texture(uWeb, vec2((uv.x + frame) / uWebFrames, uv.y)).a;
}
vec2 snapCell(vec2 uv) {
  return (floor(fract(uv) * 256.0) + 0.5) / 256.0;
}
float webPlane(vec2 uv) {
  uv = snapCell(uv);
  float span = max(uWebFrames, 1.0);
  float phase = mod(uWebFrame, span);
  float f0 = floor(phase);
  float f1 = mod(f0 + 1.0, span);
  return mix(webAt(uv, f0), webAt(uv, f1), fract(phase));
}
float webTri(vec3 q, vec3 n) {
  vec3 w = abs(n);
  w *= w;
  w *= w;
  float sumw = w.x + w.y + w.z;
  w /= max(sumw, 1e-4);
  return webPlane(q.zy) * w.x + webPlane(q.xz) * w.y + webPlane(q.xy) * w.z;
}
vec3 gradeWater(vec3 c) {
  float l = dot(c, vec3(0.30, 0.59, 0.11));
  float dark = 1.0 - smoothstep(0.05, 0.40, l);
  float hot = smoothstep(0.82, 0.96, l);
  vec3 g = c * mix(uGradeTint, uGradeDeep, dark);
  return mix(g, c, hot);
}
float webMask(vec3 p, vec3 n, vec2 vp, vec2 cvp, float tile) {
  float scroll = uTime * uScroll;
  if (uWebScreen > 0.5) {
    vec2 uv = (vp - cvp) / uWebScreenTile;
    uv.y = -uv.y;
    uv += scroll * vec2(0.35, -0.22);
    return webPlane(uv);
  }
  vec3 q = (p - uCenter) / max(tile, 0.001);
  float a = webTri(q + scroll * vec3(0.72, 0.16, 0.41), n);
  float b = webTri(q + scroll * vec3(-0.28, 0.55, -0.46) * 0.65, n);
  return max(a, b);
}

void main() {
  vec2 vp = floor(gl_FragCoord.xy / uPixel);
  vec2 frag = (vp + 0.5) * uPixel;
  vec2 suv = frag / uResolution;
  vec4 v = uInvProj * vec4(suv * 2.0 - 1.0, 1.0, 1.0); v /= v.w;
  vec3 ro = cameraPosition;
  vec3 rd = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
  vec3 oc = ro - uCenter;
  float b = dot(oc, rd), c2 = dot(oc, oc) - uRadius * uRadius, h = b * b - c2;
  float bay = bayer(vp);
  vec4 cs = uViewProj * vec4(uCenter, 1.0);
  vec2 cuv = cs.xy / cs.w * 0.5 + 0.5;
  vec2 cvp = cuv * uResolution / uPixel;

  if (uInside > 0.5) {
    float t = -b + sqrt(max(h, 0.0));
    vec3 p = ro + rd * t, n = normalize(p - uCenter);
    // Same exp2 curve as the swimmers and the ball. No distance steps.
    float dist = max(0.0, t - uFogStart);
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    fogFactor = clamp(fogFactor, 0.0, uFogCap);
    float k = 2.0;
    if (uRefraction > 0.5) k += floor(luma(texture(uBg, suv).rgb) * uInsideBgGain);
    if (uRays > 0.5 && mod(vp.x - (uResolution.y / uPixel - vp.y) * uRay.z, uRay.x) < uRay.y) k += 1.0;
    vec3 col = lut(uBodyLUT, clamp(k, 0.0, uBodySteps - 1.0), uBodySteps).rgb;
    if (uRefraction < 0.5) col = lut(uFogLUT, 0.0, 3.0).rgb;
    vec3 deepCol = lut(uFogLUT, 2.0, 3.0).rgb;
    col = mix(col, deepCol, fogFactor);
    if (bay < uInsideCausticCover) {
      col = mix(col, uInsideCaustic, webMask(p, n, vp, cvp, uInsideWebTile) * (1.0 - fogFactor));
    }
    fragColor = vec4(gradeWater(col), 1.0);
    return;
  }

  if (h < 0.0 || b > 0.0) {
    float dmin = sqrt(max(dot(oc, oc) - b * b, 0.0)) / uRadius;
    if (b > 0.0) discard;
    if (dmin < uHaloR.y) { vec4 hc = lut(uHaloLUT, 0.0, 2.0); if (bay < hc.a) { fragColor = vec4(gradeWater(hc.rgb), 1.0); return; } }
    else if (dmin < uHaloR.z) { vec4 hc = lut(uHaloLUT, 1.0, 2.0); if (bay < hc.a) { fragColor = vec4(gradeWater(hc.rgb), 1.0); return; } }
    discard;
  }

  float t = -b - sqrt(h);
  vec3 p = ro + rd * t, n = normalize(p - uCenter);
  float f = 1.0 - clamp(dot(n, -rd), 0.0, 1.0);
  float fr = 1.0 - (1.0 - f) / max(uRimWidth, 0.01);
  vec3 nv = normalize((uView * vec4(n, 0.0)).xyz);

  vec3 col;
  float k, alpha = 1.0;
  if (uRefraction < 0.5 && uFallbackBlend > 0.5) alpha = floor(uFallbackOpacity * 4.0 + 0.5) / 4.0;
  if (uRefraction > 0.5) {
    vec2 buv = cuv + (suv - cuv) * uLensScale;
    buv = (floor(buv * uResolution / uPixel) + 0.5) * uPixel / uResolution;
    k = uBodyBias + floor(luma(texture(uBg, clamp(buv, 0.001, 0.999)).rgb) * uBodyGain);
  } else {
    k = uBodyBias + 1.0 + (nv.y > 0.3 ? 1.0 : 0.0);
    if (uFallbackBlend < 0.5 && bay >= uFallbackOpacity) discard;
  }
  if (-nv.y > uLowerDarken) k -= 1.0;
  col = lut(uBodyLUT, clamp(k, 0.0, uBodySteps - 1.0), uBodySteps).rgb;

  vec3 body = col;
  float web = webMask(p, n, vp, cvp, uWebTile);
  col = mix(col, uWebColor, web * (0.85 + 0.15 * clamp(uWebMaxF, 0.0, 1.0)));

  for (int i = 0; i < 4; i++) {
    vec4 rc = lut(uRimLUT, float(i), 4.0);
    if (fr >= uRimF[i] && bay < rc.a) col = rc.rgb;
  }
  float s = dot(nv, normalize(uHlDir));
  if (s > uHlSteps.x) col = uHlColA;
  if (s > uHlSteps.y) col = uHlColB;
  if (fr > uArcF.x && fr < uArcF.y && nv.x > uArcQuad && -nv.y > uArcQuad) col = uHlColB;
  if (any(notEqual(col, body))) alpha = 1.0;
  fragColor = vec4(gradeWater(col), alpha);
}`;

export const WATER_PRESETS: Record<
  WaterPresetName,
  {
    uLensScale: number;
    uBodyGain: number;
    uBodyBias: number;
    uLowerDarken: number;
    uRimWidth: number;
    uFallbackOpacity: number;
    uWebMaxF: number;
    uHlStepsX: number;
    uHlStepsY: number;
  }
> = {
  Mockup: { uLensScale: -0.55, uBodyGain: 3.4, uBodyBias: 1, uLowerDarken: 0.35, uRimWidth: 1.0, uFallbackOpacity: 0.75, uWebMaxF: 0.55, uHlStepsX: 0.975, uHlStepsY: 0.993 },
  Clearer: { uLensScale: 0.85, uBodyGain: 4.2, uBodyBias: 1, uLowerDarken: 0.55, uRimWidth: 0.85, uFallbackOpacity: 0.5, uWebMaxF: 0.45, uHlStepsX: 0.98, uHlStepsY: 0.995 },
  Deeper: { uLensScale: -0.55, uBodyGain: 2.4, uBodyBias: 0, uLowerDarken: 0.15, uRimWidth: 1.15, uFallbackOpacity: 1.0, uWebMaxF: 0.6, uHlStepsX: 0.975, uHlStepsY: 0.993 },
};

const hex = (h: string): THREE.Vector3 => {
  const n = Number.parseInt(h.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

function lutTexture(loader: THREE.TextureLoader, url: string): THREE.Texture {
  const map = loader.load(url);
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.NoColorSpace;
  return map;
}

export interface WaterSphere {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, timeSec?: number): void;
  applyPreset(name: string): void;
  setRadius(radius: number): void;
  setPixel(pixel: number): void;
  setRefraction(on: boolean): void;
  setQuality(quality: 'high' | 'low'): void;
  setCausticFps(fps: number): void;
  setCausticScroll(speed: number): void;
  setLightBands(on: boolean): void;
  setColors(tint: string, deep: string): void;
  setFalloff(density: number, start: number): void;
  dispose(): void;
}

export function createWaterSphere(opts: {
  radius?: number;
  base?: string;
  pixel?: number;
  refraction?: boolean;
  preset?: string;
  haloScale?: number;
  layer?: number;
} = {}): WaterSphere {
  const base = opts.base ?? './';
  const haloScale = opts.haloScale ?? WATER_HALO_SCALE;
  let radius = opts.radius ?? 15;
  const loader = new THREE.TextureLoader();
  const u = {
    uCenter: { value: new THREE.Vector3() },
    uRadius: { value: radius },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uViewProj: { value: new THREE.Matrix4() },
    uView: { value: new THREE.Matrix4() },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uPixel: { value: opts.pixel ?? 1 },
    uDitherScale: { value: 1 },
    uInside: { value: 0 },
    uBg: { value: null as THREE.Texture | null },
    uBgIsLinear: { value: 1 },
    uRefraction: { value: opts.refraction === false ? 0 : 1 },
    uLensScale: { value: -0.55 },
    uBodyGain: { value: 3.4 },
    uBodyBias: { value: 1 },
    uLowerDarken: { value: 0.35 },
    uFallbackOpacity: { value: 0.75 },
    uFallbackBlend: { value: 1 },
    uBodyLUT: { value: lutTexture(loader, `${base}lut_body_5x1.png`) },
    uBodySteps: { value: 5 },
    uRimLUT: { value: lutTexture(loader, `${base}lut_rim_4x1.png`) },
    uRimF: { value: new THREE.Vector4(0.5, 0.58, 0.68, 0.8) },
    uRimWidth: { value: 1 },
    uHaloLUT: { value: lutTexture(loader, `${base}lut_halo_2x1.png`) },
    uHaloR: { value: new THREE.Vector3(1, 1.03, 1.06) },
    uWeb: { value: lutTexture(loader, `${base}water_web_anim_4f_1024x256.png`) },
    uWebFrame: { value: 0 },
    uWebFrames: { value: 4 },
    uTime: { value: 0 },
    uScroll: { value: CAUSTIC_SCROLL_DEFAULT },
    uWebTile: { value: radius * 2.56 },
    uInsideWebTile: { value: radius * 1.2 },
    uWebMaxF: { value: 0.55 },
    uWebScreen: { value: 0 },
    uWebScreenTile: { value: 256 },
    uWebColor: { value: hex(WATER[5]) },
    uHlDir: { value: new THREE.Vector3(-0.55, 0.6, 0.58) },
    uHlSteps: { value: new THREE.Vector2(0.975, 0.993) },
    uHlColA: { value: hex(WATER[7]) },
    uHlColB: { value: hex(WATER[8]) },
    uArcF: { value: new THREE.Vector2(0.7, 0.8) },
    uArcQuad: { value: 0.35 },
    uFogLUT: { value: lutTexture(loader, `${base}lut_inner_fog_3x1.png`) },
    uFogSteps: { value: new THREE.Vector3(radius * 0.9, radius * 1.5, radius * 2) },
    uFogDensity: { value: fogDensityFromClarity(0.68) },
    uFogStart: { value: WATER_FOG_START_DEFAULT },
    uFogCap: { value: WATER_FOG_CAP },
    uInsideBgGain: { value: 2 },
    uInsideCaustic: { value: hex(WATER[6]) },
    uInsideCausticCover: { value: 0.75 },
    uRays: { value: LIGHT_BANDS_DEFAULT ? 1 : 0 },
    uRay: { value: new THREE.Vector3(70, 11, 0.6) },
    uGradeTint: { value: new THREE.Vector3(1, 1, 1) },
    uGradeDeep: { value: new THREE.Vector3(1, 1, 1) },
  };
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: u,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
  });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * haloScale, 64, 32), material);
  mesh.name = 'water-v2';
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  mesh.layers.set(opts.layer ?? 2);
  const state = {
    caustFps: CAUSTIC_FPS_DEFAULT,
    scroll: CAUSTIC_SCROLL_DEFAULT,
    rt: null as THREE.WebGLRenderTarget | null,
    rtW: 0,
    rtH: 0,
    quality: 'high' as 'high' | 'low',
  };
  const drawSize = new THREE.Vector2();

  function syncRadius(): void {
    u.uRadius.value = radius;
    u.uWebTile.value = radius * 2.56;
    u.uInsideWebTile.value = radius * 1.2;
    u.uFogSteps.value.set(radius * 0.9, radius * 1.5, radius * 2);
    const baseRadius = opts.radius ?? 15;
    mesh.scale.setScalar(radius / baseRadius);
  }

  function ensureRT(w: number, h: number): void {
    const div = state.quality === 'low' ? 2 : 1;
    const rw = Math.max(1, Math.floor(w / div));
    const rh = Math.max(1, Math.floor(h / div));
    if (state.rt && state.rtW === rw && state.rtH === rh) return;
    state.rt?.dispose();
    state.rt = new THREE.WebGLRenderTarget(rw, rh, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    state.rt.texture.colorSpace = THREE.NoColorSpace;
    state.rtW = rw;
    state.rtH = rh;
  }

  function update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, time = 0): void {
    mesh.updateMatrixWorld();
    camera.updateMatrixWorld();
    u.uCenter.value.setFromMatrixPosition(mesh.matrixWorld);
    if (camera instanceof THREE.PerspectiveCamera) {
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uView.value.copy(camera.matrixWorldInverse);
      u.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    }
    u.uCamWorld.value.copy(camera.matrixWorld);
    renderer.getDrawingBufferSize(drawSize);
    u.uResolution.value.copy(drawSize);
    const inside = camera.position.distanceTo(u.uCenter.value) < radius;
    u.uInside.value = inside ? 1 : 0;
    material.side = inside ? THREE.BackSide : THREE.FrontSide;
    u.uTime.value = time;
    u.uScroll.value = state.scroll;
    u.uWebFrame.value = causticPhase(time, state.caustFps);
    if (u.uRefraction.value > 0.5) {
      ensureRT(drawSize.x, drawSize.y);
      const mask = camera.layers.mask;
      camera.layers.set(0);
      const target = state.rt;
      if (target) {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        u.uBg.value = target.texture;
      }
      camera.layers.mask = mask;
    }
  }

  function applyPreset(name: string): void {
    const preset = WATER_PRESETS[name as WaterPresetName];
    if (!preset) return;
    u.uLensScale.value = preset.uLensScale;
    u.uBodyGain.value = preset.uBodyGain;
    u.uBodyBias.value = preset.uBodyBias;
    u.uLowerDarken.value = preset.uLowerDarken;
    u.uRimWidth.value = preset.uRimWidth;
    u.uFallbackOpacity.value = preset.uFallbackOpacity;
    u.uWebMaxF.value = preset.uWebMaxF;
    u.uHlSteps.value.set(preset.uHlStepsX, preset.uHlStepsY);
  }

  applyPreset(opts.preset ?? 'Mockup');

  return {
    mesh,
    material,
    update,
    applyPreset,
    setRadius(next: number): void {
      radius = Math.max(1, next);
      syncRadius();
    },
    setPixel(pixel: number): void {
      u.uPixel.value = Math.max(1, pixel);
    },
    setRefraction(on: boolean): void {
      u.uRefraction.value = on ? 1 : 0;
    },
    setQuality(quality: 'high' | 'low'): void {
      state.quality = quality;
    },
    setCausticFps(fps: number): void {
      state.caustFps = Math.max(0, fps);
    },
    setCausticScroll(speed: number): void {
      state.scroll = Math.max(0, speed);
    },
    setLightBands(on: boolean): void {
      u.uRays.value = on ? 1 : 0;
    },
    setColors(tint: string, deep: string): void {
      const tintMul = gradeMul(tint, WATER_TINT_DEFAULT);
      const deepMul = gradeMul(deep, WATER_DEEP_DEFAULT);
      u.uGradeTint.value.set(tintMul[0], tintMul[1], tintMul[2]);
      u.uGradeDeep.value.set(deepMul[0], deepMul[1], deepMul[2]);
    },
    setFalloff(density: number, start: number): void {
      u.uFogDensity.value = Math.max(0, density);
      u.uFogStart.value = Math.max(0, start);
      u.uFogCap.value = WATER_FOG_CAP;
    },
    dispose(): void {
      state.rt?.dispose();
      material.dispose();
      mesh.geometry.dispose();
      u.uBodyLUT.value.dispose();
      u.uRimLUT.value.dispose();
      u.uHaloLUT.value.dispose();
      u.uWeb.value.dispose();
      u.uFogLUT.value.dispose();
    },
  };
}

/** No-shader stand-in: flat teal, the animated web, a highlight disc, and a back-face rim. */
export function createWaterFallback(radius: number, base: string): {
  group: THREE.Group;
  setRadius(radius: number): void;
  update(camera: THREE.Camera, time: number, fps: number): void;
  setColors(tint: string): void;
  setScroll(speed: number): void;
  dispose(): void;
} {
  const loader = new THREE.TextureLoader();
  const web = lutTexture(loader, `${base}water_web_anim_4f_1024x256.png`);
  web.repeat.set(1, 1);
  const decalMap = lutTexture(loader, `${base}highlight_decal_128.png`);
  const bodyMat = new THREE.MeshBasicMaterial({
    color: 0x2e8a84,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    toneMapped: false,
  });
  const webMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      uMap: { value: web },
      uPhase: { value: 0 },
      uTime: { value: 0 },
      uScroll: { value: CAUSTIC_SCROLL_DEFAULT },
      uTile: { value: Math.max(1, radius) * 1.2 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vNrm;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vPos = world.xyz;
        vNrm = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vNrm;
      uniform sampler2D uMap;
      uniform float uPhase;
      uniform float uTime;
      uniform float uScroll;
      uniform float uTile;
      vec2 snapCell(vec2 uv) {
        return (floor(fract(uv) * 256.0) + 0.5) / 256.0;
      }
      vec4 webFrame(vec2 uv, float frame) {
        vec2 s = snapCell(uv);
        return texture2D(uMap, vec2(s.x * 0.25 + frame * 0.25, s.y));
      }
      vec4 webTri(vec3 q, vec3 n, float frame) {
        vec3 w = abs(n);
        w *= w;
        w *= w;
        w /= max(w.x + w.y + w.z, 1e-4);
        return webFrame(q.zy, frame) * w.x + webFrame(q.xz, frame) * w.y + webFrame(q.xy, frame) * w.z;
      }
      void main() {
        float f0 = floor(uPhase);
        float f1 = mod(f0 + 1.0, 4.0);
        float blend = fract(uPhase);
        vec3 q = vPos / max(uTile, 0.001);
        float scroll = uTime * uScroll;
        vec3 n = normalize(vNrm);
        vec4 a = mix(
          webTri(q + scroll * vec3(0.72, 0.16, 0.41), n, f0),
          webTri(q + scroll * vec3(0.72, 0.16, 0.41), n, f1),
          blend
        );
        vec4 b = mix(
          webTri(q + scroll * vec3(-0.28, 0.55, -0.46) * 0.65, n, f0),
          webTri(q + scroll * vec3(-0.28, 0.55, -0.46) * 0.65, n, f1),
          blend
        );
        vec4 tex = max(a, b);
        if (tex.a < 0.02) discard;
        gl_FragColor = tex;
      }
    `,
  });
  const rimMat = new THREE.MeshBasicMaterial({
    color: 0x8ce6e8,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    toneMapped: false,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), bodyMat);
  const webMesh = new THREE.Mesh(new THREE.SphereGeometry(1.01, 48, 32), webMat);
  const rim = new THREE.Mesh(new THREE.SphereGeometry(1.04, 32, 24), rimMat);
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({
      map: decalMap,
      transparent: true,
      alphaTest: 0.5,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    }),
  );
  decal.name = 'water-highlight';
  const group = new THREE.Group();
  group.name = 'water-fallback';
  group.add(rim, body, webMesh, decal);
  group.layers.set(2);
  group.renderOrder = 10;
  group.traverse((obj) => {
    obj.layers.set(2);
    obj.renderOrder = 10;
  });
  let built = radius;
  const apply = (next: number): void => {
    built = Math.max(1, next);
    group.scale.setScalar(built);
  };
  apply(radius);
  return {
    group,
    setRadius: apply,
    setColors(tint: string): void {
      bodyMat.color.set(tint);
    },
    setScroll(speed: number): void {
      webMat.uniforms.uScroll!.value = Math.max(0, speed);
    },
    update(camera, time, fps): void {
      webMat.uniforms.uTime!.value = time;
      webMat.uniforms.uTile!.value = built * 1.2;
      webMat.uniforms.uPhase!.value = causticPhase(time, fps);
      const inside = camera.position.length() < built;
      bodyMat.side = inside ? THREE.BackSide : THREE.FrontSide;
      decal.visible = !inside;
      decal.lookAt(camera.position);
    },
    dispose(): void {
      body.geometry.dispose();
      webMesh.geometry.dispose();
      rim.geometry.dispose();
      decal.geometry.dispose();
      bodyMat.dispose();
      webMat.dispose();
      rimMat.dispose();
      (decal.material as THREE.Material).dispose();
      web.dispose();
      decalMap.dispose();
    },
  };
}
