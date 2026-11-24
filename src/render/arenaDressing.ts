import * as THREE from 'three';
import { ARENA_RADIUS } from '../game/constants';

export interface WaterRig {
  update(time: number, cameraPosition: THREE.Vector3): void;
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
  const shell = new THREE.Mesh(new THREE.SphereGeometry(ARENA_RADIUS, 96, 72), shellMat);
  scene.add(shell);

  // Faint latitude guides replace the old wireframe shell.
  for (const band of [
    { y: 0, opacity: 0.28 },
    { y: 18, opacity: 0.14 },
    { y: -18, opacity: 0.14 },
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
    scene.add(ring);
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
  scene.add(axis);

  const beams = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xd8f7ff,
    transparent: true,
    opacity: 0.055,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  for (let i = 0; i < 7; i++) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 14, 90, 28, 1, true), beamMat);
    const a = (i / 7) * Math.PI * 2;
    beam.position.set(Math.cos(a) * 16, 18, Math.sin(a) * 16);
    beam.rotation.z = Math.sin(a) * 0.18;
    beam.rotation.x = Math.cos(a) * 0.14;
    beam.userData.baseZ = beam.rotation.z;
    beam.userData.baseX = beam.rotation.x;
    beam.userData.phase = a;
    beams.add(beam);
  }
  scene.add(beams);

  buildStadium(scene);

  return {
    update(time: number, cameraPosition: THREE.Vector3) {
      shellMat.uniforms.uTime!.value = time;
      (shellMat.uniforms.uCameraPos!.value as THREE.Vector3).copy(cameraPosition);
      for (const beam of beams.children) {
        const phase = beam.userData.phase as number;
        beam.rotation.z = (beam.userData.baseZ as number) + Math.sin(time * 0.35 + phase) * 0.06;
        beam.rotation.x = (beam.userData.baseX as number) + Math.cos(time * 0.28 + phase) * 0.05;
      }
    },
  };
}

function buildStadium(scene: THREE.Scene): void {
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

  const lip = new THREE.Mesh(new THREE.TorusGeometry(ARENA_RADIUS + 1.5, 1.35, 10, 72), metal);
  lip.rotation.x = Math.PI / 2;
  bowl.add(lip);

  const tiers = [
    { y: -6, r: 68, tube: 2.6, mat: dark },
    { y: 6, r: 78, tube: 2.8, mat: stone },
    { y: 18, r: 90, tube: 3.1, mat: stone },
    { y: 30, r: 102, tube: 2.4, mat: dark },
  ];
  for (const tier of tiers) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(tier.r, tier.tube, 10, 56), tier.mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = tier.y;
    bowl.add(ring);
    const lamp = new THREE.Mesh(new THREE.TorusGeometry(tier.r, 0.16, 6, 56), warm);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.y = tier.y + tier.tube * 0.72;
    bowl.add(lamp);
  }

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = 86;
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.05, 46, 7), stone);
    pylon.position.set(Math.cos(a) * r, 10, Math.sin(a) * r);
    bowl.add(pylon);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.25, 10, 8), warm);
    cap.position.set(Math.cos(a) * r, 33.5, Math.sin(a) * r);
    bowl.add(cap);

    const arch = new THREE.Mesh(new THREE.TorusGeometry(14, 0.42, 6, 18, Math.PI), metal);
    arch.position.set(Math.cos(a) * 74, 2, Math.sin(a) * 74);
    // Stand the half-ring upright and open it toward the sphere.
    arch.rotation.y = -a;
    arch.rotation.z = Math.PI;
    bowl.add(arch);
  }

  const crown = new THREE.Mesh(new THREE.TorusGeometry(108, 0.7, 8, 64), metal);
  crown.rotation.x = Math.PI / 2;
  crown.position.y = 36;
  bowl.add(crown);

  // A lit arch just outside each goal, so the bowl reads while you look down the pitch.
  for (const z of [64, -64]) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(16, 0.7, 10, 28, Math.PI), metal);
    arch.position.set(0, 0, z);
    bowl.add(arch);
    const keystone = new THREE.Mesh(new THREE.BoxGeometry(34, 1.1, 1.3), warm);
    keystone.position.set(0, 16, z);
    bowl.add(keystone);
    for (const x of [-16, 16]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.15, 28, 8), stone);
      pillar.position.set(x, 2, z);
      bowl.add(pillar);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), warm);
      lamp.position.set(x, 18, z);
      bowl.add(lamp);
    }
  }

  scene.add(bowl);
}
