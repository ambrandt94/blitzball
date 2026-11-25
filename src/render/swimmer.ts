import * as THREE from 'three';

export const TEAM = {
  0: {
    suit: 0x1c6fe0,
    armor: 0xd7f4ff,
    armorEmissive: 0x0d3048,
    dark: 0x071422,
    visor: 0xc8fbff,
    visorEmissive: 0x6adfff,
  },
  1: {
    suit: 0xf2642a,
    armor: 0xffe2c4,
    armorEmissive: 0x4a1c08,
    dark: 0x1c0c08,
    visor: 0xfff1c9,
    visorEmissive: 0xffb45a,
  },
} as const;

/**
 * Athletic wetsuit swimmer. Limb pivots stay named so the procedural poses still drive them.
 * Body meshes live under `proceduralBody` so a loaded GLB can replace them and leave the
 * rings, badge, and hit flash in place.
 */
export function createSwimmer(team: 0 | 1, marker: 'you' | 'mate' | 'none'): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'proceduralBody';
  group.add(body);
  const palette = TEAM[team];
  const suit = new THREE.MeshStandardMaterial({
    color: palette.suit,
    roughness: 0.4,
    metalness: 0.2,
  });
  const armor = new THREE.MeshStandardMaterial({
    color: palette.armor,
    emissive: palette.armorEmissive,
    emissiveIntensity: 0.45,
    roughness: 0.28,
    metalness: 0.64,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: palette.dark,
    roughness: 0.58,
    metalness: 0.18,
  });
  const visor = new THREE.MeshStandardMaterial({
    color: palette.visor,
    emissive: palette.visorEmissive,
    emissiveIntensity: 0.9,
    roughness: 0.12,
    metalness: 0.35,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xe8b84a,
    emissive: 0x5a3e0c,
    emissiveIntensity: 0.35,
    metalness: 0.72,
    roughness: 0.3,
  });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.5, 5, 10), suit);
  torso.rotation.x = Math.PI / 2;
  torso.position.set(0, 0.02, 0.06);
  body.add(torso);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.32), armor);
  chest.position.set(0, 0.16, 0.2);
  body.add(chest);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.34), gold);
  stripe.position.set(0, 0.2, 0.2);
  body.add(stripe);

  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.42), gold);
  ridge.position.set(0, 0.26, -0.02);
  body.add(ridge);

  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), suit);
  hips.scale.set(1.15, 0.82, 0.95);
  hips.position.set(0, -0.02, -0.28);
  body.add(hips);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), suit);
  head.scale.set(1, 0.94, 1.05);
  head.position.set(0, 0.1, 0.7);
  body.add(head);

  const visorMesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), visor);
  visorMesh.scale.set(1.45, 0.55, 0.42);
  visorMesh.position.set(0, 0.12, 0.88);
  body.add(visorMesh);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.08), visor);
  nose.position.set(0, 0.12, 1.0);
  nose.name = 'facingChevron';
  body.add(nose);

  for (const side of [-1, 1] as const) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), armor);
    pad.scale.set(1.15, 0.8, 0.95);
    pad.position.set(side * 0.32, 0.12, 0.26);
    body.add(pad);

    const pivot = new THREE.Group();
    pivot.name = side < 0 ? 'armL' : 'armR';
    pivot.position.set(side * 0.3, 0.08, 0.28);
    const alongX = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.26, 4, 8), suit);
    upper.rotation.z = alongX;
    upper.position.set(side * 0.2, 0, 0);
    pivot.add(upper);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.2, 4, 8), suit);
    fore.rotation.z = alongX;
    fore.position.set(side * 0.46, 0, 0);
    pivot.add(fore);
    const cuff = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), armor);
    cuff.position.set(side * 0.58, 0, 0);
    pivot.add(cuff);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.16), armor);
    hand.position.set(side * 0.68, 0, 0.02);
    pivot.add(hand);
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.07), gold);
    thumb.position.set(side * 0.6, side * 0.02, 0.07);
    pivot.add(thumb);
    body.add(pivot);
  }

  for (const side of [-1, 1] as const) {
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? 'legL' : 'legR';
    pivot.position.set(side * 0.13, -0.03, -0.4);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.26, 4, 8), suit);
    thigh.rotation.x = Math.PI / 2;
    thigh.position.set(0, 0, -0.2);
    pivot.add(thigh);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.2, 4, 8), dark);
    shin.rotation.x = Math.PI / 2;
    shin.position.set(0, 0, -0.48);
    pivot.add(shin);
    const fin = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), dark);
    fin.scale.set(1.9, 0.28, 2.15);
    fin.position.set(0, -0.02, -0.78);
    pivot.add(fin);
    const finEdge = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.018, 0.07), gold);
    finEdge.position.set(0, 0.03, -0.66);
    pivot.add(finEdge);
    body.add(pivot);
  }

  if (marker === 'you' || marker === 'mate') {
    const youRing = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 0.92, 28),
      new THREE.MeshBasicMaterial({
        color: marker === 'you' ? 0xffffff : 0x7dffa8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
        toneMapped: false,
      }),
    );
    youRing.rotation.x = Math.PI / 2;
    youRing.position.y = -0.42;
    youRing.name = 'youRing';
    youRing.visible = false;
    group.add(youRing);
  }

  const carrier = new THREE.Mesh(
    new THREE.TorusGeometry(1.15, 0.07, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xffe066, toneMapped: false }),
  );
  carrier.name = 'carrierRing';
  carrier.visible = false;
  carrier.rotation.x = Math.PI / 2;
  group.add(carrier);

  const badge = new THREE.Mesh(
    new THREE.CircleGeometry(0.16, 12),
    new THREE.MeshBasicMaterial({
      color: palette.suit,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  badge.position.set(0, 0.42, 0.15);
  badge.name = 'teamBadge';
  group.add(badge);

  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 14, 10),
    new THREE.MeshBasicMaterial({
      color: 0xfff4e4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  flash.name = 'hitFlash';
  flash.visible = false;
  group.add(flash);

  return group;
}
