import * as THREE from 'three';
import { ARENA_RADIUS, BALL, GOAL, PLAYER } from '../game/constants';
import type { Simulation } from '../sim/Simulation';

const TEAM_COLORS = [0x3aa0e8, 0xe87848];
const TRAIL_MAX = 32;
const GHOST_MAX = 24;

export class SceneView {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
  renderer: THREE.WebGLRenderer;

  private playerMeshes = new Map<number, THREE.Group>();
  private ballMesh!: THREE.Mesh;
  private ballHalo!: THREE.Mesh;
  private ballTrail!: THREE.Line;
  private trailPositions: Float32Array;
  private chargeGhost!: THREE.Line;
  private ghostPositions: Float32Array;
  private pip!: THREE.Sprite;
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private camUp = new THREE.Vector3(0, 1, 0);
  private camInitialized = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x102030, 1);
    this.scene.fog = new THREE.FogExp2(0x102030, 0.008);

    this.trailPositions = new Float32Array(TRAIL_MAX * 3);
    this.ghostPositions = new Float32Array(GHOST_MAX * 3);

    this.buildLights();
    this.buildArena();
    this.buildGoals();
    this.buildBall();
    this.buildGhosts();
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xa8d8ff, 0x142838, 1.1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(12, 18, 8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x66aadd, 0.45);
    fill.position.set(-10, -8, -12);
    this.scene.add(fill);
    const ambient = new THREE.AmbientLight(0x406080, 0.35);
    this.scene.add(ambient);
  }

  private buildArena(): void {
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(ARENA_RADIUS, 3),
      new THREE.MeshStandardMaterial({
        color: 0x1a4060,
        transparent: true,
        opacity: 0.28,
        side: THREE.BackSide,
        roughness: 0.9,
        metalness: 0.05,
      }),
    );
    this.scene.add(shell);

    const wire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(ARENA_RADIUS * 0.997, 2),
      new THREE.MeshBasicMaterial({
        color: 0x6ab0e0,
        wireframe: true,
        transparent: true,
        opacity: 0.4,
      }),
    );
    this.scene.add(wire);

    // Equator ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA_RADIUS * 0.99, 0.08, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0x8ec8f0, transparent: true, opacity: 0.65 }),
    );
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);

    // Goal-axis pole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, ARENA_RADIUS * 2, 6),
      new THREE.MeshBasicMaterial({ color: 0xb0e0ff, transparent: true, opacity: 0.55 }),
    );
    pole.rotation.x = Math.PI / 2;
    this.scene.add(pole);

    // Soft center marker
    const center = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x88aacc, transparent: true, opacity: 0.5 }),
    );
    this.scene.add(center);
  }

  private buildGoals(): void {
    for (const team of [0, 1] as const) {
      const z = team === 0 ? GOAL.distance : -GOAL.distance;
      // team 0 attacks +Z → orange rim; team 1 attacks -Z → blue rim
      const rimColor = team === 0 ? TEAM_COLORS[1]! : TEAM_COLORS[0]!;
      const group = new THREE.Group();
      group.position.set(0, 0, z);

      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(GOAL.rimRadius, 0.28, 12, 48),
        new THREE.MeshBasicMaterial({ color: rimColor }),
      );
      group.add(torus);

      const net = new THREE.Mesh(
        new THREE.CircleGeometry(GOAL.rimRadius * 0.95, 32),
        new THREE.MeshBasicMaterial({
          color: rimColor,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
        }),
      );
      group.add(net);

      // Depth tube cue
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(GOAL.rimRadius * 0.92, GOAL.rimRadius * 0.7, GOAL.depth, 24, 1, true),
        new THREE.MeshBasicMaterial({
          color: rimColor,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
        }),
      );
      tube.rotation.x = Math.PI / 2;
      tube.position.z = team === 0 ? GOAL.depth * 0.35 : -GOAL.depth * 0.35;
      group.add(tube);

      this.scene.add(group);
    }
  }

  private buildBall(): void {
    this.ballMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(BALL.radius, 1),
      new THREE.MeshBasicMaterial({ color: 0xffe8a0 }),
    );
    this.scene.add(this.ballMesh);

    this.ballHalo = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius * 1.85, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffe08a,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    this.scene.add(this.ballHalo);

    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    this.ballTrail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0.85 }),
    );
    this.scene.add(this.ballTrail);

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 64, 64);
    ctx.beginPath();
    ctx.arc(32, 32, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe066';
    ctx.fill();
    ctx.strokeStyle = '#1a2030';
    ctx.lineWidth = 5;
    ctx.stroke();
    const tex = new THREE.CanvasTexture(canvas);
    this.pip = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    this.pip.scale.set(1.1, 1.1, 1.1);
    this.scene.add(this.pip);
  }

  private buildGhosts(): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.ghostPositions, 3));
    geo.setDrawRange(0, 0);
    this.chargeGhost = new THREE.Line(
      geo,
      new THREE.LineDashedMaterial({
        color: 0xffe066,
        dashSize: 0.45,
        gapSize: 0.28,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.scene.add(this.chargeGhost);
  }

  ensurePlayers(sim: Simulation): void {
    for (const p of sim.players) {
      if (this.playerMeshes.has(p.id)) continue;
      const group = new THREE.Group();

      const body = new THREE.Mesh(
        new THREE.SphereGeometry(PLAYER.radius * 0.9, 12, 10),
        new THREE.MeshBasicMaterial({ color: TEAM_COLORS[p.team] }),
      );
      group.add(body);

      // Dark band so orange AI ≠ yellow ball at a glance
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(PLAYER.radius * 0.92, 0.08, 6, 16),
        new THREE.MeshBasicMaterial({ color: 0x1a1010 }),
      );
      band.rotation.x = Math.PI / 2;
      group.add(band);

      const nose = new THREE.Mesh(
        new THREE.ConeGeometry(0.24, 0.6, 8),
        new THREE.MeshBasicMaterial({ color: 0xf0f4ff }),
      );
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 0.7;
      group.add(nose);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.1, 0.08, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xfff0a0 }),
      );
      ring.name = 'carrierRing';
      ring.visible = false;
      group.add(ring);

      const finMat = new THREE.MeshBasicMaterial({ color: TEAM_COLORS[p.team] });
      for (const side of [-1, 1]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.4), finMat);
        fin.position.set(side * 0.58, 0, -0.1);
        group.add(fin);
      }
      group.visible = p.active && p.role !== 'stub';
      this.scene.add(group);
      this.playerMeshes.set(p.id, group);
    }
  }

  setSize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private writeLine(
    line: THREE.Line,
    buffer: Float32Array,
    points: THREE.Vector3[],
    max: number,
  ): void {
    const n = Math.min(points.length, max);
    for (let i = 0; i < n; i++) {
      const p = points[i]!;
      buffer[i * 3] = p.x;
      buffer[i * 3 + 1] = p.y;
      buffer[i * 3 + 2] = p.z;
    }
    const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    line.geometry.setDrawRange(0, n);
    if (n >= 2 && line.material instanceof THREE.LineDashedMaterial) {
      line.computeLineDistances();
    }
    line.visible = n >= 2;
  }

  sync(sim: Simulation, intentZoom: boolean): void {
    this.ensurePlayers(sim);
    const pose = sim.getCameraPose({
      move: new THREE.Vector3(),
      lookDelta: { x: 0, y: 0 },
      up: 0,
      sprint: false,
      claim: false,
      drop: false,
      pass: false,
      shoot: false,
      shootHeld: false,
      passHeld: false,
      zoomOut: intentZoom,
      zoomTogglePressed: false,
      resetBall: false,
      toggleDev: false,
    });

    if (!this.camInitialized) {
      this.camPos.copy(pose.position);
      this.camTarget.copy(pose.target);
      this.camUp.copy(pose.up);
      this.camInitialized = true;
    } else {
      this.camPos.lerp(pose.position, 0.28);
      this.camTarget.lerp(pose.target, 0.32);
      this.camUp.lerp(pose.up, 0.15).normalize();
    }
    this.camera.position.copy(this.camPos);
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(this.camTarget);
    if (Math.abs(this.camera.fov - pose.fov) > 0.01) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, pose.fov, 0.2);
      this.camera.updateProjectionMatrix();
    }

    for (const p of sim.players) {
      const mesh = this.playerMeshes.get(p.id);
      if (!mesh) continue;
      mesh.visible = p.active && p.role !== 'stub';
      mesh.position.copy(p.position);
      const lookTarget = p.position.clone().add(p.facing);
      mesh.up.copy(p.up);
      mesh.lookAt(lookTarget);
      const ring = mesh.getObjectByName('carrierRing');
      if (ring) ring.visible = p.hasBall;
    }

    this.ballMesh.position.copy(sim.ball.position);
    this.ballHalo.position.copy(sim.ball.position);
    const ballMat = this.ballMesh.material as THREE.MeshBasicMaterial;
    if (sim.ball.possession === 'held') {
      ballMat.color.setHex(0xfff0c0);
      (this.ballHalo.material as THREE.MeshBasicMaterial).opacity = 0.5;
      (this.ballHalo.material as THREE.MeshBasicMaterial).color.setHex(0xffcc44);
    } else {
      ballMat.color.setHex(0xffe8a0);
      (this.ballHalo.material as THREE.MeshBasicMaterial).opacity = 0.32;
      (this.ballHalo.material as THREE.MeshBasicMaterial).color.setHex(0xffe08a);
    }

    this.writeLine(this.ballTrail, this.trailPositions, sim.ball.trail, TRAIL_MAX);

    this.pip.position.copy(sim.ball.position).add(sim.getHuman().up.clone().multiplyScalar(0.95));
    this.pip.visible = true;

    this.writeLine(this.chargeGhost, this.ghostPositions, sim.chargeGhost, GHOST_MAX);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
