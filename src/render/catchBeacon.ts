import * as THREE from 'three';

/** Glowing ring and vertical beam. Reads in depth without sitting on the ball mesh. */
export function createCatchBeacon(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'catchBeacon';
  const aqua = new THREE.MeshBasicMaterial({
    color: 0x7dfff2,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    toneMapped: false,
  });
  const warm = new THREE.MeshBasicMaterial({
    color: 0xfff3b0,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    toneMapped: false,
  });

  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.065, 8, 40), aqua);
  ring.rotation.x = Math.PI / 2;
  ring.name = 'catchRing';
  group.add(ring);

  const inner = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.04, 8, 28), warm);
  inner.rotation.x = Math.PI / 2;
  inner.name = 'catchRingInner';
  group.add(inner);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 4.4, 6),
    new THREE.MeshBasicMaterial({
      color: 0x9afbff,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  beam.position.y = 2.2;
  beam.name = 'catchBeam';
  group.add(beam);

  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), warm);
  core.name = 'catchCore';
  group.add(core);

  for (let i = 0; i < 4; i++) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.04), aqua);
    const a = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(a) * 1.48, 0.02, Math.sin(a) * 1.48);
    tick.rotation.y = -a;
    group.add(tick);
  }

  group.visible = false;
  return group;
}
