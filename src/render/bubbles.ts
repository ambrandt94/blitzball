import * as THREE from 'three';
import { applyPixelTexel } from './pixelTexel';

interface Bubble {
  life: number;
  maxLife: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  phase: number;
  wobble: number;
  rise: number;
  size: number;
}

export interface BubbleEmit {
  origin: THREE.Vector3;
  /** Unit direction the trail should leave along (behind the motion). */
  direction: THREE.Vector3;
  /** How hard the bubble is kicked backward. */
  kick: number;
  life: number;
  size: number;
  rise: number;
  spread: number;
}

/**
 * One instanced draw for a pool of bubbles. Dead slots are scaled to zero.
 * Trails rise, wobble, and shrink out instead of popping.
 */
const BUBBLE_BILLBOARD = /* glsl */ `
vec3 bubbleCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
float bubbleScale = length(instanceMatrix[0].xyz);
vec3 bubbleRight = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
vec3 bubbleUp = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
vec4 mvPosition = viewMatrix * vec4(bubbleCenter + (bubbleRight * position.x + bubbleUp * position.y) * bubbleScale * 2.0, 1.0);
gl_Position = projectionMatrix * mvPosition;
`;

let bubbleTexture: THREE.Texture | null = null;
let bubbleTextureLoading: Promise<THREE.Texture | null> | null = null;

function loadBubbleTexture(): Promise<THREE.Texture | null> {
  if (bubbleTexture) return Promise.resolve(bubbleTexture);
  if (bubbleTextureLoading) return bubbleTextureLoading;
  bubbleTextureLoading = new Promise((resolve) => {
    new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}stadium/textures/water/bubbles_64.png`,
      (tex) => {
        applyPixelTexel(tex, { mipmaps: false });
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = false;
        bubbleTexture = tex;
        resolve(tex);
      },
      undefined,
      () => resolve(null),
    );
  });
  return bubbleTextureLoading;
}

export class BubblePool {
  readonly mesh: THREE.InstancedMesh;
  private slots: Bubble[];
  private dummy = new THREE.Object3D();
  private cursor = 0;
  private scratch = new THREE.Vector3();
  private time = 0;
  private readonly timeUniform = { value: 0 };
  private readonly rowAttr: THREE.InstancedBufferAttribute;
  private readonly phaseAttr: THREE.InstancedBufferAttribute;
  private readonly popAttr: THREE.InstancedBufferAttribute;

  constructor(parent: THREE.Object3D, count: number, color: number, opacity: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const row = new Float32Array(count);
    const phase = new Float32Array(count);
    const pop = new Float32Array(count);
    for (let i = 0; i < count; i++) phase[i] = Math.random() * 8;
    this.rowAttr = new THREE.InstancedBufferAttribute(row, 1);
    this.phaseAttr = new THREE.InstancedBufferAttribute(phase, 1);
    this.popAttr = new THREE.InstancedBufferAttribute(pop, 1);
    geo.setAttribute('aRow', this.rowAttr);
    geo.setAttribute('aPhase', this.phaseAttr);
    geo.setAttribute('aPop', this.popAttr);
    const timeUniform = this.timeUniform;
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform;
      shader.vertexShader =
        'attribute float aRow;\nattribute float aPhase;\nattribute float aPop;\nuniform float uTime;\n' +
        shader.vertexShader
          .replace(
            'vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;',
            `float wob = mod(floor((uTime + aPhase) * 6.0), 4.0);
             float col = aPop > 0.5 ? 3.0 : (wob < 0.5 ? 0.0 : (wob < 1.5 ? 1.0 : (wob < 2.5 ? 0.0 : 2.0)));
             vMapUv = vec2((col + uv.x) / 4.0, 1.0 - (aRow + 1.0) / 4.0 + uv.y / 4.0);`,
          )
          .replace('#include <project_vertex>', BUBBLE_BILLBOARD);
    };
    mat.customProgramCacheKey = () => 'bubble-sheet';
    void loadBubbleTexture().then((tex) => {
      if (!tex) return;
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(1);
    this.mesh.renderOrder = 12;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parent.add(this.mesh);
    this.slots = [];
    for (let i = 0; i < count; i++) {
      this.slots.push({
        life: 0,
        maxLife: 1,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        phase: Math.random() * Math.PI * 2,
        wobble: 0.4,
        rise: 0.6,
        size: 0.08,
      });
      this.dummy.position.set(0, 0, 0);
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  emit(opts: BubbleEmit): void {
    const slot = this.slots[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.slots.length;
    const spread = opts.spread;
    slot.life = opts.life;
    slot.maxLife = opts.life;
    slot.size = opts.size;
    slot.rise = opts.rise;
    slot.wobble = 0.25 + Math.random() * 0.55;
    slot.phase = Math.random() * Math.PI * 2;
    slot.x = opts.origin.x + (Math.random() - 0.5) * spread;
    slot.y = opts.origin.y + (Math.random() - 0.5) * spread;
    slot.z = opts.origin.z + (Math.random() - 0.5) * spread;
    const kick = opts.kick * (0.65 + Math.random() * 0.5);
    slot.vx = opts.direction.x * kick + (Math.random() - 0.5) * spread * 1.4;
    slot.vy = opts.direction.y * kick + (Math.random() - 0.5) * spread * 1.4;
    slot.vz = opts.direction.z * kick + (Math.random() - 0.5) * spread * 1.4;
    this.paintSlot(this.cursor === 0 ? this.slots.length - 1 : this.cursor - 1, slot);
  }

  update(dt: number, up: THREE.Vector3): void {
    this.time += dt;
    this.timeUniform.value = this.time;
    const damp = Math.exp(-1.6 * dt);
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      if (slot.life <= 0) {
        this.dummy.scale.setScalar(0);
        this.dummy.position.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      slot.life -= dt;
      slot.vx *= damp;
      slot.vy *= damp;
      slot.vz *= damp;
      slot.phase += dt * (3.2 + slot.wobble * 2);
      const wob = Math.sin(slot.phase) * slot.wobble * dt;
      const wob2 = Math.cos(slot.phase * 0.8) * slot.wobble * dt;
      slot.x += slot.vx * dt + wob + up.x * slot.rise * dt;
      slot.y += slot.vy * dt + up.y * slot.rise * dt;
      slot.z += slot.vz * dt + wob2 + up.z * slot.rise * dt;
      const fade = Math.max(0, slot.life / slot.maxLife);
      const scale = slot.size * fade * (0.65 + 0.35 * fade);
      this.dummy.position.set(slot.x, slot.y, slot.z);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.popAttr.setX(i, slot.life > 0 && slot.life < 0.16 ? 1 : 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.popAttr.needsUpdate = true;
  }

  /** Ambient specks that drift inside the sphere and respawn when they leave. */
  seedMotes(count: number, radius: number): void {
    const n = Math.min(count, this.slots.length);
    for (let i = 0; i < n; i++) {
      const slot = this.slots[i]!;
      this.placeMote(i, slot, radius);
      slot.life = 8 + Math.random() * 10;
      slot.maxLife = slot.life;
    }
    this.cursor = n % this.slots.length;
  }

  driftMotes(dt: number, up: THREE.Vector3, radius: number): void {
    this.time += dt;
    this.timeUniform.value = this.time;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.phase += dt * 0.8;
      const wob = Math.sin(slot.phase) * slot.wobble * dt;
      slot.x += slot.vx * dt + wob + up.x * slot.rise * dt;
      slot.y += slot.vy * dt + up.y * slot.rise * dt;
      slot.z += slot.vz * dt + Math.cos(slot.phase) * slot.wobble * dt + up.z * slot.rise * dt;
      this.scratch.set(slot.x, slot.y, slot.z);
      if (slot.life <= 0 || this.scratch.length() > radius) this.placeMote(i, slot, radius * 0.92);
    }
    this.flush();
  }

  private placeMote(index: number, slot: Bubble, radius: number): void {
    const r = radius * Math.cbrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    slot.x = r * Math.sin(phi) * Math.cos(theta);
    slot.y = r * Math.cos(phi) * 0.75;
    slot.z = r * Math.sin(phi) * Math.sin(theta);
    slot.vx = (Math.random() - 0.5) * 0.35;
    slot.vy = (Math.random() - 0.5) * 0.2;
    slot.vz = (Math.random() - 0.5) * 0.35;
    slot.rise = 0.55 + Math.random() * 0.85;
    slot.wobble = 0.15 + Math.random() * 0.35;
    slot.size = 0.14 + Math.random() * 0.16;
    slot.phase = Math.random() * Math.PI * 2;
    slot.life = 10 + Math.random() * 14;
    slot.maxLife = slot.life;
    this.paintSlot(index, slot);
  }

  private paintSlot(index: number, slot: Bubble): void {
    const row = slot.size < 0.1 ? 0 : slot.size < 0.16 ? 1 : slot.size < 0.24 ? 2 : 3;
    this.rowAttr.setX(index, row);
    this.rowAttr.needsUpdate = true;
    this.phaseAttr.setX(index, Math.random() * 8);
    this.phaseAttr.needsUpdate = true;
  }

  private flush(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      const fade = Math.max(0, Math.min(1, slot.life / slot.maxLife));
      this.dummy.position.set(slot.x, slot.y, slot.z);
      this.dummy.scale.setScalar(slot.life > 0 ? slot.size * (0.55 + 0.45 * fade) : 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
