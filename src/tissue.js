import * as THREE from "three";

// Материалы тканей: кость, связка (с волокнами), хрящ, капсула, сумка, жир, студенистое ядро.
// Волокон в геометрии Z-Anatomy нет — они рисуются процедурно: рельеф вытянут вдоль главной оси связки.

const TISSUES = {
  bone:      { color: 0xe8dbc2, roughness: 0.58, freq: 260, aniso: 1, str: 0.14, bump: 0.5 },
  ligament:  { color: 0xeef1f3, roughness: 0.45, clearcoat: 0.4, freq: 1100, aniso: 0.04, str: 1, bump: 3 },
  cartilage: { color: 0xc2dcf2, roughness: 0.32, clearcoat: 0.7, freq: 500, aniso: 1, str: 0.2, bump: 0.4 },
  nucleus:   { color: 0x9cc6f0, roughness: 0.25, clearcoat: 1, freq: 300, aniso: 1, str: 0.2, bump: 0.3 },
  capsule:   { color: 0xa9c6e6, roughness: 0.4, clearcoat: 0.3, freq: 700, aniso: 0.12, str: 0.5, bump: 1.0, opacity: 0.26 },
  bursa:     { color: 0x8fbdf0, roughness: 0.35, clearcoat: 0.6, freq: 400, aniso: 1, str: 0.2, bump: 0.3, opacity: 0.32 },
  fat:       { color: 0xf0c75a, roughness: 0.5, freq: 380, aniso: 1, str: 0.45, bump: 1.4, opacity: 0.85 },
};

export function tissueOf(name, isBone) {
  if (isBone) return "bone";
  if (/capsule|Frenula/i.test(name)) return "capsule";
  if (/bursa/i.test(name)) return "bursa";
  if (/fat pad/i.test(name)) return "fat";
  if (/Nucleus pulposus/i.test(name)) return "nucleus";
  if (/disc|meniscus|labrum|symphysis/i.test(name)) return "cartilage";
  return "ligament";
}

// Главная ось формы (первая главная компонента вершин) — вдоль неё идут волокна связки
function mainAxis(mesh) {
  const pos = mesh.geometry.attributes.position;
  const n = pos.count;
  const step = Math.max(1, Math.floor(n / 4000));
  const v = new THREE.Vector3();
  const mean = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i < n; i += step, k++) mean.add(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  mean.divideScalar(k);
  const c = [0, 0, 0, 0, 0, 0]; // xx xy xz yy yz zz
  for (let i = 0; i < n; i += step) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).sub(mean);
    c[0] += v.x * v.x; c[1] += v.x * v.y; c[2] += v.x * v.z; c[3] += v.y * v.y; c[4] += v.y * v.z; c[5] += v.z * v.z;
  }
  let a = new THREE.Vector3(1, 1, 1).normalize();
  for (let it = 0; it < 30; it++) {
    a = new THREE.Vector3(
      c[0] * a.x + c[1] * a.y + c[2] * a.z,
      c[1] * a.x + c[3] * a.y + c[4] * a.z,
      c[2] * a.x + c[4] * a.y + c[5] * a.z,
    ).normalize();
  }
  return a.lengthSq() ? a : new THREE.Vector3(0, 1, 0);
}

const NOISE = /* glsl */ `
uniform vec3 uAxis;
uniform float uFreq, uAniso, uStr, uBump;
varying vec3 vTissuePos;
float tHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float tNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(tHash(i), tHash(i + vec3(1, 0, 0)), f.x), mix(tHash(i + vec3(0, 1, 0)), tHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(tHash(i + vec3(0, 0, 1)), tHash(i + vec3(1, 0, 1)), f.x), mix(tHash(i + vec3(0, 1, 1)), tHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 tPerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos)); vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm); vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

function injectTissue(material, t, axis) {
  const uniforms = {
    uAxis: { value: axis },
    uFreq: { value: t.freq },
    uAniso: { value: t.aniso },
    uStr: { value: t.str },
    uBump: { value: t.bump },
  };
  material.userData.tissueUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTissuePos;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvTissuePos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + NOISE)
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec3 ta = normalize(uAxis);
        vec3 tb = normalize(cross(ta, abs(ta.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec3 tc = cross(ta, tb);
        vec3 tq = vec3(dot(vTissuePos, tb), dot(vTissuePos, tc), dot(vTissuePos, ta) * uAniso) * uFreq;
        float tH = 0.62 * tNoise(tq) + 0.38 * tNoise(tq * 2.07 + 11.3);
        // Мелкий рисунок гаснет, когда становится меньше пикселя, — без ряби
        float tFade = uStr * (1.0 - smoothstep(0.35, 0.9, length(fwidth(tq.xy))));
        diffuseColor.rgb *= mix(1.0, 0.68 + 0.48 * tH, tFade);`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        normal = tPerturb(-vViewPosition, normal, vec2(dFdx(tH), dFdy(tH)) * uBump * tFade, faceDirection);`);
  };
  material.customProgramCacheKey = () => "tissue";
}

export function makeTissueMaterial(mesh, kind) {
  const t = TISSUES[kind];
  const Mat = t.clearcoat ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new Mat({ color: t.color, roughness: t.roughness, metalness: 0 });
  if (t.clearcoat) { m.clearcoat = t.clearcoat; m.clearcoatRoughness = 0.35; }
  // Соседние связки чуть различаются по тону, чтобы не сливаться
  if (kind !== "bone") {
    let h = 0;
    for (const ch of mesh.userData.fullName) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    m.color.offsetHSL(((h % 100) / 100 - 0.5) * 0.04, 0, ((h >> 8) % 100 / 100 - 0.5) * 0.06);
  }
  m.userData.baseColor = m.color.clone();
  m.userData.baseOpacity = t.opacity ?? 1;
  injectTissue(m, t, kind === "ligament" || kind === "capsule" ? mainAxis(mesh) : new THREE.Vector3(0, 1, 0));
  return m;
}
