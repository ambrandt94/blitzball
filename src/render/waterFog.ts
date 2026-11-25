import * as THREE from 'three';

/**
 * Inside the sphere the water is three hard steps (sphere_palette.json).
 * Outside the play volume, the stands pick up a cyan posterize instead of
 * the deep fog, so the crowd still reads when you look out through the shell.
 * Classic water leaves three.js exp fog alone.
 */
export const waterFogUniforms = {
  trail: { value: 0 },
  edges: { value: new THREE.Vector3(6, 14, 26) },
  nearC: { value: new THREE.Color('#2E8A84') },
  midC: { value: new THREE.Color('#1F6066') },
  farC: { value: new THREE.Color('#163A48') },
  outA: { value: new THREE.Color('#2A9EAE') },
  outB: { value: new THREE.Color('#5ED2DC') },
  radius: { value: 68 },
};

const FOG_CHUNK = /* glsl */ `
#ifdef USE_FOG
  if (uTrailFog > 0.5) {
    float b = bayer4(gl_FragCoord.xy);
    float dist = vFogDepth;
    float seam = 0.0;
    if (abs(dist - uFogEdges.x) < 0.55 || abs(dist - uFogEdges.y) < 0.55 || abs(dist - uFogEdges.z) < 0.55) {
      seam = (b - 0.5) * 1.05;
    }
    float d = dist + seam;
    vec3 fc = uFogNearC;
    float m = 0.22;
    if (d > uFogEdges.x) { fc = uFogNearC; m = 0.48; }
    if (d > uFogEdges.y) { fc = uFogMidC; m = 0.7; }
    if (d > uFogEdges.z) { fc = uFogFarC; m = 0.85; }
    if (length(vTrailWorld) > uArenaRadius * 1.01) {
      float band = step(0.45, fract(vTrailWorld.y * 0.08 + b * 0.15));
      fc = mix(uFogOutA, uFogOutB, band);
      m = 0.34;
    }
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, m);
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

const BAYER = /* glsl */ `
float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  if (y == 0) { if (x == 0) return 0.0; if (x == 1) return 0.5; if (x == 2) return 0.125; return 0.625; }
  if (y == 1) { if (x == 0) return 0.75; if (x == 1) return 0.25; if (x == 2) return 0.875; return 0.375; }
  if (y == 2) { if (x == 0) return 0.1875; if (x == 1) return 0.6875; if (x == 2) return 0.0625; return 0.5625; }
  if (x == 0) return 0.9375; if (x == 1) return 0.4375; if (x == 2) return 0.8125; return 0.3125;
}
`;

export function installWaterFog(shader: {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}): void {
  shader.uniforms.uTrailFog = waterFogUniforms.trail;
  shader.uniforms.uFogEdges = waterFogUniforms.edges;
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
    'varying vec3 vTrailWorld;\nuniform float uTrailFog;\nuniform vec3 uFogEdges;\nuniform vec3 uFogNearC;\nuniform vec3 uFogMidC;\nuniform vec3 uFogFarC;\nuniform vec3 uFogOutA;\nuniform vec3 uFogOutB;\nuniform float uArenaRadius;\n' +
    BAYER +
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
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|trailfog`;
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

/** Near, mid, and far fog steps. Defaults match the Clearer palette. */
export function setWaterPalette(tint: string, fog: string, deep: string): void {
  waterFogUniforms.nearC.value.set(tint);
  waterFogUniforms.midC.value.set(fog);
  waterFogUniforms.farC.value.set(deep);
}

export function setWaterFogState(style: 'trailbound' | 'classic', inside: boolean, arenaRadius: number): void {
  const scale = arenaRadius / 68;
  waterFogUniforms.radius.value = arenaRadius;
  waterFogUniforms.edges.value.set(6 * scale, 14 * scale, 26 * scale);
  waterFogUniforms.trail.value = style === 'trailbound' && inside ? 1 : 0;
}
