import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ARENA_RADIUS, ARENA_REFERENCE, BALL, CAMERA } from '../game/constants';
import type { PlayerState } from '../game/types';
import type { Simulation } from '../sim/Simulation';
import { authoritativeUp, rotateToward, stabilizeUp } from '../sim/math';
import { buildArenaDressing, type WaterRig } from './arenaDressing';
import { createBlitzball, fitBallModel, tuneUnderwaterBallMaterials } from './blitzball';
import { BubblePool } from './bubbles';
import { createCatchBeacon } from './catchBeacon';
import { blendLimbPose, swimLimbPose } from './limbs';
import { buildGoalFrame } from './goalFrame';
import { createSwimmer } from './swimmer';
import {
  attachSwimmerModel,
  prepareSwimmerTemplate,
  swimmerRig,
  updateSwimmerRig,
  type SwimmerTemplate,
} from './swimmerModel';

/** High-contrast team colors for greybox readability. */
const TEAM_COLORS = [0x2b9fff, 0xff6a3d];
const TRAIL_MAX = 36;
const GHOST_MAX = 36;

/** Soft disc so the landing dot stays readable without a screen-space crosshair. */
function makeLandingGlow(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255, 248, 220, 0.95)');
  glow.addColorStop(0.22, 'rgba(255, 224, 102, 0.55)');
  glow.addColorStop(0.5, 'rgba(255, 196, 70, 0.16)');
  glow.addColorStop(1, 'rgba(255, 196, 70, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

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
  private shotMarker!: THREE.Group;
  private shotMarkerMat!: THREE.MeshBasicMaterial;
  private shotMarkerRing!: THREE.Mesh;
  private shotMarkerRingMat!: THREE.MeshBasicMaterial;
  private shotMarkerGlowMat!: THREE.SpriteMaterial;
  private reachMin!: THREE.Mesh;
  private reachMax!: THREE.Mesh;
  private distanceSprite!: THREE.Sprite;
  private distanceMat!: THREE.SpriteMaterial;
  private distanceCanvas!: HTMLCanvasElement;
  private distanceCtx!: CanvasRenderingContext2D;
  private distanceTex!: THREE.CanvasTexture;
  private distanceShown = '';
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
  private splashRing!: THREE.Mesh;
  private splashMat!: THREE.MeshBasicMaterial;
  private nearBubbleAcc = 0;
  private swimmerTemplate: SwimmerTemplate | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x042433, 1);
    this.scene.fog = new THREE.FogExp2(0x0a4d66, 0.0065 * (ARENA_REFERENCE / ARENA_RADIUS));

    this.trailPositions = new Float32Array(TRAIL_MAX * 3);
    this.ghostPositions = new Float32Array(GHOST_MAX * 3);

    this.pipFree = makePipTexture('#ffe066', '#1a2030', '●');
    this.pipYou = makePipTexture('#2b9fff', '#ffffff', 'Y');
    this.pipOrange = makePipTexture('#ff6a3d', '#1a1010', 'O');
    this.pipBlue = makePipTexture('#2b9fff', '#0a2030', 'B');

    this.buildLights();
    this.water = buildArenaDressing(this.scene);
    this.buildGoals();
    this.buildSplashRing();
    this.buildBall();
    this.buildGhosts();
    this.catchBeacon = createCatchBeacon();
    this.scene.add(this.catchBeacon);
    this.trails = new BubblePool(this.scene, 420, 0xd7f6ff, 0.42);
    this.motes = new BubblePool(this.scene, 160, 0xc5f4ff, 0.28);
    this.motes.seedMotes(160, ARENA_RADIUS * 0.86);
    void this.tryLoadCustomBall();
    void this.tryLoadSwimmerModel();
  }

  /**
   * If public/models/blitzball.glb loads, it replaces the procedural ball.
   * The file is modeled sitting on Y=0, so it is recentered and scaled to the
   * gameplay radius before it is parented to the physics pivot. A failed load
   * leaves the built-in mesh in place.
   */
  private async tryLoadCustomBall(): Promise<void> {
    const url = `${import.meta.env.BASE_URL}models/blitzball.glb`;
    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
      const model = gltf.scene;
      if (!fitBallModel(model, BALL.radius)) return;
      tuneUnderwaterBallMaterials(model);
      for (const child of [...this.ballPivot.children]) this.ballPivot.remove(child);
      this.ballPivot.add(model);
    } catch {
      // Procedural ball stays.
    }
  }

  /**
   * If public/models/swimmer.glb loads, each swimmer swaps the wetsuit mesh for
   * a skinned clone. A failed load leaves the procedural body in place.
   */
  private async tryLoadSwimmerModel(): Promise<void> {
    const url = `${import.meta.env.BASE_URL}models/swimmer.glb`;
    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
      const template = prepareSwimmerTemplate(gltf.scene, gltf.animations);
      if (!template) return;
      this.swimmerTemplate = template;
      for (const group of this.playerMeshes.values()) {
        const team = group.userData.team === 1 ? 1 : 0;
        const playerId = typeof group.userData.playerId === 'number' ? group.userData.playerId : 0;
        attachSwimmerModel(group, template, team, playerId);
      }
    } catch {
      // Procedural swimmers stay.
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

  /** Triangular frames on the shell. Rebuilt when the arena radius changes. */
  private buildGoals(): void {
    const root = new THREE.Group();
    root.name = 'goals';
    for (const team of [0, 1] as const) root.add(buildGoalFrame(team));
    this.scene.add(root);
  }

  /** Ring that sits on the glass where the ball meets it. */
  private buildSplashRing(): void {
    this.splashMat = new THREE.MeshBasicMaterial({
      color: 0xdff8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.splashRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.09, 8, 32), this.splashMat);
    this.splashRing.visible = false;
    this.scene.add(this.splashRing);
  }

  /** Drop the shell, bowl, sunbeams, and goals, then build them at the current radius. */
  rebuildArena(): void {
    this.disposeNamed('arena-dressing');
    this.disposeNamed('goals');
    this.water = buildArenaDressing(this.scene);
    this.buildGoals();
    this.camera.far = ARENA_RADIUS * 8;
    this.camera.updateProjectionMatrix();
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = 0.0065 * (ARENA_REFERENCE / ARENA_RADIUS);
    }
    this.motes.seedMotes(160, ARENA_RADIUS * 0.86);
  }

  private disposeNamed(name: string): void {
    const obj = this.scene.getObjectByName(name);
    if (!obj) return;
    const materials = new Set<THREE.Material>();
    obj.traverse((child) => {
      if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line)) return;
      child.geometry?.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) materials.add(mat);
    });
    for (const mat of materials) {
      const mapped = mat as THREE.Material & { map?: THREE.Texture | null };
      mapped.map?.dispose();
      mat.dispose();
    }
    this.scene.remove(obj);
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

    const markerMat = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xfff4cc,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const glowMat = new THREE.SpriteMaterial({
      map: makeLandingGlow(),
      color: 0xffe066,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    const group = new THREE.Group();
    group.name = 'landingMarker';
    group.renderOrder = 12;
    group.visible = false;
    const glow = new THREE.Sprite(glowMat);
    glow.name = 'landingGlow';
    glow.scale.set(3.1, 3.1, 1);
    glow.renderOrder = 12;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.14, 10, 40), ringMat);
    ring.name = 'landingRing';
    ring.renderOrder = 13;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), markerMat);
    core.renderOrder = 14;
    group.add(glow, ring, core);
    this.shotMarker = group;
    this.shotMarkerMat = markerMat;
    this.shotMarkerRing = ring;
    this.shotMarkerRingMat = ringMat;
    this.shotMarkerGlowMat = glowMat;
    this.scene.add(group);

    const reachGeo = new THREE.TorusGeometry(1.55, 0.045, 8, 48);
    const reachMat = (color: number) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.38,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      });
    this.reachMin = new THREE.Mesh(reachGeo, reachMat(0x9ad7ff));
    this.reachMax = new THREE.Mesh(reachGeo.clone(), reachMat(0xffc27a));
    this.reachMin.name = 'reachMin';
    this.reachMax.name = 'reachMax';
    this.reachMin.renderOrder = 11;
    this.reachMax.renderOrder = 11;
    this.reachMin.visible = false;
    this.reachMax.visible = false;
    this.scene.add(this.reachMin, this.reachMax);

    this.distanceCanvas = document.createElement('canvas');
    this.distanceCanvas.width = 256;
    this.distanceCanvas.height = 128;
    const ctx = this.distanceCanvas.getContext('2d');
    if (!ctx) throw new Error('distance label');
    this.distanceCtx = ctx;
    this.distanceTex = new THREE.CanvasTexture(this.distanceCanvas);
    this.distanceMat = new THREE.SpriteMaterial({
      map: this.distanceTex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.distanceSprite = new THREE.Sprite(this.distanceMat);
    this.distanceSprite.name = 'landingDistance';
    this.distanceSprite.renderOrder = 15;
    this.distanceSprite.visible = false;
    this.scene.add(this.distanceSprite);
  }

  private paintDistance(text: string): void {
    const ctx = this.distanceCtx;
    ctx.clearRect(0, 0, 256, 128);
    ctx.fillStyle = 'rgba(6, 16, 32, 0.62)';
    ctx.beginPath();
    ctx.roundRect(36, 28, 184, 72, 16);
    ctx.fill();
    ctx.font = '700 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe9a0';
    ctx.fillText(text, 128, 66);
    this.distanceTex.needsUpdate = true;
  }

  ensurePlayers(sim: Simulation): void {
    for (const p of sim.players) {
      if (this.playerMeshes.has(p.id)) continue;
      const marker = p.role === 'human' ? 'you' : p.team === 0 && p.role === 'ai' ? 'mate' : 'none';
      const group = createSwimmer(p.team, marker);
      group.userData.team = p.team;
      group.userData.playerId = p.id;
      if (this.swimmerTemplate) attachSwimmerModel(group, this.swimmerTemplate, p.team, p.id);
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
      middleZoomPressed: false,
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
    if (sim.cameraShake > 0) {
      const mag = sim.cameraShake * sim.cameraShake * 0.34;
      const sway = Math.sin(this.pulse * 46);
      const bob = Math.cos(this.pulse * 37);
      this.camera.position.addScaledVector(this.camera.up, sway * mag);
      this.camScratch.view.crossVectors(this.camera.up, this.camOffsetDir);
      if (this.camScratch.view.lengthSq() > 1e-6) {
        this.camScratch.view.normalize();
        this.camera.position.addScaledVector(this.camScratch.view, bob * mag * 0.65);
      }
    }

    for (const p of sim.players) {
      const mesh = this.playerMeshes.get(p.id);
      if (!mesh) continue;
      mesh.visible = p.active && p.role !== 'stub';
      mesh.position.copy(p.position);
      // Basis, not Object3D.lookAt. lookAt nudges the aim axis when up is
      // parallel to facing, and that nudge flips the roll by a half turn.
      this.faceBody(mesh, p.facing, p.up);
      if (p.actionPose === 'burst') {
        const follow = THREE.MathUtils.clamp(p.actionPoseTime / 0.14, 0, 1);
        mesh.rotateZ(-0.55 * follow);
      }
      const rig = swimmerRig(mesh);
      if (rig) updateSwimmerRig(rig, mesh, p, sim, dt);
      else this.poseLimbs(mesh, p, sim, dt);
      const flash = mesh.getObjectByName('hitFlash');
      if (flash instanceof THREE.Mesh) {
        const mat = flash.material as THREE.MeshBasicMaterial;
        mat.opacity = p.hitFlash * 0.85;
        flash.visible = p.hitFlash > 0.02;
      }
      const ring = mesh.getObjectByName('carrierRing');
      const locked = sim.landingMarker.lockId === p.id || sim.shotAim.lockId === p.id;
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
    this.syncLandingMarker(sim);
    this.syncCatchBeacon(sim);
    this.syncBubbles(sim, dt);
    this.syncGoalFlash(sim);
    this.syncSplash(sim);
    this.water.update(
      this.pulse,
      this.camera.position,
      sim.tunables.showSunbeams,
      sim.tunables.sunbeamIntensity,
      sim.ball.position,
      sim.nearShell,
      Math.max(sim.impactPulse, sim.breachTime > 0 ? 1 : 0),
    );
  }

  private syncGoalFlash(sim: Simulation): void {
    const goals = this.scene.getObjectByName('goals');
    if (!goals) return;
    goals.traverse((child) => {
      if (child.name !== 'goalFlash' || !(child instanceof THREE.Mesh)) return;
      const team = child.parent?.name === 'goal-orange' ? 1 : 0;
      const mat = child.material as THREE.MeshBasicMaterial;
      const on = sim.goalCelebrate > 0 && sim.goalTeam === team;
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(this.pulse * 9));
      mat.opacity = on ? pulse * Math.min(1, sim.goalCelebrate) : 0;
    });
  }

  private syncSplash(sim: Simulation): void {
    const show = sim.nearShell > 0.12 || sim.impactPulse > 0.02 || sim.breachTime > 0;
    this.splashRing.visible = show;
    if (!show) return;
    this.splashRing.position.copy(sim.shellPoint);
    if (sim.breachTime > 0) this.splashRing.position.copy(sim.breachPoint);
    this.splashRing.lookAt(0, 0, 0);
    const scale = 0.9 + sim.nearShell * 1.6 + sim.impactPulse * 2.4 + (sim.breachTime > 0 ? 1.8 : 0);
    this.splashRing.scale.setScalar(scale);
    this.splashMat.opacity = Math.min(0.95, 0.12 + sim.nearShell * 0.4 + sim.impactPulse * 0.55);
    this.splashMat.color.setHex(sim.breachTime > 0 ? 0xfff2c4 : 0xdff8ff);
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
    // Cups and the stripe sheet need a clear roll or the ball reads as a static sphere.
    this.ballPivot.rotateOnWorldAxis(this.spinAxis, speed * dt * (held ? 0.12 : 0.9) * curved);
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
      if (p.hitBurst > 0) {
        const n = Math.min(p.hitBurst, 14);
        for (let i = 0; i < n; i++) {
          this.emitDir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
          if (this.emitDir.lengthSq() < 1e-6) this.emitDir.set(0, 1, 0);
          else this.emitDir.normalize();
          this.emitOrigin.copy(p.position);
          this.trails.emit({
            origin: this.emitOrigin,
            direction: this.emitDir,
            kick: 3.4,
            life: 0.65,
            size: 0.24,
            rise: 0.45,
            spread: 0.62,
          });
        }
        p.hitBurst = 0;
      }
    }

    if (sim.nearShell > 0.5) {
      this.nearBubbleAcc += (8 + sim.nearShell * 18) * dt;
      const contact = sim.breachTime > 0 ? sim.breachPoint : sim.shellPoint;
      while (this.nearBubbleAcc >= 1) {
        this.emitOrigin.copy(contact);
        this.emitDir.copy(contact).multiplyScalar(-1);
        if (this.emitDir.lengthSq() > 1e-6) this.emitDir.normalize();
        else this.emitDir.set(0, 1, 0);
        this.trails.emit({
          origin: this.emitOrigin,
          direction: this.emitDir,
          kick: 0.8 + sim.impactPulse * 1.4,
          life: 0.8,
          size: 0.12 + sim.nearShell * 0.08,
          rise: 0.7,
          spread: 0.45,
        });
        this.nearBubbleAcc -= 1;
      }
    }
    if (sim.splashBurst > 0) {
      const n = Math.min(sim.splashBurst, 20);
      const celebrating = sim.goalCelebrate > 1.4;
      const origin = celebrating ? sim.ball.position : sim.breachTime > 0 ? sim.breachPoint : sim.shellPoint;
      for (let i = 0; i < n; i++) {
        this.emitDir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        if (this.emitDir.lengthSq() < 1e-6) this.emitDir.set(0, 1, 0);
        else this.emitDir.normalize();
        if (sim.breachTime > 0) this.emitDir.addScaledVector(sim.breachNormal, 0.8).normalize();
        this.emitOrigin.copy(origin);
        this.trails.emit({
          origin: this.emitOrigin,
          direction: this.emitDir,
          kick: celebrating ? 2.2 : 3.6,
          life: 0.85,
          size: celebrating ? 0.22 : 0.26,
          rise: 0.9,
          spread: 0.7,
        });
      }
      sim.splashBurst = 0;
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

  /**
   * Landing dot for a straight aim or a curved hold. Scale tracks distance so
   * the ring stays a similar size on screen, and depth is off so a swimmer
   * between the camera and the point cannot cover it.
   */
  private syncLandingMarker(sim: Simulation): void {
    const mark = sim.landingMarker;
    this.shotMarker.visible = mark.visible;
    this.distanceSprite.visible = mark.visible;
    const showReach = mark.visible && mark.showReach;
    this.placeReach(this.reachMin, mark.minPosition, showReach);
    this.placeReach(this.reachMax, mark.maxPosition, showReach);
    if (!mark.visible) return;

    this.shotMarker.position.copy(mark.position);
    const toCam = this.camScratch.view.copy(this.camera.position).sub(mark.position);
    if (toCam.lengthSq() > 1e-4) {
      this.shotMarker.position.addScaledVector(toCam.normalize(), 0.85);
    }
    const dist = Math.max(0.5, this.camera.position.distanceTo(this.shotMarker.position));
    const locked = mark.lockId !== null;
    const pulse = (locked ? 1 + Math.sin(this.pulse * 9) * 0.08 : 1) * (1 + mark.pulse * 0.72);
    this.shotMarker.scale.setScalar(THREE.MathUtils.clamp(dist * 0.034, 0.45, 3.4) * pulse);
    this.shotMarkerRing.lookAt(this.camera.position);

    const markerHex = mark.pulse > 0.35 ? 0xffffff : locked ? 0xc6ff6a : 0xffe066;
    const ringHex = mark.pulse > 0.35 ? 0xfff6d0 : locked ? 0xf4ffe4 : 0xfff4cc;
    this.shotMarkerMat.color.setHex(markerHex);
    this.shotMarkerRingMat.color.setHex(ringHex);
    this.shotMarkerGlowMat.color.setHex(markerHex);

    const label = `${Math.max(0, Math.round(mark.distance))}u`;
    if (label !== this.distanceShown) {
      this.paintDistance(label);
      this.distanceShown = label;
    }
    const up = this.camScratch.offset.copy(this.camera.up);
    if (up.lengthSq() < 1e-6) up.set(0, 1, 0);
    else up.normalize();
    const lift = THREE.MathUtils.clamp(dist * 0.05, 0.55, 2.6);
    this.distanceSprite.position.copy(this.shotMarker.position).addScaledVector(up, lift);
    const labelScale = THREE.MathUtils.clamp(dist * 0.02, 0.4, 2.4);
    this.distanceSprite.scale.set(labelScale * 2, labelScale, 1);
  }

  /** Billboard a faint reach ring. Min and max sit on the current aim. */
  private placeReach(mesh: THREE.Mesh, point: THREE.Vector3, visible: boolean): void {
    mesh.visible = visible;
    if (!visible) return;
    mesh.position.copy(point);
    const toCam = this.camScratch.view.copy(this.camera.position).sub(point);
    if (toCam.lengthSq() > 1e-4) mesh.position.addScaledVector(toCam.normalize(), 0.55);
    const dist = Math.max(0.5, this.camera.position.distanceTo(mesh.position));
    mesh.scale.setScalar(THREE.MathUtils.clamp(dist * 0.046, 0.65, 4.8));
    mesh.lookAt(this.camera.position);
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
    const ud = mesh.userData as { swimPhase?: number; catchBlend?: number; holdBlend?: number };
    if (ud.swimPhase === undefined) ud.swimPhase = player.id * 0.37;
    const hz = tun.swimAnimRate * (0.3 + 0.7 * speed01);
    ud.swimPhase += dt * hz;
    const wave = Math.sin(ud.swimPhase * Math.PI * 2);

    const humanCharge =
      player.role === 'human' && player.id === sim.humanId && sim.charge.active ? sim.charge : null;
    const pose = player.actionPose;
    // Aiming keeps the carry pose. The shoot charge would pull both arms back
    // and leave the ball floating in front of an empty chest.
    const aimingShot = sim.shotAim.active && player.id === sim.humanId;
    const ready =
      pose === 'claim' ||
      (player.id === sim.humanId &&
        sim.catchStance &&
        !player.hasBall &&
        pose !== 'pass' &&
        pose !== 'shoot' &&
        pose !== 'burst');
    const catchTarget = ready ? 1 : 0;
    const holdTarget = pose === 'hold' || aimingShot ? 1 : 0;
    const ease = (current: number, target: number, rate: number) =>
      current + (target - current) * (1 - Math.exp(-rate * dt));
    ud.catchBlend = ease(ud.catchBlend ?? 0, catchTarget, 8.5);
    ud.holdBlend = ease(ud.holdBlend ?? 0, holdTarget, 11);

    const poseWeight = Math.max(ud.catchBlend, ud.holdBlend);
    const amp = (tun.swimAnim ? tun.swimAnimAmount * speed01 : 0) * (1 - 0.82 * poseWeight);
    const swim = swimLimbPose(wave, amp);
    // A little extra forward paddle so a slow swim is not a T-pose. Catch and hold still ease over it.
    swim.yL += 0.35;
    swim.yR -= 0.35;
    const blended = blendLimbPose(swim, ud.catchBlend, ud.holdBlend);
    let yL = blended.yL;
    let yR = blended.yR;
    let zL = blended.zL;
    let zR = blended.zR;
    let xLegL = blended.xLegL;
    let xLegR = blended.xLegR;

    if (pose === 'burst') {
      const follow = THREE.MathUtils.clamp(player.actionPoseTime / 0.12, 0, 1);
      // Lead with one shoulder. The other arm trails, instead of a both-arms dive.
      yL = THREE.MathUtils.lerp(yL, -0.35, follow);
      yR = THREE.MathUtils.lerp(yR, -0.75, follow);
      zL = THREE.MathUtils.lerp(zL, 0.2, follow);
      zR = THREE.MathUtils.lerp(zR, -0.95, follow);
      xLegL = THREE.MathUtils.lerp(xLegL, 0.95, follow);
      xLegR = THREE.MathUtils.lerp(xLegR, -0.2, follow);
    } else if (!aimingShot && (pose === 'pass' || humanCharge?.kind === 'pass')) {
      const ext = humanCharge?.kind === 'pass' ? 0.3 + 0.7 * humanCharge.amount : Math.min(1, player.actionPoseTime / 0.22);
      yR = THREE.MathUtils.lerp(yR, -1.5, ext);
      zR = THREE.MathUtils.lerp(zR, -0.05, ext);
      yL = THREE.MathUtils.lerp(yL, 0.15, ext);
    } else if (!aimingShot && (pose === 'shoot' || humanCharge?.kind === 'shoot')) {
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
