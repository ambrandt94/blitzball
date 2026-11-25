import * as THREE from 'three';
import { applyPixelTexel } from './pixelTexel';
import { CAUSTIC_FPS_DEFAULT, CAUSTIC_SCROLL_DEFAULT, LIGHT_BANDS_DEFAULT } from './waterSettings';

/**
 * Trailbound shell. Colours are sphere_palette.json, written as linear values
 * so the sRGB framebuffer shows the painted hexes. Outside is a teal-cyan
 * body with a dithered fresnel rim. Inside is a bright glass edge; the fog
 * pass does the stepped teal volume.
 */

const BAYER = /* glsl */ `
float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  if (y == 0) { if (x == 0) return 0.0; if (x == 1) return 0.5; if (x == 2) return 0.125; return 0.625; }
  if (y == 1) { if (x == 0) return 0.75; if (x == 1) return 0.25; if (x == 2) return 0.875; return 0.375; }
  if (y == 2) { if (x == 0) return 0.1875; if (x == 1) return 0.6875; if (x == 2) return 0.0625; return 0.5625; }
  if (x == 0) return 0.9375; if (x == 1) return 0.4375; if (x == 2) return 0.8125; return 0.3125;
}
vec3 lin(vec3 srgb) {
  return mix(srgb / 12.92, pow((srgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), srgb));
}
float quantAlpha(float a, float b) {
  float steps = clamp(a, 0.0, 1.0) * 4.0;
  float q = floor(steps);
  if (b < fract(steps)) q += 1.0;
  return q / 4.0;
}
`;

const SHELL_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SHELL_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
uniform float uTime;
uniform vec3 uCameraPos;
uniform vec3 uBallPos;
uniform float uRadius;
uniform float uNear;
uniform float uImpact;
uniform float uInside;
uniform float uLayer;
uniform sampler2D uCaustics;
uniform sampler2D uBands;
uniform float uCausticFps;
uniform float uScroll;
uniform float uBandsOn;
uniform vec3 uGradeTint;
uniform vec3 uGradeDeep;

${BAYER}

vec2 snap256(vec2 uv) {
  return (floor(fract(uv) * 256.0) + 0.5) / 256.0;
}
vec3 cauFrame(vec2 uv, float frame) {
  vec2 s = snap256(uv);
  return texture2D(uCaustics, vec2(s.x * 0.25 + frame * 0.25, s.y)).rgb;
}
vec3 cauTri(vec3 q, vec3 n, float frame) {
  vec3 w = abs(n);
  w *= w;
  w *= w;
  w /= max(w.x + w.y + w.z, 1e-4);
  return cauFrame(q.zy, frame) * w.x + cauFrame(q.xz, frame) * w.y + cauFrame(q.xy, frame) * w.z;
}

void main() {
  vec2 pix = floor(gl_FragCoord.xy / 2.0);
  float b = bayer4(pix);
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCameraPos - vWorld);
  float ndv = abs(dot(N, V));
  float f = 1.0 - ndv;

  vec3 deep = lin(vec3(0.0862745, 0.227451, 0.282353));
  vec3 mid = lin(vec3(0.121569, 0.376471, 0.400000));
  vec3 base = lin(vec3(0.180392, 0.541176, 0.517647));
  vec3 teal = lin(vec3(0.164706, 0.619608, 0.682353));
  vec3 cyan = lin(vec3(0.243137, 0.721569, 0.847059));
  vec3 aqua = lin(vec3(0.368627, 0.823529, 0.862745));
  vec3 foam = lin(vec3(0.549020, 0.901961, 0.909804));
  vec3 rim = lin(vec3(0.741176, 0.964706, 0.941176));
  vec3 hot = lin(vec3(0.909804, 1.0, 0.964706));

  vec3 Nv = normalize(mat3(viewMatrix) * N);
  vec3 Lv = normalize(vec3(-0.55, 0.6, 0.58));
  float ndl = clamp(dot(Nv, Lv) * 0.5 + 0.5, 0.0, 1.0);
  float shade = clamp(floor(ndl * 5.0 + (b - 0.5) * 0.45), 0.0, 4.0);
  vec3 body = deep;
  if (shade > 0.5) body = mid;
  if (shade > 1.5) body = base;
  if (shade > 2.5) body = teal;
  if (shade > 3.5) body = cyan;

  vec3 col = body;
  if (f > 0.50 && b < 0.25) col = cyan;
  if (f > 0.58 && b < 0.50) col = aqua;
  if (f > 0.68) col = foam;
  if (f > 0.80) col = rim;

  float tau = 6.2831853;
  vec2 sph = vec2(atan(vWorld.z, vWorld.x) / tau + 0.5, vWorld.y / 8.0);
  sph += uTime * vec2(0.15, 0.05) / 8.0;
  vec3 bands = texture2D(uBands, sph).rgb;
  if (uBandsOn > 0.5) col = mix(col, bands, uInside > 0.5 ? 0.22 : 0.4);

  float phase = uCausticFps > 0.0 ? mod(uTime * uCausticFps, 4.0) : 0.0;
  float f0 = floor(phase);
  float f1 = mod(f0 + 1.0, 4.0);
  float blend = fract(phase);
  vec3 nrm = normalize(vNormal);
  vec3 q = vWorld / 12.0;
  float scroll = uTime * uScroll;
  vec3 cauA = mix(cauTri(q + scroll * vec3(0.72, 0.16, 0.41), nrm, f0), cauTri(q + scroll * vec3(0.72, 0.16, 0.41), nrm, f1), blend);
  vec3 cauB = mix(cauTri(q + scroll * vec3(-0.28, 0.55, -0.46) * 0.65, nrm, f0), cauTri(q + scroll * vec3(-0.28, 0.55, -0.46) * 0.65, nrm, f1), blend);
  vec3 cau = max(cauA, cauB);
  float cauMix = uInside > 0.5 ? 0.38 : (uLayer < 0.5 ? 0.62 : 0.48);
  col = mix(col, cau, cauMix);

  vec3 Hv = normalize(Lv + vec3(0.0, 0.0, 1.0));
  float spec = dot(Nv, Hv);
  if (spec > 0.993) col = hot;
  else if (spec > 0.975) col = rim;
  if (Nv.x > 0.12 && Nv.y < -0.05 && f > 0.70 && f < 0.82 && b > 0.4) col = hot;

  float ballLen = length(uBallPos);
  if (uNear > 0.001 && ballLen > 0.5) {
    vec3 contact = uBallPos * (uRadius / ballLen);
    float ring = distance(vWorld, contact);
    float wave = 0.5 + 0.5 * sin(ring * 2.6 - uTime * 7.5);
    float stepped = floor(wave * 4.0 + b) / 4.0;
    float band = exp(-ring * ring * 0.045);
    float glow = uNear * band * (0.45 + 0.85 * uImpact) * (0.35 + 0.65 * stepped);
    col += mix(rim, hot, step(0.66, wave)) * glow;
  }

  float alpha;
  if (uInside > 0.5 && uLayer > 0.5) {
    col = mix(base, cyan, 0.45);
    if (uBandsOn > 0.5) col = mix(col, bands, 0.55);
    col += cau * 0.42;
    if (f > 0.28 && b < 0.4) col = aqua;
    if (f > 0.46) col = foam;
    if (f > 0.64) col = rim;
    if (f > 0.8) col = hot;
    alpha = mix(0.28, 0.96, smoothstep(0.12, 0.72, f));
    if (uNear > 0.001 && ballLen > 0.5) {
      vec3 contact = uBallPos * (uRadius / ballLen);
      float ring = distance(vWorld, contact);
      float wave = 0.5 + 0.5 * sin(ring * 2.6 - uTime * 7.5);
      float glow = uNear * exp(-ring * ring * 0.045) * (0.45 + 0.85 * uImpact) * (0.4 + 0.6 * wave);
      col += mix(rim, hot, step(0.66, wave)) * glow;
      alpha += glow * 0.45;
    }
  } else if (uLayer > 0.5) {
    col = mix(deep, mid, 0.35);
    col += cau * 0.5;
    if (uBandsOn > 0.5) col = mix(col, bands, 0.18);
    alpha = 0.42;
  } else {
    alpha = mix(0.55, 0.95, smoothstep(0.35, 0.82, f));
  }
  alpha = quantAlpha(alpha, b);
  if (alpha < 0.02) discard;
  float luma = dot(col, vec3(0.30, 0.59, 0.11));
  float dark = 1.0 - smoothstep(0.02, 0.18, luma);
  float hot = smoothstep(0.55, 0.85, luma);
  col = mix(col * mix(uGradeTint, uGradeDeep, dark), col, hot);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

const HALO_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
uniform vec3 uCameraPos;
uniform float uRing;
${BAYER}
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCameraPos - vWorld);
  float f = 1.0 - abs(dot(N, V));
  float b = bayer4(floor(gl_FragCoord.xy));
  vec3 aqua = lin(vec3(0.368627, 0.823529, 0.862745));
  vec3 cyan = lin(vec3(0.243137, 0.721569, 0.847059));
  float cover = uRing < 0.5 ? 0.5 : 0.25;
  float gate = uRing < 0.5 ? 0.58 : 0.72;
  if (f < gate || b > cover) discard;
  vec3 col = uRing < 0.5 ? aqua : cyan;
  gl_FragColor = vec4(col, 0.8);
  #include <colorspace_fragment>
}
`;

const CLASSIC_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const CLASSIC_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
uniform float uTime;
uniform vec3 uCameraPos;
uniform vec3 uBallPos;
uniform float uRadius;
uniform float uNear;
uniform float uImpact;
uniform vec3 uGradeTint;
uniform vec3 uGradeDeep;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCameraPos - vWorld);
  float fres = pow(1.0 - abs(dot(N, V)), 1.7);
  float bands = sin(vWorld.x * 0.22 + uTime * 0.65) * sin(vWorld.z * 0.19 - uTime * 0.5);
  float ripple = sin(vWorld.y * 0.55 + bands * 3.0 + uTime * 1.1);
  float caustic = smoothstep(0.05, 0.9, ripple * 0.5 + 0.5);
  vec3 deep = vec3(0.02, 0.38, 0.52);
  vec3 rim = vec3(0.72, 0.95, 1.0);
  vec3 col = mix(deep, rim, fres);
  col += vec3(0.45, 0.9, 0.95) * caustic * (0.28 + fres * 0.45);
  float alpha = 0.1 + fres * 0.42 + caustic * 0.1;
  float ballLen = length(uBallPos);
  if (uNear > 0.001 && ballLen > 0.5) {
    vec3 contact = uBallPos * (uRadius / ballLen);
    float ring = distance(vWorld, contact);
    float wave = 0.5 + 0.5 * sin(ring * 2.6 - uTime * 7.5);
    float band = exp(-ring * ring * 0.045);
    float glow = uNear * band * (0.45 + 0.85 * uImpact) * (0.35 + 0.65 * wave);
    col += vec3(0.78, 0.96, 1.0) * glow;
    alpha += glow * 0.7;
  }
  col *= mix(uGradeTint, uGradeDeep, 0.35);
  gl_FragColor = vec4(col, alpha);
}
`;

const CAUSTIC_FRAG = /* glsl */ `
varying vec2 vPos;
uniform float uTime;
uniform float uCausticFps;
uniform float uScroll;
uniform sampler2D uMap;
void main() {
  float phase = uCausticFps > 0.0 ? mod(uTime * uCausticFps, 4.0) : 0.0;
  float f0 = floor(phase);
  float f1 = mod(f0 + 1.0, 4.0);
  vec2 crawl = vPos + uTime * vec2(0.2, 0.08) * uScroll;
  vec2 uv0 = vec2(fract(crawl.x / 8.0) * 0.25 + f0 * 0.25, fract(crawl.y / 8.0));
  vec2 uv1 = vec2(fract(crawl.x / 8.0) * 0.25 + f1 * 0.25, fract(crawl.y / 8.0));
  vec4 tex = mix(texture2D(uMap, uv0), texture2D(uMap, uv1), fract(phase));
  float fade = smoothstep(108.0, 70.0, length(vPos));
  float alpha = tex.a * 0.45 * fade;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(tex.rgb, alpha);
  #include <colorspace_fragment>
}
`;

const CAUSTIC_VERT = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

function stadiumTexture(file: string): THREE.Texture {
  const tex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}stadium/textures/${file}`);
  applyPixelTexel(tex);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export interface WaterMeshes {
  trailGroup: THREE.Group;
  classicMesh: THREE.Mesh;
  caustic: THREE.Mesh;
  update(
    time: number,
    cameraPosition: THREE.Vector3,
    ballPosition: THREE.Vector3,
    nearShell: number,
    impact: number,
    style: 'trailbound' | 'classic',
    radius: number,
  ): void;
  resize(radius: number): void;
  setCausticFps(fps: number): void;
  setCausticScroll(speed: number): void;
  setLightBands(on: boolean): void;
  setGrade(tint: [number, number, number], deep: [number, number, number]): void;
}

export function createWaterMeshes(): WaterMeshes {
  const caustics = stadiumTexture('water/water_caustics_anim_4f_1024x256.png');
  const bands = stadiumTexture('water/water_shell_bands_256.png');
  const overlay = stadiumTexture('water/caustics_light_overlay_4f_1024x256.png');

  const uniforms = {
    uTime: { value: 0 },
    uCameraPos: { value: new THREE.Vector3() },
    uBallPos: { value: new THREE.Vector3() },
    uRadius: { value: 68 },
    uNear: { value: 0 },
    uImpact: { value: 0 },
    uInside: { value: 0 },
    uLayer: { value: 0 },
    uCaustics: { value: caustics },
    uBands: { value: bands },
    uCausticFps: { value: CAUSTIC_FPS_DEFAULT },
    uScroll: { value: CAUSTIC_SCROLL_DEFAULT },
    uBandsOn: { value: LIGHT_BANDS_DEFAULT ? 1 : 0 },
    uGradeTint: { value: new THREE.Vector3(1, 1, 1) },
    uGradeDeep: { value: new THREE.Vector3(1, 1, 1) },
  };

  const bind = (mat: THREE.ShaderMaterial, keys: string[]) => {
    const bag = mat.uniforms;
    const source = uniforms as unknown as Record<string, { value: unknown }>;
    for (const key of keys) {
      if (bag[key] && source[key]) bag[key] = source[key];
    }
  };
  const shared = [
    'uTime',
    'uCameraPos',
    'uBallPos',
    'uRadius',
    'uNear',
    'uImpact',
    'uInside',
    'uCaustics',
    'uBands',
    'uCausticFps',
    'uScroll',
    'uBandsOn',
    'uGradeTint',
    'uGradeDeep',
  ];

  const makeShell = (layer: number, side: THREE.Side) => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side,
      uniforms: { ...uniforms, uLayer: { value: layer } },
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
    });
    bind(mat, shared);
    return mat;
  };

  const trailGroup = new THREE.Group();
  trailGroup.name = 'trailbound-water';
  const front = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 72), makeShell(0, THREE.FrontSide));
  front.name = 'water-front';
  front.renderOrder = 3;
  const inner = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 72), makeShell(1, THREE.BackSide));
  inner.name = 'water-inner';
  inner.renderOrder = 1;
  inner.scale.setScalar(0.985);

  const haloMat = (ring: number) => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uCameraPos: { value: new THREE.Vector3() },
        uRing: { value: ring },
      },
      vertexShader: SHELL_VERT,
      fragmentShader: HALO_FRAG,
    });
    bind(mat, ['uCameraPos']);
    return mat;
  };
  const haloA = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), haloMat(0));
  const haloB = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), haloMat(1));
  haloA.renderOrder = 4;
  haloB.renderOrder = 4;
  haloA.scale.setScalar(1.03);
  haloB.scale.setScalar(1.06);
  trailGroup.add(inner, front, haloA, haloB);

  const classicMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: {
      uTime: uniforms.uTime,
      uCameraPos: uniforms.uCameraPos,
      uBallPos: uniforms.uBallPos,
      uRadius: uniforms.uRadius,
      uNear: uniforms.uNear,
      uImpact: uniforms.uImpact,
      uGradeTint: uniforms.uGradeTint,
      uGradeDeep: uniforms.uGradeDeep,
    },
    vertexShader: CLASSIC_VERT,
    fragmentShader: CLASSIC_FRAG,
  });
  bind(classicMat, ['uTime', 'uCameraPos', 'uBallPos', 'uRadius', 'uNear', 'uImpact', 'uGradeTint', 'uGradeDeep']);
  const classicMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 72), classicMat);
  classicMesh.name = 'classic-water';
  classicMesh.renderOrder = 2;
  classicMesh.visible = false;

  const causticMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uTime: uniforms.uTime,
      uCausticFps: uniforms.uCausticFps,
      uScroll: uniforms.uScroll,
      uMap: { value: overlay },
    },
    vertexShader: CAUSTIC_VERT,
    fragmentShader: CAUSTIC_FRAG,
  });
  bind(causticMat, ['uTime', 'uCausticFps', 'uScroll']);
  const caustic = new THREE.Mesh(new THREE.CircleGeometry(108, 64), causticMat);
  caustic.name = 'caustic-overlay';
  caustic.rotation.x = -Math.PI / 2;
  caustic.position.y = 0.45;
  caustic.renderOrder = 2;
  caustic.frustumCulled = false;

  const resize = (radius: number) => {
    front.scale.setScalar(radius);
    inner.scale.setScalar(radius * 0.985);
    haloA.scale.setScalar(radius * 1.03);
    haloB.scale.setScalar(radius * 1.06);
    classicMesh.scale.setScalar(radius);
    uniforms.uRadius.value = radius;
  };

  resize(68);

  return {
    trailGroup,
    classicMesh,
    caustic,
    resize,
    setCausticFps(fps: number): void {
      uniforms.uCausticFps.value = Math.max(0, fps);
    },
    setCausticScroll(speed: number): void {
      uniforms.uScroll.value = Math.max(0, speed);
    },
    setLightBands(on: boolean): void {
      uniforms.uBandsOn.value = on ? 1 : 0;
    },
    setGrade(tint, deep): void {
      uniforms.uGradeTint.value.set(tint[0], tint[1], tint[2]);
      uniforms.uGradeDeep.value.set(deep[0], deep[1], deep[2]);
    },
    update(time, cameraPosition, ballPosition, nearShell, impact, style, radius) {
      uniforms.uTime.value = time;
      uniforms.uCameraPos.value.copy(cameraPosition);
      uniforms.uBallPos.value.copy(ballPosition);
      uniforms.uNear.value = nearShell;
      uniforms.uImpact.value = impact;
      uniforms.uRadius.value = radius;
      const inside = cameraPosition.length() < radius - 0.35;
      uniforms.uInside.value = inside ? 1 : 0;
      const trail = style === 'trailbound';
      trailGroup.visible = trail;
      classicMesh.visible = !trail;
      haloA.visible = trail && !inside;
      haloB.visible = trail && !inside;
      caustic.visible = trail;
    },
  };
}
