import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { tissueOf, makeTissueMaterial } from "./tissue.js";

// ---------- состояние ----------
const state = {
  section: null,      // раздел (data/<id>.json): главы, термины, регионы
  chapter: null,      // открытая модель — глава книги
  focusIds: [],       // термины, структуры которых сейчас в фокусе (глава или весь регион для превью)
  term: null,         // выбранный термин
  bone: null,         // выбранная кость (из списка «Кости»)
  tab: "about",       // about | parts | quiz
  bonesGhost: false,  // кости полупрозрачные (рентген)
  showOthers: false,  // показывать структуры других глав
  solidBones: new Set(), // кости, которых касаются структуры модели: непрозрачные, остальные — фон
};
const meshesByName = new Map();   // полное имя объекта → [Mesh]
const meshesByBase = new Map();   // базовое имя (без стороны .r/.l/.el…) → [Mesh]
const termByMesh = new Map();     // базовое имя → id термина
const chapterOfTerm = new Map();  // id термина → первая глава, где он встречается
let modelRoot = null;
let loadedModelUrl = null;
let rightSign = -1;               // знак X правой половины тела (для вида «сбоку»)

const BASE = import.meta.env.BASE_URL;
const params = new URLSearchParams(location.search);
const THUMB = params.get("thumb"); // режим снимка превью: ?thumb=<глава>|region:<id>&view=ant
const $ = (s) => document.querySelector(s);
const baseName = (n) => n.replace(/\.(e|o)?\d?(r|l)$/, "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const uniq = (a) => [...new Set(a)];

// ---------- сцена ----------
const canvas = $("#view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!THUMB });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping; // сохраняет естественные цвета тканей
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
// Узкий диапазон глубины — точнее буфер глубины, меньше мерцания соседних поверхностей
const camera = new THREE.PerspectiveCamera(35, 1, 0.02, 12);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.autoRotateSpeed = 2.5;

// Свет как в студии, привязан к камере: ключевой слева сверху, заполняющий справа, контровой сзади.
// Карты окружения нет: её равномерная засветка делала кости плоскими, без светотени.
scene.add(new THREE.HemisphereLight(0xe4ecff, 0x1c1814, 0.45));
const lightTarget = new THREE.Object3D();
lightTarget.position.set(0, 0, -1);
camera.add(lightTarget);
for (const [color, intensity, pos] of [
  [0xfff2e0, 3.2, [-1.2, 1.6, 1.4]],  // ключевой
  [0xd8e6ff, 0.8, [1.6, -0.4, 1.0]],  // заполняющий
  [0xa8ccff, 2.2, [0.4, 1.2, -2.0]],  // контровой — светлая кромка по силуэту
]) {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.set(...pos);
  l.target = lightTarget;
  camera.add(l);
}
scene.add(camera);

// Тёмный фон с мягким светлым центром
scene.background = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(256, 220, 20, 256, 256, 380);
  grad.addColorStop(0, "#3a4350");
  grad.addColorStop(1, "#101318");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

// Постобработка: сглаживание (MSAA), контур выбранного, вывод с тоновой коррекцией
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const outline = new OutlinePass(new THREE.Vector2(1, 1), scene, camera);
outline.visibleEdgeColor.set(0xffb066);
outline.hiddenEdgeColor.set(0x8a3a10);
outline.edgeStrength = 4;
outline.edgeThickness = 1.2;
composer.addPass(outline);
composer.addPass(new OutputPass());

let dirty = true; // кадр перерисовывается только когда что-то изменилось
const invalidate = () => { dirty = true; };
controls.addEventListener("change", invalidate);

const marker = new THREE.Mesh(
  new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xe8590c, depthTest: false, transparent: true, opacity: 0.9 }),
);
marker.renderOrder = 10;
marker.visible = false;
scene.add(marker);

const draco = new DRACOLoader();
draco.setDecoderPath(BASE + "draco/");
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas.parentElement;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  invalidate();
}
new ResizeObserver(resize).observe(canvas.parentElement);

let flyTo = null; // плавный перелёт камеры
renderer.setAnimationLoop(() => {
  if ($("#pageModel").classList.contains("hidden")) return; // сцена не видна — не рисуем
  if (flyTo) {
    flyTo.t = Math.min(1, flyTo.t + (THUMB ? 1 : 0.06));
    const k = 1 - Math.pow(1 - flyTo.t, 3);
    controls.target.lerpVectors(flyTo.fromTarget, flyTo.toTarget, k);
    camera.position.lerpVectors(flyTo.fromPos, flyTo.toPos, k);
    if (flyTo.t >= 1) flyTo = null;
    dirty = true;
  }
  if (controls.update()) dirty = true;
  if (!dirty) return;
  dirty = false;
  composer.render();
  if (THUMB && !flyTo && modelRoot) window.__thumbReady = true;
});

// ---------- модель ----------
const HIT = new THREE.Color(0xff7a1a);

async function loadModel(url) {
  if (loadedModelUrl === url) return;
  $("#loading").classList.remove("hidden");
  if (modelRoot) scene.remove(modelRoot);
  meshesByName.clear();
  meshesByBase.clear();
  const gltf = await loader.loadAsync(BASE + url);
  modelRoot = gltf.scene;
  let sumX = 0, nRight = 0;
  modelRoot.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.userData.name || o.name;
    o.userData.fullName = name;
    o.userData.isBone = !state.section.jointMeshes.has(baseName(name));
    o.userData.tissue = tissueOf(name, o.userData.isBone);
    o.userData.box = new THREE.Box3().setFromObject(o);
    o.material = makeTissueMaterial(o, o.userData.tissue);
    if (!meshesByName.has(name)) meshesByName.set(name, []);
    meshesByName.get(name).push(o);
    const b = baseName(name);
    if (!meshesByBase.has(b)) meshesByBase.set(b, []);
    meshesByBase.get(b).push(o);
    if (/\.(e|o)?\d?r$/.test(name)) {
      sumX += new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).x;
      nRight++;
    }
  });
  if (nRight) rightSign = Math.sign(sumX) || -1;
  scene.add(modelRoot);
  loadedModelUrl = url;
  invalidate();
  $("#loading").classList.add("hidden");
}

function meshesOfTerm(term) {
  return (term.meshes || []).flatMap((n) => meshesByBase.get(n) || []);
}

// Кости, которые делаются непрозрачными: родитель точки и кости-контекст термина
function contextOfTerm(term) {
  const out = (term.context || []).flatMap((n) => meshesByBase.get(n) || []);
  if (term.parent) out.push(...(meshesByName.get(term.parent) || []));
  return out;
}

// Кости модели: те, что названы в главе, и те, чьи габариты касаются её структур
function computeSolidBones(ch) {
  const solid = new Set((ch?.bones || []).flatMap((b) => meshesByBase.get(b) || []));
  const boxes = [...focusMeshes()].map((m) => m.userData.box.clone().expandByScalar(0.004));
  modelRoot.traverse((o) => {
    if (o.isMesh && o.userData.isBone && boxes.some((b) => b.intersectsBox(o.userData.box))) solid.add(o);
  });
  state.solidBones = solid;
}

function focusMeshes() {
  const set = new Set();
  for (const id of state.focusIds) for (const m of meshesOfTerm(state.section.terms[id])) set.add(m);
  return set;
}

// Раскраска: ткани в естественных цветах; выбранное — подсветка и контур, остальное приглушается,
// чтобы выбранную структуру не закрывали кости и соседи; структуры других глав скрыты
function paint(highlight = [], solid = []) {
  if (!modelRoot) return;
  const focus = focusMeshes();
  const hi = new Set(highlight);
  const opaque = new Set(solid);
  const selecting = hi.size > 0;
  modelRoot.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const base = m.userData.baseOpacity;
    let opacity = base;
    let visible = true;
    if (hi.has(o)) opacity = Math.max(base, 0.85);
    else if (focus.has(o)) opacity = selecting ? Math.min(base, 0.12) : base;
    else if (opaque.has(o)) opacity = 1;
    else if (o.userData.isBone) opacity = state.bonesGhost || selecting ? 0.16 : state.solidBones.has(o) ? 1 : 0.22;
    else if (!state.showOthers) visible = false;
    else opacity = Math.min(base, 0.3);
    o.visible = visible;
    m.color.copy(m.userData.baseColor);
    if (hi.has(o)) m.color.lerp(HIT, 0.55);
    m.emissive.copy(HIT).multiplyScalar(hi.has(o) ? 0.18 : 0);
    // Шейдер непрозрачного материала принудительно ставит альфу 1 — при смене режима нужна пересборка
    if (m.transparent !== opacity < 1) { m.transparent = opacity < 1; m.needsUpdate = true; }
    m.opacity = opacity;
    m.depthWrite = opacity >= 0.9;
    o.renderOrder = opacity < 1 ? 1 : 0;
  });
  outline.selectedObjects = [...hi];
  invalidate();
}

// Парные структуры есть справа и слева — камера наводится на правую, чтобы объект был крупно
function oneSide(objects) {
  const right = objects.filter((o) => /\.(e|o)?\d?r$/.test(o.userData.fullName));
  const left = objects.filter((o) => /\.(e|o)?\d?l$/.test(o.userData.fullName));
  return right.length && left.length ? objects.filter((o) => !left.includes(o)) : objects;
}

// Направление «от объекта к камере» для ракурса
function viewDir(view, center) {
  const lat = Math.abs(center.x) > 0.03 ? Math.sign(center.x) : rightSign;
  switch (view) {
    case "post": return new THREE.Vector3(0, 0, -1);
    case "lat": return new THREE.Vector3(lat, 0, 0);
    case "med": return new THREE.Vector3(-lat, 0, 0);
    case "sup": return new THREE.Vector3(0, 1, 0.02).normalize();
    case "dorsal": return new THREE.Vector3(0, 1, 0.75).normalize(); // сверху-спереди: тыл стопы
    case "ant": return new THREE.Vector3(0, 0, 1);
    default: return null;
  }
}

function focusOn(objects, point = null, view = null, { bothSides = false } = {}) {
  if (!bothSides) objects = oneSide(objects);
  const box = new THREE.Box3();
  for (const o of objects) box.expandByObject(o);
  if (point) box.expandByPoint(point);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  // Не ближе ~25 см в кадре: мелкая связка видна вместе с суставом вокруг
  const size = Math.max(box.getSize(new THREE.Vector3()).length() * 1.4, 0.25);
  const dir = viewDir(view, center) || camera.position.clone().sub(controls.target).normalize();
  const dist = size / (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.min(1, camera.aspect);
  flyTo = {
    t: 0,
    fromTarget: controls.target.clone(), toTarget: center,
    fromPos: camera.position.clone(), toPos: center.clone().add(dir.multiplyScalar(dist)),
  };
}

function showMarker(term) {
  if (!term?.point) { marker.visible = false; return null; }
  const [x, y, z] = term.point; // координаты Blender (Z вверх) → glTF (Y вверх)
  marker.position.set(x, z, -y);
  marker.scale.setScalar(0.004);
  marker.visible = true;
  invalidate();
  return marker.position;
}

// Объекты, на которые смотрит камера: выбранное или вся глава
function currentTargets() {
  if (state.term) {
    const t = state.section.terms[state.term];
    const ms = meshesOfTerm(t);
    return { objs: ms.length ? ms : contextOfTerm(t), point: t.point ? marker.position : null };
  }
  if (state.bone) return { objs: meshesByBase.get(state.bone) || [], point: null };
  const objs = [...focusMeshes()];
  if (!objs.length) {
    // В главе нет своих 3D-структур — показываем её кости
    for (const id of state.focusIds) objs.push(...contextOfTerm(state.section.terms[id]));
  }
  if (!objs.length && modelRoot) objs.push(modelRoot);
  return { objs, point: null };
}

function setView(view) {
  document.querySelectorAll(".view-bar [data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  const { objs, point } = currentTargets();
  focusOn(objs, point, view);
}

function resetView() {
  state.term = null;
  state.bone = null;
  marker.visible = false;
  hideChip();
  paint();
  setView(state.chapter?.view || "ant");
  renderParts();
}

// ---------- клик и наведение на модели ----------
const ray = new THREE.Raycaster();
function pick(e) {
  if (!modelRoot) return null;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hits = ray.intersectObject(modelRoot, true).filter((h) => h.object.visible && h.object.material.opacity > 0.3);
  return hits[0]?.object || null;
}

// Русское имя объекта модели: термин главы, другой термин, кость или англ. имя
function describeMesh(mesh) {
  const name = baseName(mesh.userData.fullName);
  const inChapter = state.chapter?.terms.find((tid) => state.section.terms[tid].meshes?.includes(name));
  const id = inChapter || termByMesh.get(name);
  if (id) return { id, ru: state.section.terms[id].ru, inChapter: !!inChapter };
  return { bone: name, ru: state.section.boneNames[name] || name };
}

let downAt = null;
canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; controls.autoRotate = false; syncSpin(); });
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const hit = pick(e);
  if (state.tab === "quiz") return quiz.onPick(hit);
  if (!hit) return;
  const d = describeMesh(hit);
  if (d.inChapter) selectTerm(d.id, { fly: false });
  else showForeign(hit, d);
});

let hoverPending = false;
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || e.buttons || hoverPending || state.tab === "quiz") return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    const hit = pick(e);
    const tip = $("#hoverTip");
    if (!hit) { tip.classList.add("hidden"); canvas.style.cursor = ""; return; }
    tip.textContent = describeMesh(hit).ru;
    const r = canvas.getBoundingClientRect();
    tip.style.left = `${e.clientX - r.left + 14}px`;
    tip.style.top = `${e.clientY - r.top + 14}px`;
    tip.classList.remove("hidden");
    canvas.style.cursor = "pointer";
  });
});
canvas.addEventListener("pointerleave", () => $("#hoverTip").classList.add("hidden"));

// ---------- подпись выбранного на сцене ----------
function showChip(html) {
  const chip = $("#pickChip");
  chip.innerHTML = `<button class="chip-close" aria-label="Закрыть">×</button>${html}`;
  chip.classList.remove("hidden");
  chip.querySelector(".chip-close").onclick = resetView;
}
function hideChip() { $("#pickChip").classList.add("hidden"); }

function termChip(t) {
  return `<div class="ru">${esc(t.ru)}</div><div class="la">${esc(t.la)}</div>${t.note ? `<p>${esc(t.note)}</p>` : ""}`;
}

// ---------- выбор ----------
function selectTerm(id, { fly = true, scroll = true } = {}) {
  state.term = id;
  state.bone = null;
  const t = state.section.terms[id];
  const ms = meshesOfTerm(t);
  const p = showMarker(t);
  const ctx = contextOfTerm(t);
  paint(ms, ctx);
  if (fly) focusOn(ms.length ? ms : ctx, p);
  showChip(termChip(t));
  renderParts();
  if (scroll) document.querySelector(`#tabParts [data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  setHash(`#/m/${state.chapter.id}/${id}`);
}

function selectBone(name) {
  state.term = null;
  state.bone = name;
  marker.visible = false;
  const ms = meshesByBase.get(name) || [];
  paint(ms);
  focusOn(ms);
  showChip(`<div class="ru">${esc(state.section.boneNames[name] || name)}</div><div class="la">${esc(name)}</div>`);
  renderParts();
}

// Структура другой главы или кость, нажатая на модели
function showForeign(mesh, d) {
  state.term = null;
  state.bone = d.bone || null;
  marker.visible = false;
  paint([mesh]);
  if (d.id) {
    const ch = chapterOfTerm.get(d.id);
    showChip(`${termChip(state.section.terms[d.id])}<a class="chip-link" href="#/m/${ch.id}/${d.id}">Открыть в модели «${esc(ch.title)}» →</a>`);
  } else {
    showChip(`<div class="ru">${esc(d.ru)}</div><div class="la">${esc(d.bone)}</div>`);
  }
  renderParts();
}

// ---------- страницы ----------
const thumbUrl = (id) => `${BASE}thumbs/${id}.webp`;
const img = (id, alt = "") => `<img src="${thumbUrl(id)}" alt="${esc(alt)}" loading="lazy" onerror="this.style.visibility='hidden'">`;
const chapterById = (id) => state.section.chapters.find((c) => c.id === id);
const regionById = (id) => state.section.regions.find((r) => r.id === id);
const termsOf = (ch) => uniq(ch.terms);
const focusOf = (ch) => termsOf(ch).filter((id) => !state.section.terms[id].umbrella);
const firstFact = (ch, name) => ch.facts.find(([k]) => k === name)?.[1] || "";

function modelCard(ch) {
  const n = termsOf(ch).length;
  const kind = firstFact(ch, "Тип") || firstFact(ch, "Вид");
  return `<a class="card" href="#/m/${ch.id}">
    <div class="card-img">${img(ch.id, ch.title)}</div>
    <div class="card-body">
      <div class="card-title">${esc(ch.title)}</div>
      ${ch.la ? `<div class="card-la">${esc(ch.la)}</div>` : ""}
      ${kind ? `<div class="card-sub">${esc(kind)}</div>` : ""}
      <div class="tags"><span class="tag">${esc(regionById(ch.region).short)}</span><span class="tag">${n} структур</span></div>
    </div></a>`;
}

function renderNav() {
  $("#nav").innerHTML = state.section.regions.map((r) => `<a href="#/r/${r.id}" data-r="${r.id}">${esc(r.title)}</a>`).join("");
}

function renderHome() {
  const s = state.section;
  const nTerms = Object.keys(s.terms).length;
  $("#pageHome").innerHTML = `
    <div class="wrap">
      <section class="hero">
        <div>
          <div class="eyebrow">${esc(s.volume)} · ${esc(s.title)}</div>
          <h1>Соединения костей в 3D</h1>
          <p>Интерактивный атлас суставов и связок. Крутите модель, нажимайте на структуры и читайте, из чего состоит каждый сустав, какой он формы и какие движения в нём возможны. Объяснения — по «Атласу анатомии человека» Р. Д. Синельникова.</p>
          <div class="stats"><span><b>${s.chapters.length}</b> моделей</span><span><b>${nTerms}</b> терминов</span><span><b>${s.structureMeshes.length}</b> 3D-структур</span></div>
        </div>
        <a class="hero-img" href="#/m/knee">${img("knee", "Коленный сустав")}</a>
      </section>
      <h2 class="h2">Регионы</h2>
      <div class="grid regions">${s.regions.map((r) => `
        <a class="card region" href="#/r/${r.id}">
          <div class="card-img">${img("region-" + r.id, r.title)}</div>
          <div class="card-body"><div class="card-title">${esc(r.title)}</div>
          <p class="card-text">${esc(r.lead)}</p>
          <div class="tags"><span class="tag">${r.chapters.length} моделей</span></div></div></a>`).join("")}
      </div>
      <h2 class="h2">Все модели по порядку книги</h2>
      <div class="grid">${s.chapters.map(modelCard).join("")}</div>
    </div>`;
}

function renderRegion(id) {
  const r = regionById(id);
  if (!r) return go("#/");
  const chs = r.chapters.map(chapterById);
  $("#pageRegion").innerHTML = `
    <div class="wrap">
      <nav class="crumbs"><a href="#/">Главная</a> › <span>${esc(r.title)}</span></nav>
      <section class="region-head">
        <h1>${esc(r.title)}: соединения в 3D</h1>
        <p>${esc(r.lead)}</p>
        <div class="anchors">${chs.map((c, i) => `<a href="#/m/${c.id}"><span class="num">${String(i + 1).padStart(2, "0")}</span>${esc(c.title)}</a>`).join("")}</div>
      </section>
      <div class="grid">${chs.map(modelCard).join("")}</div>
      <h2 class="h2">Другие регионы</h2>
      <div class="chips">${state.section.regions.filter((x) => x.id !== id).map((x) => `<a class="chip" href="#/r/${x.id}">${esc(x.title)}</a>`).join("")}</div>
    </div>`;
}

const GROUPS = [
  ["joint", "Суставы и соединения"],
  ["bonepart", "Кости"],
  ["bone", "Части костей и ориентиры"],
  ["ligament", "Связки"],
  ["soft", "Капсулы, диски, мениски, сумки"],
];
const LEVEL = { mesh: "3D", point: "точка", bone: "кости", none: "нет на модели" };
function termLevel(t) { return t.meshes?.length ? "mesh" : t.point ? "point" : t.context?.length ? "bone" : "none"; }

function renderAbout() {
  const ch = state.chapter;
  const r = regionById(ch.region);
  const related = r.chapters.filter((id) => id !== ch.id).map(chapterById);
  const facts = ch.facts.length ? `<dl class="facts">${ch.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "";
  const text = ch.text.map((p) => `<p>${esc(p)}</p>`).join("");
  $("#tabAbout").innerHTML = `
    ${ch.lead ? `<p class="lead">${esc(ch.lead)}</p>` : `<p class="lead muted">Описание этой модели ещё не написано — список структур во вкладке «Структуры».</p>`}
    ${facts}${text}
    <p class="source">Источник: Р. Д. Синельников, «Атлас анатомии человека», ${esc(state.section.volume.toLowerCase())}, с. ${ch.pages[0]}–${ch.pages[1]}.
      3D-модель: <a href="https://www.z-anatomy.com/" target="_blank" rel="noopener">Z-Anatomy</a> (CC BY-SA 4.0).</p>
    <button class="btn primary" data-goto="parts">Структуры модели (${termsOf(ch).length}) →</button>
    ${related.length ? `<h3 class="h3">Похожие модели</h3><div class="related">${related.map((c) => `
      <a class="mini" href="#/m/${c.id}">${img(c.id, c.title)}<span>${esc(c.title)}</span></a>`).join("")}</div>` : ""}`;
  $("#tabAbout [data-goto]").onclick = () => setTab("parts");
}

function renderParts() {
  if (!state.chapter) return;
  const ch = state.chapter;
  const ids = termsOf(ch);
  const items = { bonepart: ch.bones.map((b) => ({ bone: b })) };
  for (const id of ids) (items[state.section.terms[id].kind] ||= []).push({ id });
  let html = "";
  for (const [kind, title] of GROUPS) {
    const list = items[kind];
    if (!list?.length) continue;
    html += `<h3 class="group">${title} <span class="count">${list.length}</span></h3><div class="rows">`;
    for (const it of list) {
      if (it.bone) {
        const active = state.bone === it.bone;
        html += `<button class="row${active ? " active" : ""}" data-bone="${esc(it.bone)}">
          <span class="ru">${esc(state.section.boneNames[it.bone] || it.bone)}</span></button>`;
        continue;
      }
      const t = state.section.terms[it.id];
      const active = state.term === it.id;
      const lvl = termLevel(t);
      const refs = [t.page && `с. ${t.page}`, t.figs?.length && `рис. ${t.figs.join(", ")}`].filter(Boolean).join(" · ");
      html += `<button class="row${active ? " active" : ""}${lvl === "none" ? " no3d" : ""}" data-id="${it.id}">
        <span class="ru">${esc(t.ru)}</span><span class="la">${esc(t.la)}</span>
        ${active ? `<span class="note">${t.note ? esc(t.note) : '<span class="muted">Объяснение пока не написано.</span>'}</span>
          <span class="meta"><span class="badge">${LEVEL[lvl]}</span>${t.example ? '<span class="badge">пример</span>' : ""}${refs}</span>` : ""}
      </button>`;
    }
    html += `</div>`;
  }
  const box = $("#tabParts");
  box.innerHTML = html;
  box.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => (state.term === b.dataset.id ? resetView() : selectTerm(b.dataset.id, { scroll: false }))));
  box.querySelectorAll("[data-bone]").forEach((b) => (b.onclick = () => (state.bone === b.dataset.bone ? resetView() : selectBone(b.dataset.bone))));
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("#tabAbout").classList.toggle("hidden", tab !== "about");
  $("#tabParts").classList.toggle("hidden", tab !== "parts");
  $("#tabQuiz").classList.toggle("hidden", tab !== "quiz");
  $("#hoverTip").classList.add("hidden");
  if (tab === "quiz") { hideChip(); quiz.start(); }
  else if (quiz.active) { quiz.active = false; resetView(); }
}
document.querySelectorAll(".tabs [data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

async function openModel(chId, termId) {
  const ch = chapterById(chId);
  if (!ch) return go("#/");
  await loadModel(state.section.model);
  resize();
  const same = state.chapter === ch;
  if (!same) {
    state.chapter = ch;
    state.focusIds = focusOf(ch);
    computeSolidBones(ch);
    const r = regionById(ch.region);
    document.title = `${ch.title} — Анатомия 3D`;
    $("#crumbs").innerHTML = `<a href="#/">Главная</a> › <a href="#/r/${r.id}">${esc(r.title)}</a> › <span>${esc(ch.title)}</span>`;
    $("#modelTitle").textContent = ch.title;
    $("#modelLa").textContent = ch.la;
    $("#partsCount").textContent = termsOf(ch).length;
    renderAbout();
    setTab(termId ? "parts" : "about");
    resetView();
  }
  if (termId && state.section.terms[termId] && state.term !== termId) {
    setTab("parts");
    selectTerm(termId);
  }
}

// ---------- маршруты ----------
let silentHash = null;
function setHash(h) {
  if (location.hash === h) return;
  silentHash = h;
  history.replaceState(null, "", h);
}
function go(h) { location.hash = h; }

async function route() {
  const h = location.hash || "#/";
  if (h === silentHash) { silentHash = null; return; }
  const [, kind, a, b] = h.split("/");
  const page = kind === "r" ? "pageRegion" : kind === "m" ? "pageModel" : "pageHome";
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("hidden", p.id !== page));
  document.body.classList.toggle("on-model", page === "pageModel");
  document.querySelectorAll("#nav a").forEach((x) => {
    const r = kind === "r" ? a : kind === "m" ? chapterById(a)?.region : null;
    x.classList.toggle("active", x.dataset.r === r);
  });
  closeSearch();
  if (page !== "pageModel") {
    document.title = "Анатомия 3D";
    if (page === "pageHome") renderHome(); else renderRegion(a);
    window.scrollTo(0, 0);
    return;
  }
  await openModel(a, b);
}
window.addEventListener("hashchange", route);

// ---------- поиск по всем терминам ----------
function closeSearch() { $("#searchResults").classList.add("hidden"); }
$("#search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const box = $("#searchResults");
  if (q.length < 2) return closeSearch();
  const found = Object.entries(state.section.terms)
    .filter(([, t]) => t.ru.toLowerCase().includes(q) || t.la.toLowerCase().includes(q))
    .slice(0, 30);
  box.innerHTML = found.length
    ? found.map(([id, t]) => `<a href="#/m/${chapterOfTerm.get(id).id}/${id}"><span class="ru">${esc(t.ru)}</span><span class="la">${esc(t.la)} · ${esc(chapterOfTerm.get(id).title)}</span></a>`).join("")
    : `<div class="empty">Ничего не найдено</div>`;
  box.classList.remove("hidden");
});
$("#search").addEventListener("focus", (e) => { if (e.target.value.trim().length >= 2) $("#searchResults").classList.remove("hidden"); });
document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) closeSearch(); });
$("#searchResults").addEventListener("click", (e) => { if (e.target.closest("a")) { $("#search").value = ""; closeSearch(); } });

// ---------- тест ----------
const quiz = {
  active: false,
  kind: "name",  // name — «что выделено?», find — «найди на модели»
  current: null,
  answered: false,
  score: { right: 0, total: 0 },

  // В тесте только термины, которые однозначно видны на модели: своя структура или точка
  pool() {
    return termsOf(state.chapter).filter((id) => ["mesh", "point"].includes(termLevel(state.section.terms[id])));
  },
  // «Отпечаток» того, что показывается: у терминов с одинаковой подсветкой ответы неразличимы
  signature(id) {
    const t = state.section.terms[id];
    return t.meshes?.length ? [...t.meshes].sort().join("|") : String(t.point);
  },
  start() {
    this.active = true;
    this.score = { right: 0, total: 0 };
    this.next();
  },
  next() {
    const pool = this.pool();
    const box = $("#tabQuiz");
    if (pool.length < 2) {
      box.innerHTML = `<div class="hint">В этой модели мало структур с 3D для теста.</div>`;
      return;
    }
    const findable = pool.filter((id) => state.section.terms[id].meshes?.length);
    const kind = this.kind === "find" && findable.length ? "find" : "name";
    const src = kind === "find" ? findable : pool;
    this.current = src[Math.floor(Math.random() * src.length)];
    this.answered = false;
    const t = state.section.terms[this.current];
    marker.visible = false;
    if (kind === "find") {
      paint();
      box.innerHTML = `
        <div class="q">Найди на модели:</div>
        <div class="q">${esc(t.ru)}</div><div class="hint"><i>${esc(t.la)}</i></div>
        <div class="feedback" id="qfb"></div>${this.controls()}`;
    } else {
      const ms = meshesOfTerm(t);
      const p = showMarker(t);
      const ctx = contextOfTerm(t);
      paint(ms, ctx);
      focusOn(ms.length ? ms : ctx, p);
      const sig = this.signature(this.current);
      const others = pool.filter((x) => this.signature(x) !== sig);
      const opts = shuffle([this.current, ...shuffle(others).slice(0, 3)]);
      box.innerHTML = `
        <div class="q">Что выделено?</div>
        <div class="opts">${opts.map((id) => `<button class="opt" data-id="${id}">${esc(state.section.terms[id].ru)}<br><i class="muted">${esc(state.section.terms[id].la)}</i></button>`).join("")}</div>
        <div class="feedback" id="qfb"></div>${this.controls()}`;
      box.querySelectorAll(".opt").forEach((b) => (b.onclick = () => this.answer(b.dataset.id === this.current, b)));
    }
    this.bindControls();
  },
  controls() {
    return `<div class="row-btns">
      <button class="btn ${this.kind === "name" ? "primary" : ""}" data-k="name">Что выделено?</button>
      <button class="btn ${this.kind === "find" ? "primary" : ""}" data-k="find">Найди на модели</button>
      <button class="btn" data-next>Дальше →</button></div>
      <div class="score">Верно ${this.score.right} из ${this.score.total}</div>`;
  },
  bindControls() {
    const box = $("#tabQuiz");
    box.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { this.kind = b.dataset.k; this.next(); }));
    box.querySelector("[data-next]").onclick = () => this.next();
  },
  answer(ok, btn) {
    if (this.answered) return;
    this.answered = true;
    this.score.total++;
    if (ok) this.score.right++;
    const fb = $("#qfb");
    const t = state.section.terms[this.current];
    fb.className = "feedback " + (ok ? "ok" : "bad");
    fb.innerHTML = (ok ? "Верно!" : `Нет. Правильно: ${esc(t.ru)}`) + (t.note ? `<p class="note">${esc(t.note)}</p>` : "");
    if (btn) btn.classList.add(ok ? "right" : "wrong");
    $("#tabQuiz").querySelectorAll(".opt").forEach((b) => { if (b.dataset.id === this.current) b.classList.add("right"); });
    $("#tabQuiz .score").textContent = `Верно ${this.score.right} из ${this.score.total}`;
    if (!ok) { const ms = meshesOfTerm(t); paint(ms); focusOn(ms); }
  },
  onPick(hit) {
    if (this.answered || !hit) return;
    const t = state.section.terms[this.current];
    const ok = (t.meshes || []).includes(baseName(hit.userData.fullName));
    if (!ok) paint([hit]);
    this.answer(ok);
  },
};

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- кнопки сцены ----------
function syncSpin() { document.querySelector('[data-view="spin"]').classList.toggle("active", controls.autoRotate); }
document.querySelectorAll(".view-bar [data-view]").forEach((b) => {
  b.onclick = () => {
    if (b.dataset.view === "spin") { controls.autoRotate = !controls.autoRotate; syncSpin(); return; }
    setView(b.dataset.view);
  };
});
$("#resetView").onclick = resetView;
$("#toggleBones").onclick = () => { state.bonesGhost = !state.bonesGhost; $("#toggleBones").classList.toggle("active", !state.bonesGhost); repaint(); };
$("#toggleOthers").onclick = () => { state.showOthers = !state.showOthers; $("#toggleOthers").classList.toggle("active", state.showOthers); repaint(); };
function repaint() {
  if (state.term) { const t = state.section.terms[state.term]; paint(meshesOfTerm(t), contextOfTerm(t)); }
  else if (state.bone) paint(meshesByBase.get(state.bone) || []);
  else paint();
}

// ---------- превью для карточек (tools-dev/thumbs.mjs) ----------
async function renderThumb() {
  document.body.classList.add("thumb");
  $("#pageModel").classList.remove("hidden");
  await loadModel(state.section.model);
  resize();
  const [kind, id] = THUMB.includes(":") ? THUMB.split(":") : ["chapter", THUMB];
  const chs = kind === "region" ? regionById(id).chapters.map(chapterById) : [chapterById(id)];
  state.chapter = chs[0];
  state.focusIds = uniq(chs.flatMap(focusOf));
  computeSolidBones({ bones: uniq(chs.flatMap((c) => c.bones)) });
  paint();
  camera.position.set(0, 1, 3);
  const { objs } = currentTargets();
  focusOn(objs, null, params.get("view") || (kind === "region" ? "ant" : chs[0].view), { bothSides: kind === "region" });
}

// ---------- старт ----------
(async () => {
  resize();
  camera.position.set(0, 1, 3);
  const index = await (await fetch(BASE + "data/index.json")).json();
  const secId = index.volumes[0].sections[0].id; // пока раздел один — артрология
  const data = await (await fetch(BASE + `data/${secId}.json`)).json();
  data.jointMeshes = new Set(data.structureMeshes);
  state.section = data;
  // Структура → термин; термин-пример из общих глав уступает собственному термину структуры
  for (const [tid, t] of Object.entries(data.terms)) {
    for (const n of t.meshes || []) {
      const prev = termByMesh.get(n);
      if (!prev || (data.terms[prev].example && !t.example)) termByMesh.set(n, tid);
    }
  }
  for (const ch of data.chapters) for (const tid of ch.terms) if (!chapterOfTerm.has(tid)) chapterOfTerm.set(tid, ch);
  if (THUMB) return renderThumb();
  renderNav();
  route();
})();
