import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ARENA_RADIUS, BALL, CAMERA, GOAL } from '../game/constants';
import type { PlayerState } from '../game/types';
import type { Simulation } from '../sim/Simulation';
import { authoritativeUp, rotateToward, stabilizeUp } from '../sim/math';
import { buildArenaDressing, type WaterRig } from './arenaDressing';
import { createBlitzball } from './blitzball';
import { BubblePool } from './bubbles';
import { createCatchBeacon } from './catchBeacon';
import { createSwimmer } from './swimmer';

/** High-contrast team colors for greybox readability. */
const TEAM_COLORS = [0x2b9fff, 0xff6a3d];
const TRAIL_MAX = 36;
const GHOST_MAX = 36;

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


export class SceneView {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.1, ARENA_RADIUS * 8);
  renderer: THREE.WebGLRenderer;

  private playerMeshes = new Map<number, THREE.Group>();
  private ballPivot!: THREE.Group;
  private ballHalo!: THREE.Mesh;
  private ballRing!: THREE.Mesh;
  private ballTrail!: THREE.Line;
  private trailPositions: Float32Array;
  private chargeGhost!: THREE.Line;
  private ghostPositions: Float32Array;
  private shotMarker!: THREE.Mesh;
  private shotMarkerRing!: THREE.Mesh;
  private aimCursor!: THREE.Group;
  private aimCursorMat!: THREE.MeshBasicMaterial;
  private aimCursorCore!: THREE.MeshBasicMaterial;
  private pip!: THREE.Sprite;
  private pipFree: THREE.CanvasTexture;
  private pipYou: THREE.CanvasTexture;
  private pipOrange: THREE.CanvasTexture;
  private pipBlue: THREE.CanvasTexture;
  private camOffsetDir = new THREE.Vector3(0, 0.15, 1);
  private camOffsetLen = CAMERA.chaseDistance;
  private camTarget = new THREE.Vector3();
  private camUp = new THREE.Vector3(0, 1, 0);
  private worldUp = new THREE.Vector3(0, 1, 0);
  private camInitialized = false;
  private camScratch = {
    offset: new THREE.Vector3(),
    pos: new THREE.Vector3(),
    view: new THREE.Vector3(),
  };
  private bodyX = new THREE.Vector3();
  private bodyY = new THREE.Vector3();
  private bodyZ = new THREE.Vector3();
  private bodyBasis = new THREE.Matrix4();
  private pulse = 0;
  private water!: WaterRig;
  private trails!: BubblePool;
  private motes!: BubblePool;
  private catchBeacon!: THREE.Group;
  private bubbleAcc = 0;
  private playerBubbleAcc: number[] = [];
  private prevBallDir = new THREE.Vector3(0, 0, 1);
  private spinAxis = new THREE.Vector3();
  private emitOrigin = new THREE.Vector3();
  private emitDir = new THREE.Vector3();
  private bubbleUp = new THREE.Vector3(0, 1, 0);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x042433, 1);
    this.scene.fog = new THREE.FogExp2(0x0a4d66, 0.0065);

    this.trailPositions = new Float32Array(TRAIL_MAX * 3);
    this.ghostPositions = new Float32Array(GHOST_MAX * 3);

    this.pipFree = makePipTexture('#ffe066', '#1a2030', '●');
    this.pipYou = makePipTexture('#2b9fff', '#ffffff', 'Y');
    this.pipOrange = makePipTexture('#ff6a3d', '#1a1010', 'O');
    this.pipBlue = makePipTexture('#2b9fff', '#0a2030', 'B');

    this.buildLights();
    this.water = buildArenaDressing(this.scene);
    this.buildGoals();
    this.buildBall();
    this.buildGhosts();
    this.buildAimCursor();
    this.catchBeacon = createCatchBeacon();
    this.scene.add(this.catchBeacon);
    this.trails = new BubblePool(this.scene, 420, 0xd7f6ff, 0.42);
    this.motes = new BubblePool(this.scene, 160, 0xc5f4ff, 0.28);
    this.motes.seedMotes(160, ARENA_RADIUS * 0.86);
    void this.tryLoadCustomBall();
  }

  /**
   * Optional swap: if public/models/blitzball.glb is present it replaces the
   * procedural ball. A missing file keeps the built-in mesh.
   */
  private async tryLoadCustomBall(): Promise<void> {
    const url = `${import.meta.env.BASE_URL}models/blitzball.glb`;
    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok) return;
      const gltf = await new GLTFLoader().loadAsync(url);
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const span = Math.max(size.x, size.y, size.z);
      if (span < 1e-4) return;
      model.position.sub(center);
      model.scale.setScalar((BALL.radius * 2) / span);
      for (const child of [...this.ballPivot.children]) this.ballPivot.remove(child);
      this.ballPivot.add(model);
    } catch {
      // Procedural ball stays. A 404 or a bad file should not break the match.
    }
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xb7e6ff, 0x0c3044, 0.95);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xe7f7ff, 1.35);
    sun.position.set(14, 42, 10);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x2f7ea4, 0.45);
    fill.position.set(-18, -8, -16);
    this.scene.add(fill);
    const warm = new THREE.DirectionalLight(0xffb15a, 0.16);
    warm.position.set(-24, 28, -12);
    this.scene.add(warm);
    this.scene.add(new THREE.AmbientLight(0x1a4e68, 0.38));
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
    this.ballPivot = createBlitzball(BALL.radius);
    this.scene.add(this.ballPivot);

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

    this.shotMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffe066 }),
    );
    this.shotMarkerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.055, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xfff4cc }),
    );
    this.shotMarker.visible = false;
    this.shotMarkerRing.visible = false;
    this.scene.add(this.shotMarker);
    this.scene.add(this.shotMarkerRing);
  }

  /** World-space reticle for the right-click look ray. Faces the camera each frame. */
  private buildAimCursor(): void {
    this.aimCursorMat = new THREE.MeshBasicMaterial({
      color: 0x9af3ff,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.aimCursorCore = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const group = new THREE.Group();
    group.renderOrder = 5;
    group.add(new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.09, 8, 32), this.aimCursorMat));
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), this.aimCursorCore);
    core.renderOrder = 6;
    group.add(core);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.1), this.aimCursorMat);
      const a = (i / 4) * Math.PI * 2;
      tick.position.set(Math.cos(a) * 1.18, Math.sin(a) * 1.18, 0);
      tick.rotation.z = a;
      group.add(tick);
    }
    group.visible = false;
    this.aimCursor = group;
    this.scene.add(group);
  }

  ensurePlayers(sim: Simulation): void {
    for (const p of sim.players) {
      if (this.playerMeshes.has(p.id)) continue;
      const marker = p.role === 'human' ? 'you' : p.team === 0 && p.role === 'ai' ? 'mate' : 'none';
      const group = createSwimmer(p.team, marker);
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
      strafe: false,
      claim: false,
      drop: false,
      pass: false,
      shoot: false,
      shootHeld: false,
      burst: false,
      passHeld: false,
      zoomOut: intentZoom,
      zoomTogglePressed: false,
      resetBall: false,
      toggleDev: false,
      aimRangeDelta: 0,
      callForPass: false,
    });

    const humanPos = sim.getHuman().position;
    const desiredOffset = this.camScratch.offset.copy(pose.position).sub(humanPos);
    if (!this.camInitialized) {
      this.camOffsetLen = Math.max(0.25, desiredOffset.length());
      if (desiredOffset.lengthSq() > 1e-8) this.camOffsetDir.copy(desiredOffset).normalize();
      this.camTarget.copy(pose.target);
      this.camUp.copy(pose.up);
      this.camInitialized = true;
    } else {
      // Orbit the offset around the swimmer. A world-position lerp cuts a
      // chord through the body on a fast turn, and lookAt then rolls.
      if (desiredOffset.lengthSq() > 1e-8) rotateToward(this.camOffsetDir, desiredOffset, CAMERA.lag, dt);
      const desiredLen = Math.max(0.25, desiredOffset.length());
      this.camOffsetLen = THREE.MathUtils.damp(this.camOffsetLen, desiredLen, CAMERA.lag, dt);
      this.camTarget.lerp(pose.target, 1 - Math.exp(-CAMERA.lag * dt));
    }
    const camPos = this.camScratch.pos.copy(humanPos).addScaledVector(this.camOffsetDir, this.camOffsetLen);
    this.camera.position.copy(camPos);
    const view = this.camScratch.view.copy(this.camTarget).sub(camPos);
    if (view.lengthSq() < 1e-8) view.copy(this.camOffsetDir).negate();
    else view.normalize();
    stabilizeUp(this.camUp, view, pose.up, CAMERA.lag, dt);
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(this.camTarget);
    if (Math.abs(this.camera.fov - pose.fov) > 0.01) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, pose.fov, 0.2);
      this.camera.updateProjectionMatrix();
    }
    const human = sim.getHuman();
    const burstWindow = Math.max(0.05, sim.tunables.burstDuration);
    const burstK = human.burstTime > 0 ? human.burstTime / burstWindow : 0;
    if (burstK > 0) {
      this.camera.fov += 3.4 * burstK;
      this.camera.updateProjectionMatrix();
      this.camera.position.addScaledVector(this.camOffsetDir, 0.32 * burstK);
    }

    for (const p of sim.players) {
      const mesh = this.playerMeshes.get(p.id);
      if (!mesh) continue;
      mesh.visible = p.active && p.role !== 'stub';
      mesh.position.copy(p.position);
      // Basis, not Object3D.lookAt. lookAt nudges the aim axis when up is
      // parallel to facing, and that nudge flips the roll by a half turn.
      this.faceBody(mesh, p.facing, p.up);
      this.poseLimbs(mesh, p, sim, dt);
      const ring = mesh.getObjectByName('carrierRing');
      const locked = sim.shotAim.lockId === p.id;
      if (ring) {
        ring.visible = p.hasBall || locked;
        ring.rotation.z = this.pulse * 2.5;
        const ringMat = ring instanceof THREE.Mesh ? (ring.material as THREE.MeshBasicMaterial) : null;
        if (ringMat) {
          ringMat.color.setHex(locked ? 0xc6ff6a : 0xffe066);
          const pulse = locked ? 1.35 + Math.sin(this.pulse * 9) * 0.12 : 1;
          ring.scale.setScalar(pulse);
        }
      }
      const badge = mesh.getObjectByName('teamBadge');
      if (badge) badge.lookAt(this.camera.position);
    }

    this.ballPivot.position.copy(sim.ball.position);
    this.bubbleUp.copy(authoritativeUp(sim.tunables.goalAxisUp));
    this.spinBall(sim, dt);
    this.ballHalo.position.copy(sim.ball.position);
    this.ballRing.position.copy(sim.ball.position);
    this.ballRing.lookAt(this.camera.position);

    const haloMat = this.ballHalo.material as THREE.MeshBasicMaterial;
    const ringMat = this.ballRing.material as THREE.MeshBasicMaterial;
    const trailMat = this.ballTrail.material as THREE.LineBasicMaterial;
    const pipMat = this.pip.material as THREE.SpriteMaterial;

    if (sim.ball.possession === 'held' && sim.ball.ownerId !== null) {
      const owner = sim.players[sim.ball.ownerId];
      const team = owner?.team ?? 0;
      const teamColor = TEAM_COLORS[team]!;
      haloMat.color.setHex(teamColor);
      haloMat.opacity = 0.28;
      // Carrier ring on the swimmer already marks possession.
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
      haloMat.color.setHex(0xffe066);
      const pulse = 0.1 + Math.sin(this.pulse * 5) * 0.04;
      haloMat.opacity = pulse;
      ringMat.color.setHex(0xfff3b0);
      ringMat.transparent = true;
      ringMat.opacity = 0.45;
      this.ballRing.visible = true;
      trailMat.color.setHex(0xffe066);
      trailMat.opacity = 0.55;
      pipMat.map = this.pipFree;
      pipMat.needsUpdate = true;
      this.ballHalo.scale.setScalar(1.1 + Math.sin(this.pulse * 5) * 0.12);
    }

    this.writeLine(this.ballTrail, this.trailPositions, sim.ball.trail, TRAIL_MAX);

    this.worldUp.set(0, sim.tunables.goalAxisUp ? 0 : 1, sim.tunables.goalAxisUp ? 1 : 0);
    this.pip.position.copy(sim.ball.position).addScaledVector(this.worldUp, 1.15);
    this.pip.visible = true;
    const pipPulse = 1.35 + Math.sin(this.pulse * 4) * 0.12;
    this.pip.scale.set(pipPulse, pipPulse, pipPulse);

    this.writeLine(this.chargeGhost, this.ghostPositions, sim.chargeGhost, GHOST_MAX);
    const aiming = sim.shotAim.active;
    this.shotMarker.visible = aiming;
    this.shotMarkerRing.visible = aiming;
    if (aiming) {
      this.shotMarker.position.copy(sim.shotAim.target);
      this.shotMarkerRing.position.copy(sim.shotAim.target);
      this.shotMarkerRing.lookAt(this.camera.position);
      const locked = sim.shotAim.lockId !== null;
      const markerHex = locked ? 0xc6ff6a : 0xffe066;
      (this.shotMarker.material as THREE.MeshBasicMaterial).color.setHex(markerHex);
      (this.shotMarkerRing.material as THREE.MeshBasicMaterial).color.setHex(locked ? 0xf4ffe4 : 0xfff4cc);
      const lockPulse = locked ? 1.2 + Math.sin(this.pulse * 9) * 0.12 : 1;
      this.shotMarker.scale.setScalar(lockPulse);
      this.shotMarkerRing.scale.setScalar(lockPulse);
    }

    this.syncAimCursor(sim);
    this.syncCatchBeacon(sim);
    this.syncBubbles(sim, dt);
    this.water.update(this.pulse, this.camera.position);
  }

  private spinBall(sim: Simulation, dt: number): void {
    const vel = sim.ball.velocity;
    const speed = vel.length();
    if (speed < 0.2) return;
    this.spinAxis.crossVectors(this.bubbleUp, vel);
    if (this.spinAxis.lengthSq() < 1e-6) this.spinAxis.set(1, 0, 0);
    this.spinAxis.normalize();
    const held = sim.ball.possession === 'held';
    const curved = sim.ball.arc ? 1.45 : 1;
    this.ballPivot.rotateOnWorldAxis(this.spinAxis, speed * dt * (held ? 0.12 : 0.55) * curved);
  }

  private syncCatchBeacon(sim: Simulation): void {
    const beacon = sim.catchBeacon;
    this.catchBeacon.visible = beacon.visible;
    if (!beacon.visible) return;
    this.catchBeacon.position.copy(beacon.position);
    const pulse = 1 + Math.sin(this.pulse * 5) * 0.08;
    this.catchBeacon.scale.setScalar(pulse);
    const ring = this.catchBeacon.getObjectByName('catchRing');
    const inner = this.catchBeacon.getObjectByName('catchRingInner');
    if (ring) ring.rotation.z = this.pulse * 1.4;
    if (inner) inner.rotation.z = -this.pulse * 2.1;
    const core = this.catchBeacon.getObjectByName('catchCore');
    if (core) {
      core.rotation.y = this.pulse * 2.4;
      core.position.y = 0.15 + Math.sin(this.pulse * 3) * 0.12;
    }
  }

  private syncBubbles(sim: Simulation, dt: number): void {
    const cruise = Math.max(4, sim.tunables.playerMaxSpeed);
    for (const p of sim.players) {
      if (!p.active || p.role === 'stub') continue;
      const speed = p.velocity.length();
      const sprint = p.sprinting ? 1.7 : 1;
      const rate =
        (speed > 0.8 ? (speed / cruise) * 28 * sprint : 0) + (p.burstPuff > 0 ? 40 + p.burstPuff * 30 : 0);
      let acc = this.playerBubbleAcc[p.id] ?? 0;
      acc += rate * dt;
      const back = this.emitDir;
      if (speed > 0.6) back.copy(p.velocity).multiplyScalar(-1 / speed);
      else back.copy(p.facing).multiplyScalar(-1);
      while (acc >= 1) {
        this.emitOrigin.copy(p.position).addScaledVector(back, 0.7 + Math.random() * 1.6).addScaledVector(p.up, -0.05);
        this.trails.emit({
          origin: this.emitOrigin,
          direction: back,
          kick: p.burstPuff > 0 ? 1.8 : 0.45,
          life: p.burstPuff > 0 ? 1.1 : 1.25,
          size: p.burstPuff > 0 ? 0.18 : 0.1 + Math.min(0.04, speed * 0.0015),
          rise: 0.65 + (p.sprinting ? 0.25 : 0),
          spread: p.burstPuff > 0 ? 0.36 : 0.2,
        });
        acc -= 1;
      }
      this.playerBubbleAcc[p.id] = acc;
    }

    const ballSpeed = sim.ball.velocity.length();
    const dir = this.emitDir;
    if (ballSpeed > 0.4) dir.copy(sim.ball.velocity).multiplyScalar(1 / ballSpeed);
    else dir.set(0, 0, 1);
    const turning = 1 - THREE.MathUtils.clamp(this.prevBallDir.dot(dir), -1, 1);
    this.prevBallDir.copy(dir);
    const shot = Math.max(8, sim.tunables.shootSpeedMax);
    const intensity = Math.min(1.4, ballSpeed / shot);
    const heldBall = sim.ball.possession === 'held';
    const ballRate = ballSpeed > 1.2 ? (heldBall ? 8 : 14 + intensity * 28 + turning * 36) : 0;
    this.bubbleAcc += ballRate * dt;
    this.emitOrigin.copy(sim.ball.position).addScaledVector(dir, -BALL.radius * 1.4);
    const behind = this.spinAxis.copy(dir).multiplyScalar(-1);
    while (this.bubbleAcc >= 1) {
      this.trails.emit({
        origin: this.emitOrigin,
        direction: behind,
        kick: 0.8 + intensity * 1.6,
        life: 1.05 + intensity * 0.4,
        size: 0.1 + intensity * 0.1 + turning * 0.06,
        rise: 0.85,
        spread: 0.12 + turning * 0.2,
      });
      this.bubbleAcc -= 1;
    }

    this.trails.update(dt, this.bubbleUp);
    this.motes.driftMotes(dt, this.bubbleUp, ARENA_RADIUS * 0.9);
  }

  private syncAimCursor(sim: Simulation): void {
    const cursor = sim.aimCursor;
    this.aimCursor.visible = cursor.visible;
    if (!cursor.visible) return;

    this.aimCursor.position.copy(cursor.position);
    const toCam = this.camScratch.view.copy(this.camera.position).sub(cursor.position);
    if (toCam.lengthSq() > 1e-4) {
      this.aimCursor.position.addScaledVector(toCam.normalize(), 0.28);
    }
    this.aimCursor.quaternion.copy(this.camera.quaternion);

    const dist = Math.max(1, this.camera.position.distanceTo(this.aimCursor.position));
    const acquired = cursor.kind === 'player' || cursor.kind === 'ball' || cursor.kind === 'goal';
    const pulse = acquired ? 1 + Math.sin(this.pulse * 7) * 0.07 : 1;
    const scale = THREE.MathUtils.clamp(dist * 0.055, 1.05, 3.2) * pulse;
    this.aimCursor.scale.setScalar(scale);

    let color = 0x9af3ff;
    if (cursor.kind === 'wall') color = 0xd5e6f2;
    else if (cursor.kind === 'ball') color = 0xffe066;
    else if (cursor.kind === 'goal') color = 0xc8ff9a;
    else if (cursor.kind === 'player') {
      const lockedOn = sim.shotAim.lockId !== null && sim.shotAim.active;
      color = lockedOn ? 0xc6ff6a : (TEAM_COLORS[cursor.team ?? 0] ?? 0x9af3ff);
    }
    this.aimCursorMat.color.setHex(color);
    this.aimCursorMat.opacity = acquired ? 1 : 0.95;
  }

  /** Point local +Z along facing and local +Y along up, with no lookAt branch. */
  private faceBody(mesh: THREE.Object3D, facing: THREE.Vector3, up: THREE.Vector3): void {
    const z = this.bodyZ.copy(facing);
    if (z.lengthSq() < 1e-8) z.set(0, 0, 1);
    else z.normalize();
    const y = this.bodyY.copy(up).addScaledVector(z, -up.dot(z));
    if (y.lengthSq() < 1e-6) {
      y.set(0, 1, 0).addScaledVector(z, -z.y);
      if (y.lengthSq() < 1e-6) y.set(1, 0, 0);
    }
    y.normalize();
    const x = this.bodyX.crossVectors(y, z).normalize();
    y.crossVectors(z, x).normalize();
    this.bodyBasis.makeBasis(x, y, z);
    mesh.quaternion.setFromRotationMatrix(this.bodyBasis);
  }

  /** Paddle/kick plus a few stiff poses. Rotations are set absolutely each frame. */
  private poseLimbs(mesh: THREE.Group, player: PlayerState, sim: Simulation, dt: number): void {
    const armL = mesh.getObjectByName('armL');
    const armR = mesh.getObjectByName('armR');
    const legL = mesh.getObjectByName('legL');
    const legR = mesh.getObjectByName('legR');
    if (!armL || !armR || !legL || !legR) return;

    const tun = sim.tunables;
    const speed01 = Math.min(1, player.velocity.length() / Math.max(4, tun.playerMaxSpeed * tun.sprintMult));
    const ud = mesh.userData as { swimPhase?: number };
    if (ud.swimPhase === undefined) ud.swimPhase = player.id * 0.37;
    const hz = tun.swimAnimRate * (0.3 + 0.7 * speed01);
    ud.swimPhase += dt * hz;
    const wave = Math.sin(ud.swimPhase * Math.PI * 2);
    const amp = tun.swimAnim ? tun.swimAnimAmount * speed01 : 0;

    // Arms stick out along local X. Yaw swings them forward (+Z) and back.
    // The base angle keeps a paddle pose so a slow swim is not a T-pose.
    const stroke = 0.5 + amp * 1.1;
    let yL = 1.0 + wave * stroke;
    let yR = -1.0 - wave * stroke;
    let zL = 0.5;
    let zR = -0.5;
    let xLegL = -wave * amp * 0.9;
    let xLegR = wave * amp * 0.9;

    const humanCharge =
      player.role === 'human' && player.id === sim.humanId && sim.charge.active ? sim.charge : null;
    const pose = player.actionPose;
    // Aiming keeps the carry pose. The shoot charge would pull both arms back
    // and leave the ball floating in front of an empty chest.
    const aimingShot = sim.shotAim.active && player.id === sim.humanId;

    if (pose === 'hold' || aimingShot) {
      yL = 1.05;
      yR = -1.05;
      zL = 0.55;
      zR = -0.55;
      xLegL *= 0.35;
      xLegR *= 0.35;
    } else if (pose === 'burst') {
      const follow = THREE.MathUtils.clamp(player.actionPoseTime / 0.08, 0, 1);
      yL = THREE.MathUtils.lerp(yL, -1.05, follow);
      yR = THREE.MathUtils.lerp(yR, 1.05, follow);
      zL = 0.12;
      zR = -0.12;
      xLegL = THREE.MathUtils.lerp(xLegL, 1.2, follow);
      xLegR = THREE.MathUtils.lerp(xLegR, -0.4, follow);
    } else if (player.catchStance) {
      yL = 1.35;
      yR = -1.35;
      zL = 0.08;
      zR = -0.08;
      xLegL *= 0.4;
      xLegR *= 0.4;
    } else if (pose === 'claim') {
      yL = 1.4;
      yR = -1.4;
      zL = -0.2;
      zR = 0.2;
    } else if (pose === 'pass' || humanCharge?.kind === 'pass') {
      const ext = humanCharge?.kind === 'pass' ? 0.3 + 0.7 * humanCharge.amount : Math.min(1, player.actionPoseTime / 0.22);
      yR = THREE.MathUtils.lerp(yR, -1.5, ext);
      zR = THREE.MathUtils.lerp(zR, -0.05, ext);
      yL = THREE.MathUtils.lerp(yL, 0.15, ext);
    } else if (pose === 'shoot' || humanCharge?.kind === 'shoot') {
      if (humanCharge?.kind === 'shoot') {
        const c = humanCharge.amount;
        yL = THREE.MathUtils.lerp(0.15, -0.9, c);
        yR = THREE.MathUtils.lerp(-0.15, 0.9, c);
        zL = 0.25;
        zR = -0.25;
      } else {
        const follow = Math.min(1, player.actionPoseTime / 0.26);
        yL = THREE.MathUtils.lerp(yL, 1.3, follow);
        yR = THREE.MathUtils.lerp(yR, -1.3, follow);
        zL = THREE.MathUtils.lerp(zL, -0.25, follow);
        zR = THREE.MathUtils.lerp(zR, 0.25, follow);
      }
    }

    armL.rotation.set(0, yL, zL);
    armR.rotation.set(0, yR, zR);
    legL.rotation.set(xLegL, 0, 0);
    legR.rotation.set(xLegR, 0, 0);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
