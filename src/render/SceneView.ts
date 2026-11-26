import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { ARENA_RADIUS, ARENA_REFERENCE, BALL } from '../game/constants';
import type { PlayerState } from '../game/types';
import type { Simulation } from '../sim/Simulation';
import {
  BIG_RING_SCALE_MAX,
  BIG_RING_SCALE_MIN,
  BIG_RING_SCALE_PER_M,
  FOCUS_RING_RADIUS,
  bigFocusRadius,
} from '../sim/focusCircle';
import { authoritativeUp } from '../sim/math';
import { ChaseRig } from './chaseCamera';
import { buildArenaDressing, type ArenaVisuals, type WaterRig } from './arenaDressing';
import { createBlitzball, fitBallModel, mountStadiumBall, tuneUnderwaterBallMaterials } from './blitzball';
import { BubblePool } from './bubbles';
import { createCatchBeacon } from './catchBeacon';
import { blendLimbPose, swimLimbPose } from './limbs';
import { buildGoalFrame } from './goalFrame';
import type { Body } from '../characters/cfRuntime';
import { buildOutfit, forgeRuntime, initForge, recipeForLook, recipeForOutfit } from '../characters/forge';
import type { PlayerProfile } from '../ui/playerProfile';
import type { OutfitId } from '../characters/outfits';
import { loadCharacterSettings, type CharacterSettings } from '../ui/characterSettings';
import { defaultIndicatorSettings, type IndicatorSettings } from '../ui/indicatorSettings';
import { createSwimmer } from './swimmer';
import {
  attachForgeSwimmer,
  prepareSwimmerTemplate,
  readCarrierPalm,
  releaseSwimmerRig,
  replaceSwimmerModel,
  swimmerRig,
  updateSwimmerRig,
  type SwimmerTemplate,
} from './swimmerModel';

/** High-contrast team colors for greybox readability. */
const TEAM_COLORS = [0x2b9fff, 0xff6a3d];
const TRAIL_MAX = 36;
const GHOST_MAX = 36;
/** Screen pixels. The halo is the dark edge; the core is the gold curve. */
const ARC_HALO_PX = 5.5;
const ARC_CORE_PX = 2.25;
/** Never fade the preview below this. Water and fog were eating a 1px line. */
const ARC_HALO_OPACITY = 0.7;
const ARC_CORE_OPACITY = 0.92;

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
  camera = new THREE.PerspectiveCamera(62, 1, 0.08, 1600);
  renderer: THREE.WebGLRenderer;

  private playerMeshes = new Map<number, THREE.Group>();
  private ballPivot!: THREE.Group;
  private ballHalo!: THREE.Mesh;
  private ballRing!: THREE.Mesh;
  private ballTrail!: THREE.Line;
  private trailPositions: Float32Array;
  private chargeGhost!: THREE.Group;
  private arcHalo!: Line2;
  private arcCore!: Line2;
  private pullLine!: THREE.Line;
  private pullPositions = new Float32Array(6);
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
  private chase = new ChaseRig();
  private worldUp = new THREE.Vector3(0, 1, 0);
  private camScratch = {
    offset: new THREE.Vector3(),
    pos: new THREE.Vector3(),
    view: new THREE.Vector3(),
  };
  private bodyX = new THREE.Vector3();
  private bodyY = new THREE.Vector3();
  private bodyZ = new THREE.Vector3();
  private bodyBasis = new THREE.Matrix4();
  private palmPoint = new THREE.Vector3();
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
  private characters: CharacterSettings = loadCharacterSettings();
  private forgeReady = false;
  private pendingBuilds = 0;
  private indicators: IndicatorSettings = defaultIndicatorSettings();
  private readonly holdTint = new THREE.Color();
  private readonly holdTeam = new THREE.Color();
  private visuals: ArenaVisuals = {
    waterStyle: 'trailbound',
    waterPreset: 'Clearer',
    waterRefraction: true,
    waterQuality: 'high',
    waterPixelScale: 1,
    causticFps: 0.4,
    causticScroll: 0.04,
    showLightBands: false,
    waterTint: '#2E8A84',
    waterDeep: '#163A48',
    waterFog: '#1F6066',
    waterClarity: 0.68,
    waterFogStart: 8,
    stadiumDetail: 'high',
    crowdDensity: 'high',
  };
  private cssWidth = 1;
  private cssHeight = 1;
  private fogTick = 0;
  private shot: 'wide' | 'inside' | 'ball' | 'windup' | 'bank' | 'play' | null = null;
  private aiIntentLine!: THREE.LineSegments;
  private aiIntentPositions = new Float32Array(8 * 2 * 3);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1e68d0, 1);
    this.camera.layers.enable(1);
    this.camera.layers.enable(2);
    this.scene.fog = new THREE.FogExp2(0x0a4d66, 0.0065 * (ARENA_REFERENCE / ARENA_RADIUS));

    this.trailPositions = new Float32Array(TRAIL_MAX * 3);
    this.ghostPositions = new Float32Array(GHOST_MAX * 3);

    this.pipFree = makePipTexture('#ffe066', '#1a2030', '●');
    this.pipYou = makePipTexture('#2b9fff', '#ffffff', 'Y');
    this.pipOrange = makePipTexture('#ff6a3d', '#1a1010', 'O');
    this.pipBlue = makePipTexture('#2b9fff', '#0a2030', 'B');

    const shot = new URLSearchParams(location.search).get('shot');
    if (shot === 'wide' || shot === 'inside' || shot === 'ball' || shot === 'windup' || shot === 'bank' || shot === 'play') {
      this.shot = shot;
      const boot = document.getElementById('boot');
      if (boot) boot.hidden = true;
    }
    this.buildLights();
    this.water = buildArenaDressing(this.scene, this.visuals);
    this.buildGoals();
    this.buildSplashRing();
    this.buildBall();
    this.buildGhosts();
    this.catchBeacon = createCatchBeacon();
    this.scene.add(this.catchBeacon);
    this.trails = new BubblePool(this.scene, 420, 0xd7f6ff, 0.42);
    this.motes = new BubblePool(this.scene, 160, 0xc5f4ff, 0.28);
    this.motes.seedMotes(160, ARENA_RADIUS * 0.86);
    this.markGameplay(this.ballPivot);
    this.markGameplay(this.ballHalo);
    this.markGameplay(this.ballRing);
    this.markGameplay(this.ballTrail);
    this.markGameplay(this.pip);
    this.markGameplay(this.chargeGhost);
    this.chargeGhost.traverse((obj) => {
      obj.renderOrder = 40;
    });
    this.markGameplay(this.aiIntentLine);
    this.markGameplay(this.pullLine);
    this.markGameplay(this.shotMarker);
    this.markGameplay(this.reachMin);
    this.markGameplay(this.reachMax);
    this.markGameplay(this.distanceSprite);
    this.markGameplay(this.catchBeacon);
    this.markGameplay(this.splashRing);
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
    const hero = `${import.meta.env.BASE_URL}stadium/models/ball.glb`;
    const legacy = `${import.meta.env.BASE_URL}models/blitzball.glb`;
    if (await this.tryMountBall(hero, true)) return;
    const mounted = await this.tryMountBall(legacy, false);
    if (!mounted && typeof document !== 'undefined') document.body.dataset.ball = 'procedural';
  }

  /** Hero ball keeps its centre pivot. The older atlas ball is recentered. */
  private async tryMountBall(url: string, hero: boolean): Promise<boolean> {
    try {
      const response = await fetch(url);
      if (!response.ok) return false;
      const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
      const model = gltf.scene;
      const fitted = hero ? mountStadiumBall(model, BALL.radius) : fitBallModel(model, BALL.radius);
      if (!fitted) return false;
      if (!hero) tuneUnderwaterBallMaterials(model);
      for (const child of [...this.ballPivot.children]) this.ballPivot.remove(child);
      this.ballPivot.add(model);
      this.markGameplay(model);
      if (typeof document !== 'undefined') document.body.dataset.ball = hero ? 'hero' : 'legacy';
      return true;
    } catch {
      return false;
    }
  }

  /** Live marker picks. Clean is the default; Debug restores the full gizmos. */
  setIndicators(settings: IndicatorSettings): void {
    this.indicators = settings;
    this.applyGoalIndicators();
  }

  /** Live outfit picks. A change rebuilds that swimmer before play continues. */
  setCharacters(settings: CharacterSettings): void {
    this.characters = settings;
    for (const group of this.playerMeshes.values()) void this.dress(group);
  }

  private playerLook: PlayerProfile | null = null;

  /** The human swimmer from the splash flow. Rebuilds that one body. */
  setPlayerLook(look: PlayerProfile): void {
    this.playerLook = look;
    for (const group of this.playerMeshes.values()) {
      if (group.userData.marker !== 'you') continue;
      delete group.userData.outfit;
      void this.dress(group);
    }
  }

  private outfitFor(group: THREE.Group): OutfitId {
    const team = group.userData.team === 1 ? 1 : 0;
    if (group.userData.marker === 'you') return this.characters.human;
    return this.characters.team[team];
  }

  private showBoot(text: string): void {
    if (this.shot) return;
    const boot = document.getElementById('boot');
    if (!boot) return;
    boot.textContent = text;
    boot.hidden = false;
  }

  private hideBoot(): void {
    const boot = document.getElementById('boot');
    if (boot) boot.hidden = true;
    if (typeof document !== 'undefined') document.body.dataset.characters = 'ready';
  }

  private async dress(group: THREE.Group): Promise<void> {
    const outfit = this.outfitFor(group);
    const team = group.userData.team === 1 ? 1 : 0;
    const playerId = typeof group.userData.playerId === 'number' ? group.userData.playerId : 0;
    const yours = group.userData.marker === 'you' && this.playerLook;
    const lookKey = yours
      ? `${this.playerLook!.outfit}|${this.playerLook!.tone}|${this.playerLook!.hair}|${this.playerLook!.hairColor}|${this.playerLook!.teamColor}`
      : outfit;
    if (group.userData.outfit === lookKey && swimmerRig(group)) return;
    if (group.userData.building === lookKey) return;
    const cf = forgeRuntime();
    if (!cf) {
      if (this.swimmerTemplate && !swimmerRig(group)) {
        replaceSwimmerModel(group, this.swimmerTemplate, team, playerId);
        this.markGameplay(group);
      }
      return;
    }
    group.userData.building = lookKey;
    this.pendingBuilds += 1;
    this.showBoot('Suiting up…');
    try {
      const teamHex = yours ? this.playerLook!.teamColor : team === 1 ? '#f2642a' : '#1c6fe0';
      const built: Body = yours
        ? await cf.build(recipeForLook(cf, this.playerLook!))
        : await buildOutfit(cf, outfit, teamHex);
      if (group.userData.building !== lookKey) {
        built.dispose();
        return;
      }
      if (swimmerRig(group)) releaseSwimmerRig(group);
      const rig = attachForgeSwimmer(group, built, playerId);
      if (!rig) {
        built.dispose();
        return;
      }
      group.userData.outfit = lookKey;
      group.userData.forgeRecipe = yours
        ? recipeForLook(cf, this.playerLook!)
        : recipeForOutfit(cf, outfit, teamHex);
      this.markGameplay(group);
    } catch (err) {
      console.warn('forge build failed', err);
    } finally {
      if (group.userData.building === lookKey) delete group.userData.building;
      this.pendingBuilds = Math.max(0, this.pendingBuilds - 1);
      if (this.forgeReady && this.pendingBuilds === 0) this.hideBoot();
    }
  }

  /**
   * Character Forge runtime 2.2.0. Bodies are built at load, before play, because
   * each garment fit blocks the frame for a stretch.
   */
  private async tryLoadSwimmerModel(): Promise<void> {
    this.showBoot('Suiting up…');
    try {
      await initForge();
      this.forgeReady = true;
      const groups = [...this.playerMeshes.values()];
      for (const group of groups) await this.dress(group);
      if (this.pendingBuilds === 0) this.hideBoot();
      return;
    } catch (err) {
      console.warn('forge init failed', err);
      this.hideBoot();
    }
    await this.tryLoadLegacySwimmer();
  }

  /** Older single-file wetsuit. Used only when the wardrobe files are absent. */
  private async tryLoadLegacySwimmer(): Promise<void> {
    const url = `${import.meta.env.BASE_URL}models/swimmer.glb`;
    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
      const template = prepareSwimmerTemplate(gltf.scene, gltf.animations);
      if (!template) return;
      this.swimmerTemplate = template;
      for (const group of this.playerMeshes.values()) this.dress(group);
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
    this.scene.traverse((obj) => {
      const light = obj as THREE.Light;
      if (!light.isLight) return;
      light.layers.enable(1);
    });
  }

  /** Triangular frames on the shell. Rebuilt when the arena radius changes. */
  private buildGoals(): void {
    const root = new THREE.Group();
    root.name = 'goals';
    for (const team of [0, 1] as const) root.add(buildGoalFrame(team));
    this.scene.add(root);
    this.markGameplay(root);
    this.applyGoalIndicators();
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

  /** Rescale the shell and the stadium, and rebuild the goals, at the current radius. */
  rebuildArena(): void {
    this.disposeNamed('goals');
    this.water.resize();
    this.buildGoals();
    this.camera.far = Math.max(1600, ARENA_RADIUS * 16);
    this.camera.updateProjectionMatrix();
    this.motes.seedMotes(160, ARENA_RADIUS * 0.86);
  }

  applyVisuals(visuals: ArenaVisuals): void {
    this.visuals = visuals;
    this.water.applyVisuals(visuals);
    this.applyPixelScale();
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
    this.ballHalo.visible = false;
    this.scene.add(this.ballHalo);

    this.ballRing = new THREE.Mesh(
      new THREE.TorusGeometry(BALL.radius * 1.55, 0.06, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.ballRing.rotation.x = Math.PI / 2;
    this.ballRing.visible = false;
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
    this.pip.visible = false;
    this.scene.add(this.pip);
  }

  private buildGhosts(): void {
    // A 1px GL line vanishes into the water. Draw a screen-space stroke with a
    // dark edge, on top of the shell, and don't let fog wash the gold out.
    const arcLine = (color: number, width: number, opacity: number) => {
      const material = new LineMaterial({
        color,
        linewidth: width,
        worldUnits: false,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      });
      const line = new Line2(new LineGeometry(), material);
      line.frustumCulled = false;
      line.renderOrder = 40;
      return line;
    };
    this.arcHalo = arcLine(0x140e08, ARC_HALO_PX, ARC_HALO_OPACITY);
    this.arcCore = arcLine(0xffe066, ARC_CORE_PX, ARC_CORE_OPACITY);
    this.chargeGhost = new THREE.Group();
    this.chargeGhost.name = 'shot-arc';
    this.chargeGhost.add(this.arcHalo, this.arcCore);
    this.chargeGhost.visible = false;
    this.scene.add(this.chargeGhost);

    const aiGeo = new THREE.BufferGeometry();
    aiGeo.setAttribute('position', new THREE.BufferAttribute(this.aiIntentPositions, 3));
    aiGeo.setDrawRange(0, 0);
    this.aiIntentLine = new THREE.LineSegments(
      aiGeo,
      new THREE.LineBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.9 }),
    );
    this.aiIntentLine.frustumCulled = false;
    this.scene.add(this.aiIntentLine);

    const pullGeo = new THREE.BufferGeometry();
    pullGeo.setAttribute('position', new THREE.BufferAttribute(this.pullPositions, 3));
    this.pullLine = new THREE.Line(
      pullGeo,
      new THREE.LineBasicMaterial({
        color: 0xffd2a8,
        transparent: true,
        opacity: 0.45,
        depthTest: false,
      }),
    );
    this.pullLine.visible = false;
    this.pullLine.frustumCulled = false;
    this.scene.add(this.pullLine);

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
      opacity: 0.32,
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
    glow.scale.set(1.7, 1.7, 1);
    glow.renderOrder = 12;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(FOCUS_RING_RADIUS, 0.05, 8, 36), ringMat);
    ring.name = 'landingRing';
    ring.renderOrder = 13;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), markerMat);
    core.name = 'landingCore';
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
    const live = new Set<number>();
    for (const p of sim.players) {
      live.add(p.id);
      const marker: 'you' | 'mate' | 'none' =
        p.role === 'human' ? 'you' : p.team === 0 && p.role === 'ai' ? 'mate' : 'none';
      const existing = this.playerMeshes.get(p.id);
      if (existing?.userData.marker === marker) continue;
      if (existing) {
        this.scene.remove(existing);
        this.playerMeshes.delete(p.id);
      }
      const group = createSwimmer(p.team, marker);
      group.userData.team = p.team;
      group.userData.playerId = p.id;
      group.userData.marker = marker;
      this.dress(group);
      group.visible = p.active && p.role !== 'stub';
      this.markGameplay(group);
      this.scene.add(group);
      this.playerMeshes.set(p.id, group);
    }
    for (const id of [...this.playerMeshes.keys()]) {
      if (live.has(id)) continue;
      const group = this.playerMeshes.get(id);
      if (group) this.scene.remove(group);
      this.playerMeshes.delete(id);
    }
  }

  setSize(w: number, h: number): void {
    this.cssWidth = Math.max(1, w);
    this.cssHeight = Math.max(1, h);
    this.camera.aspect = this.cssWidth / this.cssHeight;
    this.camera.updateProjectionMatrix();
    this.applyPixelScale();
  }

  /** Swimmers, the ball, and bubbles draw after the water shell so they stay crisp. */
  private markGameplay(root: THREE.Object3D): void {
    root.traverse((obj) => {
      obj.layers.set(1);
      if (obj.renderOrder < 12) obj.renderOrder = 12;
    });
  }

  private applyPixelScale(): void {
    const scale = Math.max(1, Math.round(this.visuals.waterPixelScale));
    const canvas = this.renderer.domElement;
    if (scale <= 1) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(this.cssWidth, this.cssHeight, false);
      canvas.style.imageRendering = 'auto';
    } else {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(
        Math.max(1, Math.floor(this.cssWidth / scale)),
        Math.max(1, Math.floor(this.cssHeight / scale)),
        false,
      );
      canvas.style.imageRendering = 'pixelated';
    }
    canvas.style.width = `${this.cssWidth}px`;
    canvas.style.height = `${this.cssHeight}px`;
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

  /** Shot curve. Screen-space width, dark halo, drawn over the water. */
  private writeArc(points: THREE.Vector3[]): void {
    const n = Math.min(points.length, GHOST_MAX);
    const show = n >= 2;
    this.chargeGhost.visible = show;
    if (!show) return;
    for (let i = 0; i < n; i++) {
      const p = points[i]!;
      this.ghostPositions[i * 3] = p.x;
      this.ghostPositions[i * 3 + 1] = p.y;
      this.ghostPositions[i * 3 + 2] = p.z;
    }
    const positions = this.ghostPositions.subarray(0, n * 3);
    this.arcHalo.geometry.setPositions(positions);
    this.arcCore.geometry.setPositions(positions);
  }

  sync(sim: Simulation, intentZoom: boolean, dt = 1 / 60, cameraDt = dt): void {
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
      kick: false,
      kickHeld: false,
      burstPower: false,
      aimCancel: false,
      burst: false,
      tackleHeld: false,
      passHeld: false,
      zoomOut: intentZoom,
      zoomTogglePressed: false,
      middleZoomPressed: false,
      resetBall: false,
      level: false,
      ballCamToggle: false,
      toggleDev: false,
      aimRangeDelta: 0,
      callForPass: false,
    });

    const humanPos = sim.getHuman().position;
    this.worldUp.copy(authoritativeUp(sim.tunables.goalAxisUp));
    // Level to the control up. World up flips the horizon once the look is
    // steep, and the stick then disagrees with the picture.
    this.chase.step(
      pose.position,
      pose.target,
      pose.up,
      sim.tunables.camStiffness,
      sim.tunables.camSwivel,
      cameraDt,
    );
    this.camera.position.copy(this.chase.position);
    this.camera.quaternion.copy(this.chase.quaternion);
    this.camera.up.copy(this.chase.up);
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
      const back = this.camScratch.offset.copy(this.camera.position).sub(humanPos);
      if (back.lengthSq() > 1e-6) this.camera.position.addScaledVector(back.normalize(), 0.32 * burstK);
    }
    if (sim.cameraShake > 0) {
      const mag = sim.cameraShake * sim.cameraShake * 0.34;
      const sway = Math.sin(this.pulse * 46);
      const bob = Math.cos(this.pulse * 37);
      this.camera.position.addScaledVector(this.camera.up, sway * mag);
      this.camScratch.view.crossVectors(this.camera.up, this.camScratch.offset);
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
      const rig = swimmerRig(mesh);
      if (!rig && p.actionPose === 'burst') {
        const follow = THREE.MathUtils.clamp(p.actionPoseTime / 0.14, 0, 1);
        mesh.rotateZ(-0.55 * follow);
      }
      if (rig) {
        updateSwimmerRig(rig, mesh, p, sim, dt);
        // After the mixer and the pose offsets, so the ball sits in the palm
        // for this frame and the sim releases from that same point.
        sim.setCarryPalm(p.id, readCarrierPalm(rig, p, this.palmPoint));
      } else {
        this.poseLimbs(mesh, p, sim, dt);
        sim.clearCarryPalm(p.id);
      }
      const flash = mesh.getObjectByName('hitFlash');
      if (flash instanceof THREE.Mesh) {
        const mat = flash.material as THREE.MeshBasicMaterial;
        mat.opacity = p.hitFlash * 0.85;
        flash.visible = p.hitFlash > 0.02;
      }
      const youRing = mesh.getObjectByName('youRing');
      if (youRing) {
        youRing.visible = this.indicators.rings;
        if (this.indicators.rings && !this.indicators.bold) {
          youRing.scale.setScalar(0.42);
          const mat = youRing instanceof THREE.Mesh ? (youRing.material as THREE.MeshBasicMaterial) : null;
          if (mat) mat.opacity = 0.28;
        } else if (youRing instanceof THREE.Mesh) {
          youRing.scale.setScalar(1);
          const mat = youRing.material as THREE.MeshBasicMaterial;
          mat.opacity = 0.8;
        }
      }
      const ring = mesh.getObjectByName('carrierRing');
      const locked = sim.landingMarker.lockId === p.id || sim.shotAim.lockId === p.id;
      if (ring) {
        ring.visible = this.indicators.rings && (p.hasBall || locked);
        ring.rotation.z = this.pulse * 2.5;
        const ringMat = ring instanceof THREE.Mesh ? (ring.material as THREE.MeshBasicMaterial) : null;
        if (ringMat) {
          ringMat.color.setHex(locked ? 0xc6ff6a : p.hasBall ? TEAM_COLORS[p.team] ?? 0xffe066 : 0xffe066);
          ringMat.transparent = true;
          ringMat.opacity = this.indicators.bold ? 1 : 0.4;
          const pulse = this.indicators.bold
            ? locked
              ? 1.35 + Math.sin(this.pulse * 9) * 0.12
              : 1
            : 0.46;
          ring.scale.setScalar(pulse);
        }
      }
      const badge = mesh.getObjectByName('teamBadge');
      if (badge) badge.lookAt(this.camera.position);
      this.syncCatchReadyMark(mesh, p.catchReady);
    }

    this.ballPivot.position.copy(sim.ball.position);
    this.bubbleUp.copy(authoritativeUp(sim.tunables.goalAxisUp));
    this.spinBall(sim, dt);
    if (this.shot === 'ball' && sim.ball.velocity.length() < 0.2) {
      this.ballPivot.rotation.set(0.22, 0.62, 0.05);
    }
    this.ballHalo.position.copy(sim.ball.position);
    this.ballRing.position.copy(sim.ball.position);
    this.ballRing.lookAt(this.camera.position);

    const haloMat = this.ballHalo.material as THREE.MeshBasicMaterial;
    const ringMat = this.ballRing.material as THREE.MeshBasicMaterial;
    const trailMat = this.ballTrail.material as THREE.LineBasicMaterial;
    const pipMat = this.pip.material as THREE.SpriteMaterial;

    const held = sim.ball.possession === 'held' && sim.ball.ownerId !== null;
    const showBubble = this.indicators.ballBubble;
    this.ballHalo.visible = showBubble;
    if (held) {
      const owner = sim.players[sim.ball.ownerId!];
      const team = owner?.team ?? 0;
      const teamColor = TEAM_COLORS[team]!;
      haloMat.color.setHex(teamColor);
      haloMat.opacity = this.indicators.bold ? 0.28 : 0.12;
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
      const pulse = 1 + Math.sin(this.pulse * 6) * (this.indicators.bold ? 0.08 : 0.03);
      this.ballHalo.scale.setScalar(this.indicators.bold ? pulse : pulse * 0.72);
      this.tintHeldBall(team);
    } else {
      haloMat.color.setHex(0xffe066);
      const pulse = 0.1 + Math.sin(this.pulse * 5) * 0.04;
      haloMat.opacity = this.indicators.bold ? pulse : pulse * 0.45;
      ringMat.color.setHex(0xfff3b0);
      ringMat.transparent = true;
      ringMat.opacity = this.indicators.bold ? 0.45 : 0.22;
      this.ballRing.visible = showBubble;
      trailMat.color.setHex(0xffe066);
      trailMat.opacity = 0.55;
      pipMat.map = this.pipFree;
      pipMat.needsUpdate = true;
      const haloScale = 1.1 + Math.sin(this.pulse * 5) * 0.12;
      this.ballHalo.scale.setScalar(this.indicators.bold ? haloScale : haloScale * 0.7);
      this.tintHeldBall(null);
    }

    this.writeLine(this.ballTrail, this.trailPositions, sim.ball.trail, TRAIL_MAX);

    this.worldUp.set(0, sim.tunables.goalAxisUp ? 0 : 1, sim.tunables.goalAxisUp ? 1 : 0);
    this.pip.position.copy(sim.ball.position).addScaledVector(this.worldUp, this.indicators.bold ? 1.15 : 0.72);
    this.pip.visible = this.indicators.prompt;
    pipMat.opacity = this.indicators.bold ? 1 : 0.55;
    const pipPulse = (this.indicators.bold ? 1.35 : 0.48) + Math.sin(this.pulse * 4) * (this.indicators.bold ? 0.12 : 0.03);
    this.pip.scale.set(pipPulse, pipPulse, pipPulse);

    this.writeArc(sim.chargeGhost);
    this.syncAiIntents(sim);
    this.syncLandingMarker(sim);
    this.syncPullBand(sim);
    this.syncCatchBeacon(sim);
    this.syncBubbles(sim, dt);
    this.syncGoalFlash(sim);
    this.syncSplash(sim);
    this.water.setCheer(sim.goalCelebrate > 0.12 ? 1 : 0);
    if (this.fogTick++ % 45 === 0) this.water.patchFog(this.scene);
    if (this.shot) this.frameShot();
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

  /** Fixed cameras for the art-pass stills. Normal play never sets `shot`. */
  private frameShot(): void {
    this.camera.up.set(0, 1, 0);
    if (this.shot === 'wide') {
      // Above the wall walk, still inside the sky cylinder.
      this.camera.position.set(210, 125, 168);
      this.camera.lookAt(0, -8, 0);
      this.camera.fov = 48;
    } else if (this.shot === 'ball') {
      this.camera.position.set(0.72, 0.08, 1.28);
      this.camera.lookAt(0, -0.04, 0);
      this.camera.fov = 26;
      this.ballHalo.visible = false;
      this.ballRing.visible = false;
      this.pip.visible = false;
    } else if (this.shot === 'play') {
      // In the upper seats, looking across the bowl: near crowd, the pool, and the far wall.
      this.camera.position.set(132, 10, 30);
      this.camera.lookAt(0, -10, -6);
      this.camera.fov = 64;
    } else if (this.shot === 'windup' || this.shot === 'bank') {
      this.camera.position.set(2.15, 1.05, 3.15);
      this.camera.lookAt(0, 0.28, 0.05);
      this.camera.fov = 32;
      this.shotMarker.visible = false;
      this.catchBeacon.visible = false;
      this.pip.visible = false;
      this.ballRing.visible = false;
      this.scene.traverse((obj) => {
        if (obj.name === 'youRing' || obj.name === 'carrierRing' || obj.name === 'catchReadyMark') obj.visible = false;
      });
    } else {
      this.camera.position.set(-2.2, 2.6, -18.5);
      this.camera.lookAt(0.4, 0.5, 14);
      this.camera.fov = 64;
    }
    this.camera.updateProjectionMatrix();
  }

  private syncAiIntents(sim: Simulation): void {
    const marks = sim.tunables.showAiIntent ? sim.aiIntents : [];
    const attr = this.aiIntentLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    let count = 0;
    for (const mark of marks) {
      if (count >= 8) break;
      const i = count * 6;
      this.aiIntentPositions[i] = mark.from.x;
      this.aiIntentPositions[i + 1] = mark.from.y;
      this.aiIntentPositions[i + 2] = mark.from.z;
      this.aiIntentPositions[i + 3] = mark.to.x;
      this.aiIntentPositions[i + 4] = mark.to.y;
      this.aiIntentPositions[i + 5] = mark.to.z;
      count += 1;
    }
    this.aiIntentLine.visible = count > 0;
    attr.needsUpdate = true;
    this.aiIntentLine.geometry.setDrawRange(0, count * 2);
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
    this.catchBeacon.visible = this.indicators.beacons && beacon.visible;
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
  /** Faint stretch from the hand back along the aim while a pull is held. */
  private syncPullBand(sim: Simulation): void {
    const band = sim.pullBand;
    this.pullLine.visible = band.visible;
    if (!band.visible) return;
    this.pullPositions[0] = band.from.x;
    this.pullPositions[1] = band.from.y;
    this.pullPositions[2] = band.from.z;
    this.pullPositions[3] = band.to.x;
    this.pullPositions[4] = band.to.y;
    this.pullPositions[5] = band.to.z;
    const attr = this.pullLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    const mat = this.pullLine.material as THREE.LineBasicMaterial;
    mat.opacity = 0.16 + sim.charge.amount * 0.5;
  }

  private syncLandingMarker(sim: Simulation): void {
    const mark = sim.landingMarker;
    this.shotMarker.visible = mark.visible;
    this.distanceSprite.visible = mark.visible;
    const showReach = mark.visible && mark.showReach;
    this.placeReach(this.reachMin, mark.minPosition, showReach);
    this.placeReach(this.reachMax, mark.maxPosition, showReach);
    if (!mark.visible) return;

    const circleAt = mark.focusRadius > 0 ? mark.straightPosition : mark.position;
    this.shotMarker.position.copy(circleAt);
    const toCam = this.camScratch.view.copy(this.camera.position).sub(circleAt);
    if (toCam.lengthSq() > 1e-4) {
      this.shotMarker.position.addScaledVector(toCam.normalize(), 0.85);
    }
    const dist = Math.max(0.5, this.camera.position.distanceTo(this.shotMarker.position));
    const locked = mark.lockId !== null;
    const radius = mark.focusRadius > 0 ? mark.focusRadius : bigFocusRadius(dist);
    const scale = Math.max(1e-4, radius / FOCUS_RING_RADIUS);
    // The ring grows to the big focus circle. The dot stays a cursor on that edge.
    this.shotMarker.scale.setScalar(1);
    this.shotMarkerRing.scale.setScalar(scale);
    const core = this.shotMarker.getObjectByName('landingCore');
    const glow = this.shotMarker.getObjectByName('landingGlow');
    if (core) core.position.copy(mark.position).sub(circleAt);
    if (glow) {
      glow.position.copy(core ? core.position : mark.position);
      glow.scale.set(0.9, 0.9, 1);
    }
    this.shotMarkerRing.lookAt(this.camera.position);

    const far = mark.outOfReach;
    const markerHex = far ? 0xd25a4a : mark.pulse > 0.35 ? 0xffffff : locked ? 0xc6ff6a : 0xffe066;
    const ringHex = far ? 0xe7b2a8 : mark.pulse > 0.35 ? 0xfff6d0 : locked ? 0xf4ffe4 : 0xfff4cc;
    this.shotMarkerMat.color.setHex(markerHex);
    this.shotMarkerRingMat.color.setHex(ringHex);
    this.shotMarkerGlowMat.color.setHex(markerHex);
    this.shotMarkerMat.opacity = far ? 0.28 : 0.62;
    this.shotMarkerRingMat.opacity = far ? 0.22 : 0.46;
    this.shotMarkerGlowMat.opacity = far ? 0.12 : 0.26;

    const label = `${Math.max(0, Math.round(mark.distance))}u`;
    if (label !== this.distanceShown) {
      this.paintDistance(label);
      this.distanceShown = label;
    }
    const up = this.camScratch.offset.copy(this.camera.up);
    if (up.lengthSq() < 1e-6) up.set(0, 1, 0);
    else up.normalize();
    const lift = THREE.MathUtils.clamp(dist * 0.03, 0.36, 1.55);
    this.distanceSprite.position.copy(this.shotMarker.position).addScaledVector(up, lift);
    const labelScale = THREE.MathUtils.clamp(dist * 0.015, 0.32, 1.55);
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
    mesh.scale.setScalar(THREE.MathUtils.clamp(dist * BIG_RING_SCALE_PER_M, BIG_RING_SCALE_MIN, BIG_RING_SCALE_MAX));
    mesh.lookAt(this.camera.position);
  }

  /** Small ring and hand glows while catch-ready is on. Hidden the rest of the time. */
  private syncCatchReadyMark(group: THREE.Group, ready: boolean): void {
    let mark = group.getObjectByName('catchReadyMark');
    if (!ready || !this.indicators.beacons) {
      if (mark) mark.visible = false;
      return;
    }
    if (!mark) {
      mark = new THREE.Group();
      mark.name = 'catchReadyMark';
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.38, 0.03, 6, 22),
        new THREE.MeshBasicMaterial({
          color: 0xbdf6f0,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      ring.name = 'catchReadyRing';
      ring.position.set(0, 0.28, 1.05);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x8ce6e8,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      });
      const left = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), glowMat);
      const right = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), glowMat);
      left.position.set(0.22, 0.32, 0.78);
      right.position.set(-0.22, 0.32, 0.78);
      mark.add(ring, left, right);
      group.add(mark);
    }
    mark.visible = true;
    const pulse = 0.45 + Math.sin(this.pulse * 6) * 0.15;
    mark.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mat = child.material;
      if (mat instanceof THREE.MeshBasicMaterial) mat.opacity = child.name === 'catchReadyRing' ? 0.4 + pulse * 0.35 : pulse;
    });
  }

  /** A quiet team wash on the ball while someone holds it. The big bubble is separate. */
  private tintHeldBall(team: 0 | 1 | null): void {
    this.ballPivot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) {
        if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshBasicMaterial)) continue;
        const data = material.userData as { holdBase?: THREE.Color; holdEmissive?: THREE.Color; holdEmissiveIntensity?: number };
        if (!data.holdBase) {
          data.holdBase = material.color.clone();
          if (material instanceof THREE.MeshStandardMaterial) {
            data.holdEmissive = material.emissive.clone();
            data.holdEmissiveIntensity = material.emissiveIntensity;
          }
        }
        if (team === null) {
          material.color.copy(data.holdBase);
          if (material instanceof THREE.MeshStandardMaterial && data.holdEmissive) {
            material.emissive.copy(data.holdEmissive);
            material.emissiveIntensity = data.holdEmissiveIntensity ?? material.emissiveIntensity;
          }
          continue;
        }
        this.holdTeam.setHex(team === 0 ? 0x2b9fff : 0xff6a3d);
        this.holdTint.copy(data.holdBase).lerp(this.holdTeam, 0.38);
        material.color.copy(this.holdTint);
        if (material instanceof THREE.MeshStandardMaterial) {
          material.emissive.copy(this.holdTeam);
          material.emissiveIntensity = 0.22;
        }
      }
    });
  }

  private applyGoalIndicators(): void {
    const show = this.indicators.goalTarget;
    const amount = this.indicators.bold ? 1 : 0.28;
    for (const name of ['goal-blue', 'goal-orange']) {
      const target = this.scene.getObjectByName(name)?.getObjectByName('goalTarget');
      if (!target) continue;
      target.visible = show;
      target.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of list) {
          if (!('opacity' in material)) continue;
          const data = material.userData as { baseOpacity?: number };
          if (typeof data.baseOpacity !== 'number') data.baseOpacity = material.opacity;
          material.transparent = true;
          material.opacity = data.baseOpacity * amount;
        }
      });
    }
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
    const ready = pose === 'claim' || player.catchReady;
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
    let kick = 0;
    if (pose === 'kick') {
      const duration = Math.max(0.05, player.actionPoseDuration);
      const t = 1 - THREE.MathUtils.clamp(player.actionPoseTime / duration, 0, 1);
      kick = t < 0.45 ? THREE.MathUtils.lerp(-1.1, 1.2, t / 0.45) : THREE.MathUtils.lerp(1.2, 0.15, (t - 0.45) / 0.55);
    } else if (sim.charge.kind === 'kick') {
      kick = -0.9 * sim.charge.amount;
    }
    const kickLeg = player.throwArm === 'left' ? legL : legR;
    const plant = player.throwArm === 'left' ? legR : legL;
    kickLeg.rotation.set(xLegR + kick, 0, 0);
    plant.rotation.set((player.throwArm === 'left' ? xLegL : xLegR) - kick * 0.25, 0, 0);
  }

  render(): void {
    this.water.beforeRender(this.renderer, this.scene, this.camera, this.pulse);
    this.renderer.render(this.scene, this.camera);
  }
}
