import * as THREE from 'three';
import { WATER_FOG_CAP, WATER_FOG_DENSITY_MAX, fogDensityFromClarity } from './waterSettings';

/**
 * One exponential-squared falloff for everything inside the sphere.
 * The first `uFogStart` metres stay true. Past that, colour eases toward
 * deep water and stops at `uFogCap`, so the far side stays readable.
 * Outside the shell the same mix eases toward a lighter tint instead of
 * posterizing. Classic water leaves three.js exp fog alone.
 */
export const waterFogUniforms = {
  /** 0 classic exp2, 1 full underwater falloff. Values between ease the two. */
  trail: { value: 0 },
  density: { value: fogDensityFromClarity(0.68) },
  start: { value: 8 },
  cap: { value: WATER_FOG_CAP },
  nearC: { value: new THREE.Color('#2E8A84') },
  midC: { value: new THREE.Color('#1F6066') },
  farC: { value: new THREE.Color('#163A48') },
  outA: { value: new THREE.Color('#2A9EAE') },
  outB: { value: new THREE.Color('#5ED2DC') },
  radius: { value: 68 },
};

const FOG_CHUNK = /* glsl */ `
#ifdef USE_FOG
  if (uTrailFog > 0.001) {
    float dist = max(0.0, vFogDepth - uFogStart);
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    fogFactor = min(fogFactor, uFogCap) * clamp(uTrailFog, 0.0, 1.0);
    vec3 fc = uFogFarC;
    float outside = smoothstep(uArenaRadius * 0.985, uArenaRadius * 1.1, length(vTrailWorld));
    fc = mix(fc, uFogOutA, outside);
    fogFactor *= mix(1.0, 0.28, outside);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, fogFactor);
  } else {
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  }
#endif
`;

export function installWaterFog(shader: {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}): void {
  shader.uniforms.uTrailFog = waterFogUniforms.trail;
  shader.uniforms.uFogDensity = waterFogUniforms.density;
  shader.uniforms.uFogStart = waterFogUniforms.start;
  shader.uniforms.uFogCap = waterFogUniforms.cap;
  shader.uniforms.uFogNearC = waterFogUniforms.nearC;
  shader.uniforms.uFogMidC = waterFogUniforms.midC;
  shader.uniforms.uFogFarC = waterFogUniforms.farC;
  shader.uniforms.uFogOutA = waterFogUniforms.outA;
  shader.uniforms.uFogOutB = waterFogUniforms.outB;
  shader.uniforms.uArenaRadius = waterFogUniforms.radius;
  if (shader.vertexShader.includes('vTrailWorld')) return;
  const worldAssign = `
      vec4 trailWorldPos = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        trailWorldPos = instanceMatrix * trailWorldPos;
      #endif
      #ifdef USE_BATCHING
        trailWorldPos = batchingMatrix * trailWorldPos;
      #endif
      vTrailWorld = (modelMatrix * trailWorldPos).xyz;`;
  shader.vertexShader = 'varying vec3 vTrailWorld;\n' + shader.vertexShader;
  if (shader.vertexShader.includes('#include <project_vertex>')) {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      ${worldAssign}`,
    );
  } else {
    shader.vertexShader = shader.vertexShader.replace(
      'gl_Position = projectionMatrix * mvPosition;',
      `${worldAssign}
      gl_Position = projectionMatrix * mvPosition;`,
    );
  }
  shader.fragmentShader =
    'varying vec3 vTrailWorld;\nuniform float uTrailFog;\nuniform float uFogDensity;\nuniform float uFogStart;\nuniform float uFogCap;\nuniform vec3 uFogNearC;\nuniform vec3 uFogMidC;\nuniform vec3 uFogFarC;\nuniform vec3 uFogOutA;\nuniform vec3 uFogOutB;\nuniform float uArenaRadius;\n' +
    shader.fragmentShader.replace('#include <fog_fragment>', FOG_CHUNK);
}

type FogMaterial = THREE.Material & {
  fog?: boolean;
  userData: { waterFog?: boolean };
};

/** Patch a lit or basic material once. Later clones inherit the compile hook. */
export function ensureWaterFog(material: THREE.Material): void {
  const mat = material as FogMaterial;
  if (mat.userData.waterFog) return;
  if (mat.fog === false) return;
  const lit =
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshBasicMaterial ||
    material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshPhongMaterial;
  if (!lit) return;
  mat.userData.waterFog = true;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    installWaterFog(shader);
  };
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|waterfog-exp2`;
  material.needsUpdate = true;
}

export function patchSceneWaterFog(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh && !(obj as THREE.Sprite).isSprite) return;
    const material = (obj as THREE.Mesh).material;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const entry of list) ensureWaterFog(entry);
  });
}

/** Near tint and the deep-water target. The mid colour is kept for the palette. */
export function setWaterPalette(tint: string, fog: string, deep: string): void {
  waterFogUniforms.nearC.value.set(tint);
  waterFogUniforms.midC.value.set(fog);
  waterFogUniforms.farC.value.set(deep);
}

/** `inside` is 0 outside the shell and 1 deep inside. Values between are the ease. */
export function setWaterFogState(style: 'trailbound' | 'classic', inside: number, arenaRadius: number): void {
  waterFogUniforms.radius.value = arenaRadius;
  waterFogUniforms.trail.value = style === 'trailbound' ? THREE.MathUtils.clamp(inside, 0, 1) : 0;
}

export function setWaterFalloff(density: number, start: number, cap = WATER_FOG_CAP): void {
  waterFogUniforms.density.value = Math.min(WATER_FOG_DENSITY_MAX, Math.max(0, density));
  waterFogUniforms.start.value = Math.max(0, start);
  waterFogUniforms.cap.value = cap;
}
