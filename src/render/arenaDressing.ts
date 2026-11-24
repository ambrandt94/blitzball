import * as THREE from 'three';
import { ARENA_RADIUS, ARENA_REFERENCE } from '../game/constants';

export interface WaterRig {
  update(time: number, cameraPosition: THREE.Vector3, sunbeams: boolean, intensity: number): void;
}

const shellVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const shellFragment = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  uniform float uTime;
  uniform vec3 uCameraPos;
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
    gl_FragColor = vec4(col, alpha);
  }
`;

/** Translucent shell, caustic shimmer, sunbeams, guide rings, and the stadium bowl. */
export function buildArenaDressing(scene: THREE.Scene): WaterRig {
  const shellMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: {
      uTime: { value: 0 },
      uCameraPos: { value: new THREE.Vector3() },
    },
    vertexShader: shellVertex,
    fragmentShader: shellFragment,
  });
  const root = new THREE.Group();
  root.name = 'arena-dressing';
  const dress = ARENA_RADIUS / ARENA_REFERENCE;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(ARENA_RADIUS, 96, 72), shellMat);
  root.add(shell);

  // Faint latitude guides replace the old wireframe shell.
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
    root.add(ring);
  }

  const axis = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, ARENA_RADIUS * 1.7, 6),
    new THREE.MeshBasicMaterial({
      color: 0x9fd4ee,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  axis.rotation.x = Math.PI / 2;
  root.add(axis);

  const beams = buildSunbeams();
  root.add(beams.group);

  buildStadium(root);
  scene.add(root);

  return {
    update(time: number, cameraPosition: THREE.Vector3, sunbeams: boolean, intensity: number) {
      shellMat.uniforms.uTime!.value = time;
      (shellMat.uniforms.uCameraPos!.value as THREE.Vector3).copy(cameraPosition);
      const strength = sunbeams ? Math.max(0, intensity) : 0;
      beams.group.visible = strength > 0.001;
      beams.material.uniforms.uIntensity!.value = strength;
      (beams.material.uniforms.uCameraPos!.value as THREE.Vector3).copy(cameraPosition);
      beams.material.uniforms.uTime!.value = time;
      for (const beam of beams.group.children) {
        const phase = beam.userData.phase as number;
        beam.rotation.z = (beam.userData.baseZ as number) + Math.sin(time * 0.35 + phase) * 0.04;
        beam.rotation.x = (beam.userData.baseX as number) + Math.cos(time * 0.28 + phase) * 0.035;
      }
    },
  };
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
  void main() {
    float radial = length(vWorld);
    // Full at the shell, gone through the middle of the pitch.
    float play = smoothstep(uPlayRadius * 0.72, uPlayRadius * 0.98, radial);
    float camDist = distance(vWorld, uCameraPos);
    float nearCam = smoothstep(7.0, 18.0, camDist);
    float shimmer = 0.86 + 0.14 * sin(uTime * 0.6 + vWorld.y * 0.08);
    float alpha = 0.2 * uIntensity * play * nearCam * shimmer;
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(vec3(0.78, 0.94, 1.0), alpha);
  }
`;

/**
 * Shafts sit on the shell, leaning out toward the stadium lamps.
 * The shader drops them in the play volume and next to the camera so a
 * chase view is not looking through a cone.
 */
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
    },
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
  });
  const group = new THREE.Group();
  group.name = 'sunbeams';
  const count = 10;
  const dress = ARENA_RADIUS / ARENA_REFERENCE;
  for (let i = 0; i < count; i++) {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4 * dress, 6.5 * dress, 64 * dress, 20, 1, true),
      material,
    );
    const a = (i / count) * Math.PI * 2 + 0.2;
    // Just inside the glass, so the shaft reads in the water and not across the pitch.
    const ring = ARENA_RADIUS - 7 * dress;
    beam.position.set(Math.cos(a) * ring, 14 * dress, Math.sin(a) * ring);
    // Lean the top outward, toward the bowl, rather than in across the pitch.
    const tilt = 0.34;
    beam.rotation.z = -Math.cos(a) * tilt;
    beam.rotation.x = Math.sin(a) * tilt;
    beam.userData.baseZ = beam.rotation.z;
    beam.userData.baseX = beam.rotation.x;
    beam.userData.phase = a;
    group.add(beam);
  }
  return { group, material };
}

function buildStadium(parent: THREE.Object3D): void {
  const bowl = new THREE.Group();
  bowl.name = 'stadium';

  const stone = new THREE.MeshStandardMaterial({
    color: 0x3a332b,
    roughness: 0.78,
    metalness: 0.18,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x16120e,
    roughness: 0.86,
    metalness: 0.22,
  });
  const warm = new THREE.MeshStandardMaterial({
    color: 0xffc56a,
    emissive: 0xff7a1a,
    emissiveIntensity: 2.4,
    roughness: 0.32,
    metalness: 0.15,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0x8d8274,
    roughness: 0.42,
    metalness: 0.62,
  });

  const s = ARENA_RADIUS / ARENA_REFERENCE;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(ARENA_RADIUS + 1.5 * s, 1.35 * s, 10, 72), metal);
  lip.rotation.x = Math.PI / 2;
  bowl.add(lip);

  const tiers = [
    { y: -6 * s, r: ARENA_RADIUS + 12 * s, tube: 2.6 * s, mat: dark },
    { y: 6 * s, r: ARENA_RADIUS + 22 * s, tube: 2.8 * s, mat: stone },
    { y: 18 * s, r: ARENA_RADIUS + 34 * s, tube: 3.1 * s, mat: stone },
    { y: 30 * s, r: ARENA_RADIUS + 46 * s, tube: 2.4 * s, mat: dark },
  ];
  for (const tier of tiers) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(tier.r, tier.tube, 10, 56), tier.mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = tier.y;
    bowl.add(ring);
    const lamp = new THREE.Mesh(new THREE.TorusGeometry(tier.r, 0.16 * s, 6, 56), warm);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.y = tier.y + tier.tube * 0.72;
    bowl.add(lamp);
  }

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = ARENA_RADIUS + 30 * s;
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.55 * s, 1.05 * s, 46 * s, 7), stone);
    pylon.position.set(Math.cos(a) * r, 10 * s, Math.sin(a) * r);
    bowl.add(pylon);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.25 * s, 10, 8), warm);
    cap.position.set(Math.cos(a) * r, 33.5 * s, Math.sin(a) * r);
    bowl.add(cap);

    const arch = new THREE.Mesh(new THREE.TorusGeometry(14 * s, 0.42 * s, 6, 18, Math.PI), metal);
    arch.position.set(Math.cos(a) * (ARENA_RADIUS + 18 * s), 2 * s, Math.sin(a) * (ARENA_RADIUS + 18 * s));
    // Stand the half-ring upright and open it toward the sphere.
    arch.rotation.y = -a;
    arch.rotation.z = Math.PI;
    bowl.add(arch);
  }

  const crown = new THREE.Mesh(new THREE.TorusGeometry(ARENA_RADIUS + 52 * s, 0.7 * s, 8, 64), metal);
  crown.rotation.x = Math.PI / 2;
  crown.position.y = 36 * s;
  bowl.add(crown);

  // A lit arch just outside each goal, so the bowl reads while you look down the pitch.
  for (const sign of [1, -1]) {
    const z = sign * (ARENA_RADIUS + 8 * s);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(16 * s, 0.7 * s, 10, 28, Math.PI), metal);
    arch.position.set(0, 0, z);
    bowl.add(arch);
    const keystone = new THREE.Mesh(new THREE.BoxGeometry(34 * s, 1.1 * s, 1.3 * s), warm);
    keystone.position.set(0, 16 * s, z);
    bowl.add(keystone);
    for (const x of [-16 * s, 16 * s]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.85 * s, 1.15 * s, 28 * s, 8), stone);
      pillar.position.set(x, 2 * s, z);
      bowl.add(pillar);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.6 * s, 12, 10), warm);
      lamp.position.set(x, 18 * s, z);
      bowl.add(lamp);
    }
  }

  parent.add(bowl);
}
