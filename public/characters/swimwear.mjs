// Tiny helper: attach Character Forge swimwear garments to the base swimmer by bone name, and apply wardrobe.json hides.
// three.js >= r150. Usage:
//   const base = await loader.loadAsync('swimmer_base.glb');
//   const man = await (await fetch('wardrobe.json')).json();
//   const worn = {};
//   for (const id of ['trunks', 'boardshorts_asym']) worn[id] = attachGarment(base, await loader.loadAsync(man.garments[id].file));
//   applyHides(base, worn, man);
//   const mixer = new THREE.AnimationMixer(base.scene); mixer.clipAction(base.animations.find(c => c.name === 'Swim')).play();
//   worn.boardshorts_asym[0].material.color.set('#2a6cff');   // team tint (TeamTint material, one per garment)
import * as THREE from 'three';
export function attachGarment(base, garment) {
  const bones = {}; base.scene.traverse(o => { if (o.isBone) bones[o.name] = o; });
  const meshes = []; garment.scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  for (const m of meshes) {
    const skel = new THREE.Skeleton(m.skeleton.bones.map(b => { const t = bones[b.name]; if (!t) throw new Error('missing bone ' + b.name); return t; }),
                                     m.skeleton.boneInverses);           // inverse binds are identical to the base file
    base.scene.add(m);                                                   // mesh nodes sit at the scene root (identity), like the base body
    m.bind(skel, m.bindMatrix); m.frustumCulled = false;
  }
  return meshes;                                                         // [SkinnedMesh] (trunks has 3 segment nodes)
}
export function applyHides(base, worn, man) {
  const byName = {}; base.scene.traverse(o => { byName[o.name] = o; });
  for (const id in worn) for (const m of worn[id]) m.visible = true;
  for (const seg of Object.values(man.base.segments)) if (byName[seg]) byName[seg].visible = true;
  for (const id in worn) for (const h of man.garments[id].hides) {
    if (h.startsWith('body:')) { const n = byName[man.base.segments[h]]; if (n) n.visible = false; }
    else if (h.includes(':')) { const [g] = h.split(':'); const node = man.garments[g]?.segments[h]; (worn[g] || []).forEach(m => { if (m.name === node) m.visible = false; }); }
    else (worn[h] || []).forEach(m => { m.visible = false; });
  }
}
