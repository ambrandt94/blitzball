import * as THREE from 'three';
import { ARENA_RADIUS, BALL, GOAL } from '../game/constants';
import type { Simulation } from '../sim/Simulation';

/** High-contrast team colors for greybox readability. */
const TEAM_COLORS = [0x2b9fff, 0xff6a3d];
const TEAM_ACCENT = [0xd0ecff, 0xffd0c0];
const TRAIL_MAX = 36;
const GHOST_MAX = 24;

function makePipTexture(fill: string, stroke: string, mark?: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 42, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  if (mark) {
    ctx.fillStyle = stroke;
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mark, 64, 66);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Low-poly swim humanoid: head + torso + limbs, facing +Z local. */
function buildHumanoid(team: 0 | 1, isHuman: boolean): THREE.Group {
  const group = new THREE.Group();
  const color = TEAM_COLORS[team]!;
  const accent = TEAM_ACCENT[team]!;
  const mat = new THREE.MeshBasicMaterial({ color });
  const accentMat = new THREE.MeshBasicMaterial({ color: accent });
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x101820 });

  // Torso (swim-prone: long along Z)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.48, 1.05), mat);
  torso.position.z = 0.05;
  group.add(torso);

  // Head at front — oversized for silhouette readability
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), accentMat);
  head.position.set(0, 0.12, 0.82);
  group.add(head);

  // Visor / face cue so facing reads at a glance
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.1), darkMat);
  visor.position.set(0, 0.14, 1.05);
  group.add(visor);

  // Arms out to sides, slightly forward
  for (const side of [-1, 1] as const) {
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.2), mat);
    upper.position.set(side * 0.58, 0.04, 0.2);
    upper.rotation.z = side * 0.2;
    group.add(upper);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 6), accentMat);
    hand.position.set(side * 0.95, 0.04, 0.28);
    group.add(hand);
  }

  // Legs trailing back
  for (const side of [-1, 1] as const) {
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.7), mat);
    thigh.position.set(side * 0.2, -0.04, -0.65);
    group.add(thigh);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.28), darkMat);
    foot.position.set(side * 0.2, -0.06, -1.05);
    group.add(foot);
  }

  // Explicit facing chevron (white) ahead of head
  const chevron = new THREE.Mesh(
    new THREE.ConeGeometry(0.26, 0.55, 4),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  chevron.rotation.x = Math.PI / 2;
  chevron.position.set(0, 0.08, 1.35);
  chevron.name = 'facingChevron';
  group.add(chevron);

  // You = bright outline disc under body
  if (isHuman) {
    const youRing = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.9, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.75,
      }),
    );
    youRing.rotation.x = Math.PI / 2;
    youRing.position.y = -0.35;
    youRing.name = 'youRing';
    group.add(youRing);
  }

  // Carrier glow ring (shown when has ball)
  const carrier = new THREE.Mesh(
    new THREE.TorusGeometry(1.15, 0.09, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xffe066 }),
  );
  carrier.name = 'carrierRing';
  carrier.visible = false;
  carrier.rotation.x = Math.PI / 2;
  group.add(carrier);

  // Soft team badge plane behind head (reads at distance)
  const badge = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 12),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  badge.position.set(0, 0.45, 0.2);
  badge.name = 'teamBadge';
  group.add(badge);

  return group;
}

export class SceneView {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
  renderer: THREE.WebGLRenderer;

  private playerMeshes = new Map<number, THREE.Group>();
  private ballMesh!: THREE.Mesh;
  private ballHalo!: THREE.Mesh;
  private ballRing!: THREE.Mesh;
  private ballTrail!: THREE.Line;
  private trailPositions: Float32Array;
  private chargeGhost!: THREE.Line;
  private ghostPositions: Float32Array;
  private pip!: THREE.Sprite;
  private pipFree: THREE.CanvasTexture;
  private pipYou: THREE.CanvasTexture;
  private pipOrange: THREE.CanvasTexture;
  private pipBlue: THREE.CanvasTexture;
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private camUp = new THREE.Vector3(0, 1, 0);
  private camInitialized = false;
  private pulse = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x102030, 1);
    this.scene.fog = new THREE.FogExp2(0x102030, 0.007);

    this.trailPositions = new Float32Array(TRAIL_MAX * 3);
    this.ghostPositions = new Float32Array(GHOST_MAX * 3);

    this.pipFree = makePipTexture('#ffe066', '#1a2030', '●');
    this.pipYou = makePipTexture('#2b9fff', '#ffffff', 'Y');
    this.pipOrange = makePipTexture('#ff6a3d', '#1a1010', 'O');
    this.pipBlue = makePipTexture('#2b9fff', '#0a2030', 'B');

    this.buildLights();
    this.buildArena();
    this.buildGoals();
    this.buildBall();
    this.buildGhosts();
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xa8d8ff, 0x142838, 1.15);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(12, 18, 8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x66aadd, 0.5);
    fill.position.set(-10, -8, -12);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0x507090, 0.4));
  }

  private buildArena(): void {
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(ARENA_RADIUS, 3),
      new THREE.MeshStandardMaterial({
        color: 0x1a4060,
        transparent: true,
        opacity: 0.26,
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
        opacity: 0.38,
      }),
    );
    this.scene.add(wire);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA_RADIUS * 0.99, 0.08, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0x8ec8f0, transparent: true, opacity: 0.65 }),
    );
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, ARENA_RADIUS * 2, 6),
      new THREE.MeshBasicMaterial({ color: 0xb0e0ff, transparent: true, opacity: 0.55 }),
    );
    pole.rotation.x = Math.PI / 2;
    this.scene.add(pole);

    const center = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x88aacc, transparent: true, opacity: 0.45 }),
    );
    this.scene.add(center);
  }

  private buildGoals(): void {
    for (const team of [0, 1] as const) {
      const z = team === 0 ? GOAL.distance : -GOAL.distance;
      const rimColor = team === 0 ? TEAM_COLORS[1]! : TEAM_COLORS[0]!;
      const group = new THREE.Group();
      group.position.set(0, 0, z);

      group.add(
        new THREE.Mesh(
          new THREE.TorusGeometry(GOAL.rimRadius, 0.3, 12, 48),
          new THREE.MeshBasicMaterial({ color: rimColor }),
        ),
      );

      group.add(
        new THREE.Mesh(
          new THREE.CircleGeometry(GOAL.rimRadius * 0.95, 32),
          new THREE.MeshBasicMaterial({
            color: rimColor,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
          }),
        ),
      );

      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(GOAL.rimRadius * 0.92, GOAL.rimRadius * 0.7, GOAL.depth, 24, 1, true),
        new THREE.MeshBasicMaterial({
          color: rimColor,
          transparent: true,
          opacity: 0.2,
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
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.scene.add(this.ballMesh);

    this.ballHalo = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius * 2.2, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffe066,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    this.scene.add(this.ballHalo);

    this.ballRing = new THREE.Mesh(
      new THREE.TorusGeometry(BALL.radius * 1.55, 0.06, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.ballRing.rotation.x = Math.PI / 2;
    this.scene.add(this.ballRing);

    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    this.ballTrail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95 }),
    );
    this.scene.add(this.ballTrail);

    this.pip = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.pipFree,
        depthTest: false,
        transparent: true,
        opacity: 1,
      }),
    );
    this.pip.scale.set(1.4, 1.4, 1.4);
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
        opacity: 0.85,
      }),
    );
    this.scene.add(this.chargeGhost);
  }

  ensurePlayers(sim: Simulation): void {
    for (const p of sim.players) {
      if (this.playerMeshes.has(p.id)) continue;
      const group = buildHumanoid(p.team, p.role === 'human');
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

  sync(sim: Simulation, intentZoom: boolean, dt = 1 / 60): void {
    this.pulse += dt;
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
      if (ring) {
        ring.visible = p.hasBall;
        ring.rotation.z = this.pulse * 2.5;
      }
      const badge = mesh.getObjectByName('teamBadge');
      if (badge) badge.lookAt(this.camera.position);
    }

    this.ballMesh.position.copy(sim.ball.position);
    this.ballHalo.position.copy(sim.ball.position);
    this.ballRing.position.copy(sim.ball.position);
    this.ballRing.lookAt(this.camera.position);

    const ballMat = this.ballMesh.material as THREE.MeshBasicMaterial;
    const haloMat = this.ballHalo.material as THREE.MeshBasicMaterial;
    const ringMat = this.ballRing.material as THREE.MeshBasicMaterial;
    const trailMat = this.ballTrail.material as THREE.LineBasicMaterial;
    const pipMat = this.pip.material as THREE.SpriteMaterial;

    if (sim.ball.possession === 'held' && sim.ball.ownerId !== null) {
      const owner = sim.players[sim.ball.ownerId];
      const team = owner?.team ?? 0;
      const teamColor = TEAM_COLORS[team]!;
      ballMat.color.setHex(0xfff4cc);
      haloMat.color.setHex(teamColor);
      haloMat.opacity = 0.35;
      // Carrier ring on player already marks possession — hide extra ball ring
      this.ballRing.visible = false;
      trailMat.color.setHex(teamColor);
      if (sim.ball.ownerId === sim.humanId) {
        pipMat.map = this.pipYou;
      } else if (team === 1) {
        pipMat.map = this.pipOrange;
      } else {
        pipMat.map = this.pipBlue;
      }
      pipMat.needsUpdate = true;
      const pulse = 1 + Math.sin(this.pulse * 6) * 0.08;
      this.ballHalo.scale.setScalar(pulse);
    } else {
      // Free ball: bright white + pulsing gold halo
      ballMat.color.setHex(0xffffff);
      haloMat.color.setHex(0xffe066);
      const pulse = 0.38 + Math.sin(this.pulse * 5) * 0.12;
      haloMat.opacity = pulse;
      ringMat.color.setHex(0xffffff);
      this.ballRing.visible = true;
      trailMat.color.setHex(0xffe066);
      pipMat.map = this.pipFree;
      pipMat.needsUpdate = true;
      this.ballHalo.scale.setScalar(1.15 + Math.sin(this.pulse * 5) * 0.15);
    }

    this.writeLine(this.ballTrail, this.trailPositions, sim.ball.trail, TRAIL_MAX);

    const up = sim.getHuman().up;
    this.pip.position.copy(sim.ball.position).addScaledVector(up, 1.15);
    this.pip.visible = true;
    const pipPulse = 1.35 + Math.sin(this.pulse * 4) * 0.12;
    this.pip.scale.set(pipPulse, pipPulse, pipPulse);

    this.writeLine(this.chargeGhost, this.ghostPositions, sim.chargeGhost, GHOST_MAX);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
