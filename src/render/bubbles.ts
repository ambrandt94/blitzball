import * as THREE from 'three';

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
export class BubblePool {
  readonly mesh: THREE.InstancedMesh;
  private slots: Bubble[];
  private dummy = new THREE.Object3D();
  private cursor = 0;
  private scratch = new THREE.Vector3();

  constructor(parent: THREE.Object3D, count: number, color: number, opacity: number) {
    const geo = new THREE.SphereGeometry(1, 12, 10);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
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
  }

  update(dt: number, up: THREE.Vector3): void {
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
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Ambient specks that drift inside the sphere and respawn when they leave. */
  seedMotes(count: number, radius: number): void {
    const n = Math.min(count, this.slots.length);
    for (let i = 0; i < n; i++) {
      const slot = this.slots[i]!;
      this.placeMote(slot, radius);
      slot.life = 8 + Math.random() * 10;
      slot.maxLife = slot.life;
    }
    this.cursor = n % this.slots.length;
  }

  driftMotes(dt: number, up: THREE.Vector3, radius: number): void {
    for (const slot of this.slots) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.phase += dt * 0.8;
      const wob = Math.sin(slot.phase) * slot.wobble * dt;
      slot.x += slot.vx * dt + wob + up.x * slot.rise * dt;
      slot.y += slot.vy * dt + up.y * slot.rise * dt;
      slot.z += slot.vz * dt + Math.cos(slot.phase) * slot.wobble * dt + up.z * slot.rise * dt;
      this.scratch.set(slot.x, slot.y, slot.z);
      if (slot.life <= 0 || this.scratch.length() > radius) this.placeMote(slot, radius * 0.92);
    }
    this.flush();
  }

  private placeMote(slot: Bubble, radius: number): void {
    const r = radius * Math.cbrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    slot.x = r * Math.sin(phi) * Math.cos(theta);
    slot.y = r * Math.cos(phi) * 0.75;
    slot.z = r * Math.sin(phi) * Math.sin(theta);
    slot.vx = (Math.random() - 0.5) * 0.35;
    slot.vy = (Math.random() - 0.5) * 0.2;
    slot.vz = (Math.random() - 0.5) * 0.35;
    slot.rise = 0.15 + Math.random() * 0.35;
    slot.wobble = 0.15 + Math.random() * 0.35;
    slot.size = 0.07 + Math.random() * 0.11;
    slot.phase = Math.random() * Math.PI * 2;
    slot.life = 10 + Math.random() * 14;
    slot.maxLife = slot.life;
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
