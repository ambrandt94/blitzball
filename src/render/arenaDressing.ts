import * as THREE from 'three';
import { ARENA_RADIUS, ARENA_REFERENCE } from '../game/constants';
import { attachStadium, type StadiumDetail } from './stadiumKit';
import type { CrowdDensity } from './stadiumLayout';
import { createWaterMeshes } from './waterShell';
import { patchSceneWaterFog, setWaterFogState, setWaterPalette } from './waterFog';
import { createWaterFallback, createWaterSphere, type WaterPresetName } from './waterSphere';
import { WATER_DEEP_DEFAULT, WATER_TINT_DEFAULT, gradeMul } from './waterSettings';

export type WaterStyle = 'trailbound' | 'classic';
export type WaterQuality = 'high' | 'low' | 'basic';

export interface ArenaVisuals {
  waterStyle: WaterStyle;
  waterPreset: WaterPresetName;
  waterRefraction: boolean;
  waterQuality: WaterQuality;
  /** 1 keeps the full buffer. 2 and 3 render smaller and upscale with hard pixels. */
  waterPixelScale: number;
  /** Web frames per second. 1.5 is the slowed default. */
  causticFps: number;
  /** Screen-space diagonal bands. Off unless the panel turns them on. */
  showLightBands: boolean;
  waterTint: string;
  waterDeep: string;
  waterFog: string;
  stadiumDetail: StadiumDetail;
  crowdDensity: CrowdDensity;
}

export interface WaterRig {
  update(
    time: number,
    cameraPosition: THREE.Vector3,
    sunbeams: boolean,
    intensity: number,
    ballPosition: THREE.Vector3,
    nearShell: number,
    impact: number,
  ): void;
  resize(): void;
  applyVisuals(visuals: ArenaVisuals): void;
  setCheer(amount: number): void;
  patchFog(root: THREE.Object3D): void;
  /** Refraction pass. Call immediately before the main render. */
  beforeRender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, time: number): void;
}

const beamVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const beamFragment = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uCameraPos;
  uniform float uIntensity;
  uniform float uPlayRadius;
  uniform float uTime;
  uniform float uPixel;
  float bayer4(vec2 p) {
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    if (y == 0) { if (x == 0) return 0.0; if (x == 1) return 0.5; if (x == 2) return 0.125; return 0.625; }
    if (y == 1) { if (x == 0) return 0.75; if (x == 1) return 0.25; if (x == 2) return 0.875; return 0.375; }
    if (y == 2) { if (x == 0) return 0.1875; if (x == 1) return 0.6875; if (x == 2) return 0.0625; return 0.5625; }
    if (x == 0) return 0.9375; if (x == 1) return 0.4375; if (x == 2) return 0.8125; return 0.3125;
  }
  void main() {
    float radial = length(vWorld);
    float play = smoothstep(uPlayRadius * 0.72, uPlayRadius * 0.98, radial);
    float camDist = distance(vWorld, uCameraPos);
    float nearCam = smoothstep(7.0, 18.0, camDist);
    float shimmer = 0.86 + 0.14 * sin(uTime * 0.6 + vWorld.y * 0.08);
    float alpha = 0.22 * uIntensity * play * nearCam * shimmer;
    if (uPixel > 0.5) {
      float b = bayer4(floor(gl_FragCoord.xy / 2.0));
      if (b > alpha * 3.0 && alpha < 0.4) discard;
      alpha = floor(alpha * 4.0 + 0.25) / 4.0;
    }
    if (alpha < 0.02) discard;
    vec3 col = uPixel > 0.5 ? vec3(0.549, 0.902, 0.910) : vec3(0.78, 0.94, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

function buildSunbeams(): { group: THREE.Group; material: THREE.ShaderMaterial } {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uCameraPos: { value: new THREE.Vector3() },
      uIntensity: { value: 1 },
      uTime: { value: 0 },
      uPlayRadius: { value: ARENA_RADIUS },
      uPixel: { value: 1 },
    },
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
  });
  const group = new THREE.Group();
  group.name = 'sunbeams';
  group.renderOrder = 12;
  group.layers.set(1);
  const count = 10;
  const dress = ARENA_RADIUS / ARENA_REFERENCE;
  for (let i = 0; i < count; i++) {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4 * dress, 6.5 * dress, 64 * dress, 12, 1, true),
      material,
    );
    const a = (i / count) * Math.PI * 2 + 0.2;
    const ring = ARENA_RADIUS - 7 * dress;
    beam.position.set(Math.cos(a) * ring, 14 * dress, Math.sin(a) * ring);
    const tilt = 0.34;
    beam.rotation.z = -Math.cos(a) * tilt;
    beam.rotation.x = Math.sin(a) * tilt;
    beam.userData.baseZ = beam.rotation.z;
    beam.userData.baseX = beam.rotation.x;
    beam.userData.phase = a;
    beam.layers.set(1);
    beam.renderOrder = 12;
    group.add(beam);
  }
  return { group, material };
}

function buildGuideRings(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'guide-rings';
  const dress = ARENA_RADIUS / ARENA_REFERENCE;
  for (const band of [
    { y: 0, opacity: 0.28 },
    { y: 18 * dress, opacity: 0.14 },
    { y: -18 * dress, opacity: 0.14 },
  ]) {
    const r = Math.sqrt(Math.max(0, ARENA_RADIUS * ARENA_RADIUS - band.y * band.y)) * 0.992;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.05, 6, 80),
      new THREE.MeshBasicMaterial({
        color: 0xb7e6fb,
        transparent: true,
        opacity: band.opacity,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = band.y;
    group.add(ring);
  }
  return group;
}

function disposeObject(obj: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) materials.add(mat);
  });
  for (const mat of materials) mat.dispose();
}

/** Shell, sunbeams, and the instanced Trailbound stadium. The kit scales with the arena. */
export function buildArenaDressing(scene: THREE.Scene, visuals: ArenaVisuals): WaterRig {
  const root = new THREE.Group();
  root.name = 'arena-dressing';
  scene.add(root);

  const water = createWaterMeshes();
  root.add(water.trailGroup, water.classicMesh);
  water.resize(ARENA_RADIUS);
  water.trailGroup.visible = false;

  const waterBase = `${import.meta.env.BASE_URL}stadium/textures/water/`;
  const sphere = createWaterSphere({
    radius: ARENA_RADIUS,
    base: waterBase,
    pixel: 2,
    preset: visuals.waterPreset,
    refraction: visuals.waterRefraction,
  });
  root.add(sphere.mesh);
  const fallback = createWaterFallback(ARENA_RADIUS, waterBase);
  root.add(fallback.group);
  fallback.group.visible = false;

  let beams = buildSunbeams();
  root.add(beams.group);
  let guides = buildGuideRings();
  root.add(guides);

  const stadium = attachStadium(root, ARENA_RADIUS);
  stadium.root.add(water.caustic);
  stadium.setDetail(visuals.stadiumDetail);
  stadium.setCrowd(visuals.crowdDensity);

  let style = visuals.waterStyle;
  let preset = visuals.waterPreset;
  let refraction = visuals.waterRefraction;
  let quality = visuals.waterQuality;
  let pixelScale = visuals.waterPixelScale;
  let causticFps = visuals.causticFps;
  let showLightBands = visuals.showLightBands;
  let waterTint = visuals.waterTint;
  let waterDeep = visuals.waterDeep;
  let waterFog = visuals.waterFog;
  let detail = visuals.stadiumDetail;
  let crowd: CrowdDensity = visuals.crowdDensity;
  const fog = scene.fog instanceof THREE.FogExp2 ? scene.fog : new THREE.FogExp2(0x0a4d66, 0.0065);
  scene.fog = fog;

  const applyWaterLook = () => {
    const tintMul = gradeMul(waterTint, WATER_TINT_DEFAULT);
    const deepMul = gradeMul(waterDeep, WATER_DEEP_DEFAULT);
    sphere.setCausticFps(causticFps);
    sphere.setLightBands(showLightBands);
    sphere.setColors(waterTint, waterDeep);
    water.setCausticFps(causticFps);
    water.setLightBands(showLightBands);
    water.setGrade(tintMul, deepMul);
    fallback.setColors(waterTint);
    setWaterPalette(waterTint, waterFog, waterDeep);
  };

  const showV2 = () => {
    const v2 = style === 'trailbound';
    const basic = v2 && quality === 'basic';
    sphere.mesh.visible = v2 && !basic;
    fallback.group.visible = basic;
    water.trailGroup.visible = false;
    water.classicMesh.visible = !v2;
    water.caustic.visible = false;
  };

  const applyFogLook = (inside: boolean) => {
    // v2 paints its own inside steps. The older per-material fog stays on Classic only.
    setWaterFogState('classic', inside, ARENA_RADIUS);
    const dress = ARENA_REFERENCE / ARENA_RADIUS;
    if (style === 'trailbound' && !inside) {
      fog.color.set(0x8ec8ea);
      fog.density = 0.0011 * dress;
    } else if (style === 'classic') {
      fog.color.set(0x0a4d66);
      fog.density = 0.0065 * dress;
    } else {
      fog.color.set(waterFog);
      fog.density = 0.0022 * dress;
    }
    guides.visible = style === 'classic';
    beams.material.uniforms.uPixel!.value = style === 'trailbound' ? 1 : 0;
    showV2();
  };

  applyWaterLook();
  applyFogLook(true);

  return {
    update(time, cameraPosition, sunbeams, intensity, ballPosition, nearShell, impact) {
      const inside = cameraPosition.length() < ARENA_RADIUS - 0.35;
      water.update(time, cameraPosition, ballPosition, nearShell, impact, style, ARENA_RADIUS);
      showV2();
      stadium.update(time);
      applyFogLook(inside);
      const strength = sunbeams ? Math.max(0, intensity) : 0;
      beams.group.visible = strength > 0.001;
      beams.material.uniforms.uIntensity!.value = strength;
      beams.material.uniforms.uPlayRadius!.value = ARENA_RADIUS;
      (beams.material.uniforms.uCameraPos!.value as THREE.Vector3).copy(cameraPosition);
      beams.material.uniforms.uTime!.value = time;
      for (const beam of beams.group.children) {
        const phase = beam.userData.phase as number;
        beam.rotation.z = (beam.userData.baseZ as number) + Math.sin(time * 0.35 + phase) * 0.04;
        beam.rotation.x = (beam.userData.baseX as number) + Math.cos(time * 0.28 + phase) * 0.035;
      }
    },
    resize() {
      water.resize(ARENA_RADIUS);
      sphere.setRadius(ARENA_RADIUS);
      fallback.setRadius(ARENA_RADIUS);
      stadium.resize(ARENA_RADIUS);
      root.remove(beams.group);
      disposeObject(beams.group);
      beams = buildSunbeams();
      root.add(beams.group);
      root.remove(guides);
      disposeObject(guides);
      guides = buildGuideRings();
      root.add(guides);
      guides.visible = style === 'classic';
    },
    applyVisuals(next) {
      style = next.waterStyle;
      preset = next.waterPreset;
      refraction = next.waterRefraction;
      quality = next.waterQuality;
      pixelScale = next.waterPixelScale;
      causticFps = next.causticFps;
      showLightBands = next.showLightBands;
      waterTint = next.waterTint;
      waterDeep = next.waterDeep;
      waterFog = next.waterFog;
      detail = next.stadiumDetail;
      crowd = next.crowdDensity;
      sphere.applyPreset(preset);
      applyWaterLook();
      sphere.setRefraction(refraction && quality !== 'basic');
      if (quality === 'high' || quality === 'low') sphere.setQuality(quality);
      stadium.setDetail(detail);
      stadium.setCrowd(detail === 'off' ? 'off' : crowd);
      showV2();
    },
    setCheer(amount) {
      stadium.setCheer(amount);
    },
    patchFog(rootObject) {
      patchSceneWaterFog(rootObject);
    },
    beforeRender(renderer, scene, camera, time) {
      if (style !== 'trailbound') return;
      if (quality === 'basic') {
        applyWaterLook();
        fallback.update(camera, time, causticFps);
        return;
      }
      const chunk = pixelScale > 1 ? 1 : 2;
      sphere.setPixel(chunk);
      sphere.setRefraction(refraction);
      sphere.setQuality(quality === 'low' ? 'low' : 'high');
      sphere.applyPreset(preset);
      applyWaterLook();
      sphere.update(renderer, scene, camera, time);
    },
  };
}
