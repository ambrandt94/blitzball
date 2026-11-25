import * as THREE from 'three';
import { applyPixelTexel } from './pixelTexel';
import { buildCrowdSlots, crowdSpriteUv, type CrowdDensity } from './stadiumLayout';

/**
 * One instanced draw of cylindrical billboards. Atlas UVs are per instance.
 * They yaw toward the camera and bob. A goal forces the cheer frame.
 */
export class StadiumCrowd {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private material: THREE.MeshBasicMaterial | null = null;
  private texture: THREE.Texture | null = null;
  private density: CrowdDensity = 'off';
  private pending: CrowdDensity | null = null;
  private time = { value: 0 };
  private cheer = { value: 0 };
  private loading: Promise<void> | null = null;

  constructor() {
    this.group.name = 'crowd';
    this.group.frustumCulled = false;
  }

  setDensity(density: CrowdDensity): void {
    if (density === this.density && this.mesh) return;
    this.density = density;
    if (!this.texture) {
      this.pending = density;
      void this.load();
      return;
    }
    this.rebuild(density);
  }

  update(time: number, cheer: number): void {
    this.time.value = time;
    this.cheer.value = cheer;
  }

  private load(): Promise<void> {
    if (this.texture) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = new Promise((resolve) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        `${import.meta.env.BASE_URL}stadium/textures/crowd/crowd_atlas_256x128.png`,
        (tex) => {
          applyPixelTexel(tex, { mipmaps: false });
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.generateMipmaps = false;
          this.texture = tex;
          const next = this.pending ?? this.density;
          this.pending = null;
          if (next !== 'off') this.rebuild(next);
          resolve();
        },
        undefined,
        () => resolve(),
      );
    });
    return this.loading;
  }

  private rebuild(density: CrowdDensity): void {
    this.disposeMesh();
    if (density === 'off' || !this.texture) return;
    const slots = buildCrowdSlots(density);
    const count = slots.length;
    if (count === 0) return;

    const geo = new THREE.PlaneGeometry(1.15, 2.3);
    geo.translate(0, 0.5, 0);
    const uv = new Float32Array(count * 4);
    const phase = new Float32Array(count);
    const lively = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const slot = slots[i]!;
      const rect = crowdSpriteUv(slot.sprite);
      uv[i * 4] = rect[0];
      uv[i * 4 + 1] = rect[1];
      uv[i * 4 + 2] = rect[2];
      uv[i * 4 + 3] = rect[3];
      phase[i] = (slot.sprite * 0.37 + slot.x * 0.01 + slot.z * 0.013) % (Math.PI * 2);
      lively[i] = slot.lively;
    }
    geo.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(uv, 4));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute('aLively', new THREE.InstancedBufferAttribute(lively, 1));

    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      alphaTest: 0.45,
      transparent: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: true,
    });
    const time = this.time;
    const cheer = this.cheer;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.uniforms.uCheer = cheer;
      shader.vertexShader =
        'attribute vec4 aUvRect;\nattribute float aPhase;\nattribute float aLively;\nuniform float uTime;\nuniform float uCheer;\n' +
        shader.vertexShader
          .replace(
            'vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;',
            `float livelyCheer = aLively * step(0.72, fract(uTime * 0.33 + aPhase));
             float frame = clamp(uCheer + livelyCheer * (1.0 - uCheer), 0.0, 1.0);
             vMapUv = vec2(aUvRect.x + uv.x * aUvRect.z, aUvRect.y + uv.y * aUvRect.w - frame * 0.25);`,
          )
          .replace('#include <project_vertex>', CROWD_BILLBOARD);
    };
    material.customProgramCacheKey = () => 'crowd-billboard';

    const mesh = new THREE.InstancedMesh(geo, material, count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const slot = slots[i]!;
      dummy.position.set(slot.x, slot.y, slot.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.mesh = mesh;
    this.material = material;
    this.group.add(mesh);
  }

  private disposeMesh(): void {
    if (!this.mesh) return;
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material?.dispose();
    this.mesh = null;
    this.material = null;
  }
}

const CROWD_BILLBOARD = /* glsl */ `
vec3 crowdCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vec3 toCam = cameraPosition - crowdCenter;
toCam.y = 0.0;
float toLen = dot(toCam, toCam);
vec3 crowdFwd = toLen > 1e-8 ? toCam * inversesqrt(toLen) : vec3(0.0, 0.0, 1.0);
vec3 crowdRight = normalize(cross(vec3(0.0, 1.0, 0.0), crowdFwd));
float crowdScale = length(modelMatrix[0].xyz);
float bobAmp = mix(0.025, 0.12, clamp(uCheer, 0.0, 1.0));
float bob = sin(uTime * mix(2.1, 8.5, uCheer) + aPhase) * bobAmp;
vec4 mvPosition = viewMatrix * vec4(
  crowdCenter + crowdRight * position.x * crowdScale + vec3(0.0, (position.y + bob) * crowdScale, 0.0),
  1.0
);
gl_Position = projectionMatrix * mvPosition;
`;
