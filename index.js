// Transition Stamper
//
// Rule: transitions go only at the EDGES of blocks on the main footage track:
//   IN  = where a block of contiguous clips starts
//   OUT = where it ends
// Inner cuts inside a block get nothing.
// A transition is a GROUP of clips (adjustment layer(s) on the transition tracks, plus an SFX lane clip) around the edge.
// To stamp a new edge we clone the whole template group, shifted by (newEdge - templateEdge),
// so the hit point is wherever the editor placed it in the template. No anchor/offset constants.
// If a group's lanes are taken, video shifts up to the first free tracks, SFX slides down.
// Track numbers are the editor's own choice: nothing is baked in, the panel asks for them.

const ppro = require("premierepro");
const $ = (id) => document.getElementById(id);
const num = (id) => Number($(id).value);

const DEV_DIR = "file:D:/Codes/premiere-stamper"; // dev mode only: log.txt + cmd.json live here
const CLIP = (ppro.Constants && ppro.Constants.TrackItemType && (ppro.Constants.TrackItemType.CLIP ?? ppro.Constants.TrackItemType.Clip)) ?? 1;
const TICKS_PER_SEC = 254016000000;
const SETTING_IDS = ["cutTrack", "tplTrack", "sfxTrack", "gapTol"];
const BUTTONS = ["scan", "preview", "stamp", "confirmStamp", "setupDone"];

// UXP's classList may not support toggle(name, force): use explicit add/remove
function setClass(el, name, on) {
  if (!el || !el.classList) return;
  if (on) el.classList.add(name); else el.classList.remove(name);
}

// show any script error in the panel itself, so a broken load is never silent
const showFatal = (m) => { try { $("summary").textContent = "Script error: " + m; } catch (e) {} };
try { window.addEventListener("error", (ev) => showFatal(ev && ev.message ? ev.message : String(ev))); } catch (e) {}
try { window.addEventListener("unhandledrejection", (ev) => showFatal(String(ev && ev.reason))); } catch (e) {}

// UXP can leave stale pixels / stale click areas after show/hide changes until the window is resized.
// Reading a layout property and nudging the body padding by 1px after every change forces a fresh layout.
function relayout() {
  try {
    const b = document.body;
    void b.offsetHeight;
    b.style.paddingBottom = b.style.paddingBottom === "11px" ? "10px" : "11px";
  } catch (e) {}
  fitScroller();
}

// The scrolling box is sized by CSS (a flex column that fills the panel). All JS does is switch scrolling
// on only when the content really overflows, and go back to the top when it fits.
// Do NOT size it from document.documentElement.clientHeight: in UXP that is max(viewport, content),
// so setting the height from it feeds back on itself and the box grows without limit.
function fitScroller() {
  try {
    const s = $("scroller");
    if (s.style.height) s.style.height = ""; // clear any fixed height
    const needs = s.scrollHeight > s.clientHeight + 1;
    const want = needs ? "auto" : "hidden";
    if (s.style.overflowY !== want) s.style.overflowY = want;
    if (!needs && s.scrollTop !== 0) s.scrollTop = 0;
    const pad = needs ? "6px" : "0px";
    if (s.style.paddingRight !== pad) s.style.paddingRight = pad;
  } catch (e) {}
}
// UXP may not fire a resize event when a panel is dragged, so re-check a few times a second
try { window.addEventListener("resize", fitScroller); } catch (e) {}
setInterval(fitScroller, 400);

// ---------- tabs ----------
let activeTab = "stamp";
function showTab(name) {
  activeTab = name;
  for (const t of ["stamp", "setup", "about", "dev"]) {
    const cap = t[0].toUpperCase() + t.slice(1);
    setClass($("p" + cap), "active", t === name);
    setClass($("tab" + cap), "active", t === name);
  }
  relayout();
}
function updateSetupNote() {
  const miss = missingSettings();
  $("setupNote").textContent = miss.length ? `Fill in your ${miss.join(", ")}, then tap Done.` : "";
}
function updateTrackSummary() {
  const c = num("cutTrack"), t = num("tplTrack"), s = num("sfxTrack");
  $("trackSummary").textContent = (c >= 1 && t >= 1 && s >= 1)
    ? `Footage V${c} · Transitions V${t}+ · Whoosh A${s}`
    : "Tracks not set yet";
  applySetupState();
}

// Until the three tracks are filled in, the IN/OUT dropdowns would be empty and dead.
// Swap them for a clear card with a button to Setup, and gray out Stamp.
function applySetupState() {
  const missing = missingSettings().length > 0;
  $("needSetup").style.display = missing ? "block" : "none";
  $("tplCard").style.display = missing ? "none" : "block";
  if (!busy) setClass($("stamp"), "off", missing);
  setClass($("swap"), "off", missing);
  relayout();
}

// ---------- logging (dev log textarea + log.txt) ----------
const logEl = $("log");
logEl.value = "";
const safe = (x) => { try { return JSON.stringify(x); } catch (e) { return String(x); } };
function log(...a) {
  const line = a.map((x) => (typeof x === "string" ? x : safe(x))).join(" ");
  logEl.value += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
  console.log(line);
}
async function writeDevFile(name, text) {
  try {
    const fs = require("uxp").storage.localFileSystem;
    const folder = await fs.getEntryWithUrl(DEV_DIR);
    const file = await folder.createFile(name, { overwrite: true });
    await file.write(text);
  } catch (e) { console.log("writeDevFile failed", name, String(e)); }
}
const saveLog = () => writeDevFile("log.txt", logEl.value);

// ---------- preferences (all optional, per project) ----------
const getPref = (k) => { try { return localStorage.getItem("stamper." + k); } catch (e) { return null; } };
const setPref = (k, v) => { try { localStorage.setItem("stamper." + k, v); } catch (e) {} };
let currentKey = null;
const projectKey = (project) => String(project.path || project.name || "default");

function loadProjectPrefs(key) {
  if (key === currentKey) return;
  currentKey = key;
  if ($("rememberSettings").checked) {
    try {
      const o = JSON.parse(getPref("settings." + key) || "null");
      if (o) for (const id of SETTING_IDS) if (o[id] != null) $(id).value = o[id];
    } catch (e) {}
  }
}
function saveSettings() {
  if (!$("rememberSettings").checked || !currentKey) return;
  setPref("settings." + currentKey, JSON.stringify(Object.fromEntries(SETTING_IDS.map((id) => [id, $(id).value]))));
}
// remembered picks are stored by the transition's "style" signature, not by a position on the timeline
const styleOf = (selId) => (LAST && LAST.styles ? LAST.styles.find((s) => String(s.rep.idx) === $(selId).value) : null);
function saveTemplatePicks() {
  if (!$("rememberTemplates").checked || !currentKey) return;
  const a = styleOf("tplIn"), b = styleOf("tplOut");
  setPref("tpl." + currentKey, JSON.stringify({ IN: a ? a.sig : "", OUT: b ? b.sig : "" }));
}

// ---------- helpers ----------
let FPS = 30, FPS_SRC = "assumed 30";
// TPF = ticks per frame, a whole number. All timeline arithmetic that ends up in Premiere is done in TICKS as
// BigInt (exact integers), never in decimal seconds, so there is no rounding to drift a clip by a frame.
let TPF = 8467200000n;
async function initFps(sequence) {
  try {
    const fr = await (await sequence.getSettings()).getVideoFrameRate();
    if (fr && fr.value > 0) { FPS = fr.value; FPS_SRC = "sequence settings"; }
  } catch (e) {}
  try {
    const tb = BigInt(await sequence.getTimebase()); // ticks per frame, as a string
    if (tb > 0n) { TPF = tb; if (FPS_SRC.startsWith("assumed")) { FPS = TICKS_PER_SEC / Number(tb); FPS_SRC = "timebase"; } return; }
  } catch (e) {}
  TPF = BigInt(Math.round(TICKS_PER_SEC / FPS));
}
// exact time in ticks (BigInt) from a TickTime
function tk(t) {
  try { if (t && t.ticks != null) return BigInt(t.ticks); } catch (e) {}
  return BigInt(Math.round(secs(t) * TICKS_PER_SEC));
}
const tkSecs = (b) => Number(b) / TICKS_PER_SEC;
const tkFrames = (b) => Number(b) / Number(TPF); // may be fractional
const roundToFrame = (b) => { const h = TPF / 2n; return (b >= 0n ? (b + h) / TPF : -((-b + h) / TPF)) * TPF; };
function tc(sec) { // HH:MM:SS:FF (non-drop-frame display)
  const nominal = Math.round(FPS), total = Math.round(sec * FPS);
  const s = Math.floor(total / nominal), p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}:${p(total % nominal)}`;
}
const frames = (sec) => Math.round(sec * FPS); // seconds -> whole frames at the sequence frame rate
function secs(t) {
  if (t == null) return NaN;
  if (typeof t.seconds === "number") return t.seconds;
  if (typeof t.ticks !== "undefined") return Number(t.ticks) / TICKS_PER_SEC;
  return NaN;
}
async function getCtx() {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("No active project");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active sequence. Open a timeline first.");
  await initFps(sequence);
  loadProjectPrefs(projectKey(project));
  return { project, sequence };
}
async function videoClips(sequence, vNum) {
  return await (await sequence.getVideoTrack(vNum - 1)).getTrackItems(CLIP, false);
}
async function audioClips(sequence, aNum) {
  return await (await sequence.getAudioTrack(aNum - 1)).getTrackItems(CLIP, false);
}
async function countTracks(sequence, kind) {
  let n = 0;
  while (n < 60) {
    try {
      const t = kind === "video" ? await sequence.getVideoTrack(n) : await sequence.getAudioTrack(n);
      if (!t) break;
      n++;
    } catch (e) { break; }
  }
  return n;
}
const laneNum = (kind) => parseInt(kind.slice(1), 10);

// every lane a stamped clone can land on: video from the transition track up, audio from the SFX lane down
async function countLaneClips(sequence, maxV, maxA) {
  let n = 0;
  for (let v = num("tplTrack"); v <= maxV; v++) n += (await videoClips(sequence, v)).length;
  for (let a = num("sfxTrack"); a <= maxA; a++) n += (await audioClips(sequence, a)).length;
  return n;
}

// ---------- analysis ----------
async function analyzeEdges(sequence) {
  const cutTrack = num("cutTrack"), vTpl = num("tplTrack"), aTrack = num("sfxTrack");
  const gap = num("gapTol") >= 0 ? num("gapTol") : 0.1; // text field: junk or empty falls back to 0.1s
  const maxV = await countTracks(sequence, "video");
  const maxA = await countTracks(sequence, "audio");
  const base = { edges: [], pieces: [], blocks: [], audioOcc: {}, maxV, maxA };
  if (cutTrack > maxV || vTpl > maxV || aTrack > maxA) return base; // reported by checkSetup

  const spans = []; // [start s, end s, start ticks, end ticks]
  for (const c of await videoClips(sequence, cutTrack)) {
    const st = await c.getStartTime(), en = await c.getEndTime();
    spans.push([secs(st), secs(en), tk(st), tk(en)]);
  }
  spans.sort((a, b) => a[0] - b[0]);

  const blocks = [];
  for (const [s, e, sk, ek] of spans) {
    const b = blocks[blocks.length - 1];
    if (b && s - b.e <= gap) { if (e > b.e) { b.e = e; b.ek = ek; } }
    else blocks.push({ s, e, sk, ek });
  }
  const edges = [];
  for (const b of blocks) { edges.push({ t: b.s, tk: b.sk, type: "IN" }); edges.push({ t: b.e, tk: b.ek, type: "OUT" }); }
  edges.sort((a, b) => a.t - b.t);
  edges.forEach((e, i) => (e.idx = i + 1));

  // transition pieces: every video track from the transition track up + the SFX lane
  const pieces = [];
  for (let vn = vTpl; vn <= maxV; vn++) {
    for (const it of await videoClips(sequence, vn)) {
      const st = await it.getStartTime(), en = await it.getEndTime();
      pieces.push({ item: it, kind: "V" + vn, s: secs(st), e: secs(en), sk: tk(st), ek: tk(en) });
    }
  }
  for (const it of await audioClips(sequence, aTrack)) {
    const st = await it.getStartTime(), en = await it.getEndTime();
    pieces.push({ item: it, kind: "A" + aTrack, s: secs(st), e: secs(en), sk: tk(st), ek: tk(en) });
  }
  // lanes below the SFX lane: occupancy only (for sliding an SFX down)
  const audioOcc = {};
  for (let an = aTrack + 1; an <= maxA; an++) {
    audioOcc["A" + an] = [];
    for (const it of await audioClips(sequence, an)) audioOcc["A" + an].push([secs(await it.getStartTime()), secs(await it.getEndTime())]);
  }
  // Which pieces belong to which edge's transition?
  //  1. a piece belongs to the ONE edge it touches that is closest to its middle (so a transition overlapping its neighbor
  //     isn't claimed by both). Video gets ~3 frames of slack because the editor places the centre by eye;
  //     whooshes can be as short as 0.23s, so audio keeps a tight tolerance.
  //  2. transitions built from several clips on one track (e.g. two halves that meet at the cut, where the split IS the
  //     centre) pull in any clip that touches a clip already in the group, so no half is left behind.
  for (const ed of edges) ed.group = [];
  for (const p of pieces) {
    const tol = p.kind[0] === "V" ? 0.1 : 0.02;
    const mid = (p.s + p.e) / 2;
    let owner = null, best = Infinity;
    for (const ed of edges) {
      if (p.s <= ed.t + tol && p.e >= ed.t - tol) {
        const d = Math.abs(mid - ed.t);
        if (d < best) { best = d; owner = ed; }
      }
    }
    if (owner) owner.group.push(p);
  }
  const ADJ = 0.04; // clips this close end-to-start count as touching (just over a frame)
  const owned = new Set();
  for (const ed of edges) ed.group.forEach((p) => owned.add(p));
  for (const ed of edges) {
    let grew = ed.group.length > 0;
    while (grew) {
      grew = false;
      for (const q of pieces) {
        if (q.kind[0] !== "V" || owned.has(q)) continue; // never steal a clip another edge already owns
        if (ed.group.some((p) => p.kind === q.kind && (Math.abs(q.s - p.e) <= ADJ || Math.abs(p.s - q.e) <= ADJ))) { ed.group.push(q); owned.add(q); grew = true; }
      }
    }
  }
  return { edges, pieces, blocks, audioOcc, maxV, maxA };
}

// "V7 split" = two clips on V7 that meet end-to-start (the two halves of a split transition);
// "V7 (3 clips)" = several clips that don't touch; a plain "V7" = one clip.
const groupLabel = (g) => {
  const byKind = {};
  for (const p of g) (byKind[p.kind] = byKind[p.kind] || []).push(p);
  return Object.entries(byKind).map(([k, arr]) => {
    if (arr.length < 2) return k;
    arr.sort((x, y) => x.s - y.s);
    const touching = arr.every((p, i) => i === 0 || Math.abs(p.s - arr[i - 1].e) <= 0.04);
    return touching ? `${k} split` : `${k} (${arr.length} clips)`;
  }).join(" + ");
};

// ---------- setup feedback ----------
function missingSettings() {
  const m = [];
  if (!(num("cutTrack") >= 1)) m.push("main footage track");
  if (!(num("tplTrack") >= 1)) m.push("transition track");
  if (!(num("sfxTrack") >= 1)) m.push("whoosh SFX track");
  return m;
}
function checkSetup(A, tIn, tOut) {
  const cut = num("cutTrack"), tpl = num("tplTrack"), sfx = num("sfxTrack");
  const errors = [], warnings = [];
  if (cut > A.maxV) errors.push(`Main footage track V${cut} doesn't exist (this sequence has ${A.maxV} video tracks).`);
  if (tpl > A.maxV) errors.push(`Transition track V${tpl} doesn't exist (this sequence has ${A.maxV} video tracks). Add empty video tracks first.`);
  if (sfx > A.maxA) errors.push(`SFX track A${sfx} doesn't exist (this sequence has ${A.maxA} audio tracks).`);
  if (!errors.length && !A.blocks.length) errors.push(`Main footage track V${cut} has no clips.`);
  if (!errors.length) {
    if (tpl <= cut) warnings.push(`Transition track V${tpl} is not above main footage V${cut}. An adjustment layer only affects the tracks below it.`);
    // Room above the templates only matters if two transitions overlap: the second one is lifted above the first.
    // That needs as many free tracks as the bigger template has video layers (1 layer: 1 track, 2 layers: 2 tracks).
    const tpls = [tIn, tOut].filter(Boolean);
    const vLanes = (t) => new Set(t.group.filter((p) => p.kind[0] === "V").map((p) => p.kind));
    const used = tpls.flatMap((t) => [...vLanes(t)]).map(laneNum);
    if (used.length) {
      const free = A.maxV - Math.max(...used);
      const need = Math.max(...tpls.map((t) => vLanes(t).size));
      if (free < need) {
        const add = need - free;
        warnings.push(`No spare video track above your transitions. If two transitions overlap, the second has nowhere to go and gets skipped. Add ${add} empty video track${add > 1 ? "s" : ""} at the top (right-click the track names, then Add Tracks).`);
      }
    }
    const sfxClips = A.pieces.filter((p) => p.kind === "A" + sfx).length;
    if (A.edges.length && sfxClips > A.edges.length * 1.5) warnings.push(`SFX track A${sfx} already holds ${sfxClips} clips, more than the ${A.edges.length} edges. If it carries other audio, pick an empty track.`);
  }
  if (FPS_SRC.startsWith("assumed")) warnings.push("Couldn't read the sequence frame rate; timecodes assume 30 fps.");
  return { errors, warnings };
}
function showWarnings(list) { $("warnings").textContent = list.length ? list.map((w) => "Heads up: " + w).join("\n") : ""; }

// "Show details" is collapsed by default so the result area stays short
function setDetails(text) {
  $("details").textContent = text;
  $("details").style.display = "none";
  $("detailsToggle").textContent = "Show details";
  $("detailsToggle").style.display = text ? "block" : "none";
}
function clearResults() {
  $("summary").textContent = "";
  showWarnings([]);
  setDetails("");
  $("confirmBox").style.display = "none";
  $("tplIn").innerHTML = "";
  $("tplOut").innerHTML = "";
}

// ---------- UI: scan ----------
// A real transition has at least one VIDEO layer (an adjustment layer). A lone whoosh is not a transition.
const hasVideo = (e) => e.group.some((p) => p.kind[0] === "V");

// Group the transitions on the timeline into distinct STYLES, so the dropdowns list each look once
// instead of every stamped copy. Same shape (tracks, timing around the edge) AND same effects = same style.
async function buildStyles(A) {
  const map = new Map();
  for (const e of A.edges) {
    if (!hasVideo(e)) continue;
    const parts = [], effects = [];
    for (const p of e.group) {
      parts.push(`${p.kind}:${Math.round((p.s - e.t) * 30)}:${Math.round((p.e - p.s) * 30)}`);
      if (p.kind[0] === "V") {
        try {
          const chain = await p.item.getComponentChain();
          const n = chain.getComponentCount();
          for (let i = 0; i < n; i++) effects.push(String(await chain.getComponentAtIndex(i).getDisplayName()));
        } catch (err) {}
      }
    }
    parts.sort();
    const sig = parts.join("|") + "#" + effects.join(",");
    let s = map.get(sig);
    if (!s) {
      const shown = [...new Set(effects.filter((n) => !/^(Opacity|Motion|Time Remapping)$/.test(n)))].slice(0, 2);
      s = { sig, rep: e, members: [], n: 0, nIn: 0, nOut: 0, label: `${groupLabel(e.group)} · ${shown.join(", ") || "no effects"}` };
      map.set(sig, s);
    }
    s.n++;
    s.members.push(e);
    if (e.type === "IN") s.nIn++; else s.nOut++;
  }
  const styles = [...map.values()];
  styles.forEach((s) => { s.label += s.n > 1 ? `  ×${s.n}` : ""; });
  return styles;
}

// ---------- finding the CENTER of a transition ----------
// Rules (agreed with the editor):
//  1. SPLIT ("type B"): two clips on a transition track that meet end-to-start. The meeting point is the center.
//     (Only the transition tracks are looked at, never the footage lane.)
//  2. otherwise the PEAK KEYFRAME ("type A": one keyframe in, center, out): the keyframe time shared by the most
//     animated effects, put on the sequence with  clip start + (keyframe time - clip in-point),
//     then rounded to a whole frame (Premiere places clips on whole frames). The leftover is kept as residualF.
//  3. otherwise: not found. (The panel then tells the editor to cut the transition in two at its center.)
// With a split AND keyframes, the two must agree within 1 frame, otherwise there is a warning.
// The whoosh can't be detected; it is copied at the same offset from the video center.
async function detectCenter(edge) {
  const info = { method: "none", t: null, offsetF: null, residualF: 0, warnings: [] };
  const vs = edge.group.filter((p) => p.kind[0] === "V");

  // peak keyframe, in sequence seconds
  let peak = null;
  try {
    const counts = new Map();
    for (const p of vs) {
      let ip = null;
      try { ip = secs(await p.item.getInPoint()); } catch (e) {}
      if (ip == null || isNaN(ip)) continue;
      const chain = await p.item.getComponentChain();
      const n = chain.getComponentCount();
      for (let i = 0; i < n; i++) {
        const comp = chain.getComponentAtIndex(i);
        const pc = comp.getParamCount();
        for (let k = 0; k < pc; k++) {
          const param = comp.getParam(k);
          let times = [];
          try { if (param.isTimeVarying && param.isTimeVarying()) times = param.getKeyframeListAsTickTimes(); } catch (e) {}
          if (!times.length) continue;
          new Set(times.map((t) => Math.round((p.s + (secs(t) - ip)) * 1000))).forEach((m) => counts.set(m, (counts.get(m) || 0) + 1));
        }
      }
    }
    let best = null;
    for (const [m, c] of counts) {
      if (!best || c > best.c || (c === best.c && Math.abs(m / 1000 - edge.t) < Math.abs(best.m / 1000 - edge.t))) best = { m, c };
    }
    if (best) peak = best.m / 1000;
  } catch (e) { info.warnings.push("could not read the keyframes"); }

  // split points: clips on the same transition track that touch
  const byTrack = {};
  for (const p of vs) (byTrack[p.kind] = byTrack[p.kind] || []).push(p);
  const joints = [];
  for (const arr of Object.values(byTrack)) {
    arr.sort((a, b) => a.s - b.s);
    for (let i = 0; i + 1 < arr.length; i++) if (Math.abs(arr[i + 1].s - arr[i].e) <= 0.04) joints.push({ t: arr[i].e, k: arr[i].ek });
  }

  if (joints.length) {
    joints.sort((a, b) => a.t - b.t);
    const mid = joints[Math.floor(joints.length / 2)];
    if (joints.some((j) => Math.abs(j.t - mid.t) > 1 / FPS)) info.warnings.push("the clips on different tracks don't split on the same frame");
    info.method = "split"; info.t = mid.t; info.tk = mid.k; // the split is a clip boundary: an exact tick value
    if (peak != null) {
      const d = (peak - mid.t) * FPS;
      info.residualF = d;
      if (Math.abs(d) > 1) info.warnings.push(`the split and the keyframes disagree by ${d.toFixed(1)} frames`);
    }
  } else if (peak != null) {
    const pf = peak * FPS;
    info.method = "keyframe";
    info.tk = roundToFrame(BigInt(Math.round(peak * TICKS_PER_SEC))); // nearest whole frame, as exact ticks
    info.t = tkSecs(info.tk);
    info.residualF = pf - Math.round(pf);
  } else {
    info.warnings.push("center not found");
  }
  if (info.tk != null && edge.tk != null) info.offsetF = Math.round(tkFrames(info.tk - edge.tk));
  return info;
}

// ---------- ALIGNMENT AUDIT ----------
// Measures instead of trusting. For every transition on the timeline:
//   - where is its detected center relative to its own cut (should be 0 frames)?
//   - is every clip of it (video halves, whoosh) at EXACTLY the same offset from its center, in ticks, as the
//     template of its style? (A stamped copy is a clone shifted by a whole number of frames, so the answer must be 0 ticks.)
// The track a clip is on is ignored (a copy lifted to a free track is still a correct copy).
async function auditTransitions(styles) {
  const out = { total: 0, exact: 0, notFound: [], off: [], worstTicks: 0n, worstCenterF: 0 };
  const vec = (e, c) => e.group
    .map((p) => [p.kind[0], p.sk - c.tk, p.ek - c.tk])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)));
  const absB = (x) => (x < 0n ? -x : x);
  for (const s of styles) {
    const cRep = await detectCenter(s.rep);
    const vRep = cRep.tk != null ? vec(s.rep, cRep) : null;
    for (const e of s.members) {
      out.total++;
      const c = e === s.rep ? cRep : await detectCenter(e);
      if (c.tk == null || !vRep) { out.notFound.push(`${tc(e.t)} (${e.type})`); continue; }
      const centerF = Math.round(tkFrames(c.tk - e.tk));
      const v = vec(e, c);
      let dev = 0n, same = v.length === vRep.length;
      if (same) {
        for (let i = 0; i < v.length; i++) {
          if (v[i][0] !== vRep[i][0]) { same = false; break; }
          const d1 = absB(v[i][1] - vRep[i][1]), d2 = absB(v[i][2] - vRep[i][2]);
          if (d1 > dev) dev = d1;
          if (d2 > dev) dev = d2;
        }
      }
      if (dev > out.worstTicks) out.worstTicks = dev;
      if (Math.abs(centerF) > Math.abs(out.worstCenterF)) out.worstCenterF = centerF;
      if (same && dev === 0n && centerF === 0) out.exact++;
      else out.off.push(`${tc(e.t)} (${e.type}): center ${relWords(centerF)}${same ? "" : ", different shape from its template"}${dev > 0n ? `, clips off by up to ${dev} ticks (${tkFrames(dev).toFixed(3)} frames)` : ""}`);
    }
  }
  return out;
}
function auditLines(a) {
  const lines = [`Alignment audit: ${a.exact} of ${a.total} transitions are exactly centered on their cut and identical to their template, to the tick.`];
  if (a.off.length) lines.push(`${a.off.length} differ:`, ...a.off.slice(0, 8).map((x) => "  " + x), ...(a.off.length > 8 ? [`  ...and ${a.off.length - 8} more`] : []));
  if (a.notFound.length) lines.push(`${a.notFound.length} could not be checked (center not found): ${a.notFound.slice(0, 6).join(", ")}`);
  return lines;
}
async function auditNow() {
  const { sequence } = await getCtx();
  if (missingSettings().length) throw new Error("Fill in your tracks first.");
  const A = await analyzeEdges(sequence);
  const styles = await buildStyles(A);
  const a = await auditTransitions(styles);
  auditLines(a).forEach((l) => log(l));
  log(`worst clip deviation from a template: ${a.worstTicks} ticks | worst center offset from a cut: ${a.worstCenterF} frames | ticks per frame ${TPF}`);
  return a;
}

const relWords = (n) => (n === 0 ? "exactly on the cut" : `${Math.abs(n)} frame${Math.abs(n) === 1 ? "" : "s"} ${n < 0 ? "before" : "after"} the cut`);
function centerLine(label, s) {
  if (!s || !s.center) return "";
  const c = s.center;
  if (c.method === "split") return `${label}: center found at the split, ${relWords(c.offsetF)}.`;
  if (c.method === "keyframe") return `${label}: center found from the keyframes, ${relWords(c.offsetF)}.`;
  return `${label}: center not found. Cut the transition in two at its center with the razor, then refresh.`;
}
function updateCenterInfo() {
  const lines = [centerLine("IN", styleOf("tplIn")), centerLine("OUT", styleOf("tplOut"))];
  const seen = new Set();
  for (const id of ["tplIn", "tplOut"]) {
    const st = styleOf(id);
    if (st && st.center) for (const w of st.center.warnings) if (w !== "center not found" && !seen.has(w)) { seen.add(w); lines.push("Heads up: " + w + "."); }
  }
  if ($("centerOnCut") && !$("centerOnCut").checked) lines.push("Center alignment is off: copies are exact copies of the template.");
  $("centerInfo").textContent = lines.filter(Boolean).join("\n");
}

function fillSelect(selId, styles, role) {
  const sel = $(selId), prev = sel.value;
  sel.innerHTML = "";
  // BOTH dropdowns list the same styles, so the Swap button can exchange the two picks.
  for (const s of styles) {
    const o = document.createElement("option");
    o.value = String(s.rep.idx);
    o.textContent = s.label;
    sel.appendChild(o);
  }
  if (!sel.options.length) { const o = document.createElement("option"); o.value = "0"; o.textContent = "none found: build one by hand first"; sel.appendChild(o); }
  const prevValid = prev !== "0" && [...sel.options].some((o) => o.value === prev);
  if (prevValid) { sel.value = prev; return; }
  // default pick follows the role: the style used most at block starts for IN, at block ends for OUT
  const best = [...styles].sort((a, b) => (role === "IN" ? b.nIn - a.nIn : b.nOut - a.nOut))[0];
  if (best && (role === "IN" ? best.nIn : best.nOut) > 0) sel.value = String(best.rep.idx);
}

// Set a dropdown's pick. Setting selectedIndex as well as value makes UXP actually repaint the select.
function setPick(selId, value) {
  const sel = $(selId);
  const i = [...sel.options].findIndex((o) => o.value === value);
  if (i < 0) return;
  try { sel.selectedIndex = i; } catch (e) {}
  sel.value = value;
}
// The style each role would get by default (used most at block starts for IN, at block ends for OUT)
function defaultPick(role) {
  const st = LAST && LAST.styles ? LAST.styles : [];
  const best = [...st].sort((a, b) => (role === "IN" ? b.nIn - a.nIn : b.nOut - a.nOut))[0];
  return best ? String(best.rep.idx) : null;
}
// A persistent indicator: when the two picks are the exchanged versions of the defaults, both labels say "swapped".
function updateSwapTag() {
  const dIn = defaultPick("IN"), dOut = defaultPick("OUT");
  const swapped = !!(dIn && dOut && dIn !== dOut && $("tplIn").value === dOut && $("tplOut").value === dIn);
  $("inLbl").textContent = "IN (start of a block)" + (swapped ? "     ⇄ swapped" : "");
  $("outLbl").textContent = "OUT (end of a block)" + (swapped ? "     ⇄ swapped" : "");
  return swapped;
}

// Swap the two picks. The timeline and the dropdown lists don't change, only which transition plays which role.
function swapPicks() {
  if (missingSettings().length) return;
  const a = $("tplIn").value, b = $("tplOut").value;
  setPick("tplIn", b);
  setPick("tplOut", a);
  hideConfirm();
  saveTemplatePicks();
  const swapped = updateSwapTag();
  updateCenterInfo();
  $("summary").textContent = swapped
    ? "Swapped. Your IN pick is now used at block ends, and your OUT pick at block starts. Nothing on the timeline changed."
    : "Swapped back to the normal order. Nothing on the timeline changed.";
  showWarnings([]);
  setDetails("");
  relayout();
}
function restoreTemplatePicks() {
  if (!$("rememberTemplates").checked || !currentKey) return;
  try {
    const saved = JSON.parse(getPref("tpl." + currentKey) || "null");
    if (!saved) return;
    for (const [selId, type] of [["tplIn", "IN"], ["tplOut", "OUT"]]) {
      const s = LAST && LAST.styles ? LAST.styles.find((x) => x.sig === saved[type]) : null;
      if (s) $(selId).value = String(s.rep.idx);
    }
  } catch (e) {}
}

let LAST = null; // last analysis
async function scan(opts = {}) {
  const { sequence } = await getCtx();
  $("confirmBox").style.display = "none";
  updateTrackSummary();
  updateSetupNote();
  const miss = missingSettings();
  if (miss.length) {
    $("summary").textContent = "";
    showWarnings([]); setDetails("");
    showTab("setup");
    return;
  }
  // keep the editor's picks (by style, so a swap survives) across the rescan
  const keepSig = { tplIn: (styleOf("tplIn") || {}).sig, tplOut: (styleOf("tplOut") || {}).sig };
  LAST = await analyzeEdges(sequence);
  const chk = checkSetup(LAST, null, null);
  if (chk.errors.length) {
    $("summary").textContent = "Problem: " + chk.errors.join(" ");
    showWarnings(chk.warnings); setDetails("");
    return;
  }
  const { edges, blocks } = LAST;
  const withV = edges.filter(hasVideo);
  LAST.styles = await buildStyles(LAST);
  for (const st of LAST.styles) st.center = await detectCenter(st.rep);
  fillSelect("tplIn", LAST.styles, "IN");
  fillSelect("tplOut", LAST.styles, "OUT");
  for (const id of ["tplIn", "tplOut"]) {
    const s = keepSig[id] ? LAST.styles.find((x) => x.sig === keepSig[id]) : null;
    if (s) setPick(id, String(s.rep.idx));
  }
  restoreTemplatePicks();
  updateSwapTag();
  updateCenterInfo();
  const nIn = edges.filter((e) => e.type === "IN").length;
  const loneWhooshes = edges.filter((e) => e.group.length && !hasVideo(e)).length;
  $("summary").textContent = `Found ${blocks.length} blocks on V${num("cutTrack")}: ${nIn} IN + ${edges.length - nIn} OUT edges. ${withV.length} already have a transition (${LAST.styles.length} style${LAST.styles.length === 1 ? "" : "s"}).`;
  const w = [...chk.warnings];
  if (loneWhooshes) w.push(`${loneWhooshes} edge${loneWhooshes === 1 ? " has" : "s have"} a whoosh on A${num("sfxTrack")} but no adjustment layer. They don't count as transitions.`);
  showWarnings(w);
  setDetails("");
  if (!opts.quiet) for (const st of LAST.styles) log(`center | ${st.label} | method ${st.center.method}, ${st.center.offsetF == null ? "n/a" : st.center.offsetF + "f from the cut"}, sub-frame residual ${st.center.residualF.toFixed(2)}f${st.center.warnings.length ? " | " + st.center.warnings.join("; ") : ""}`);
  if (!opts.quiet) log(`scan: ${blocks.length} blocks, ${edges.length} edges, ${withV.length} with transitions (${LAST.styles.length} styles), ${loneWhooshes} whoosh-only | tracks ${LAST.maxV}V/${LAST.maxA}A | fps ${FPS.toFixed(3)} (${FPS_SRC})`);
}

// ---------- stamping ----------
async function stampEdges(dry) {
  const { project, sequence } = await getCtx();
  const miss = missingSettings();
  if (miss.length) throw new Error(`Fill in your ${miss.join(", ")} first.`);
  const A = await analyzeEdges(sequence);
  const { edges, pieces, audioOcc, maxV, maxA } = A;
  // Templates are found by their STYLE on the live timeline, not by a remembered edge number: after a stamp and a
  // Ctrl+Z the edge a dropdown pointed at may be empty again, but the style (and its original) is still there.
  const stylesNow = await buildStyles(A);
  const tplFor = (selId) => {
    const picked = styleOf(selId);
    if (!picked) return null;
    const live = stylesNow.find((x) => x.sig === picked.sig);
    if (!live) throw new Error("The transition you picked is no longer on the timeline. Tap the refresh icon and pick again.");
    return live.rep;
  };
  const tIn = tplFor("tplIn");
  const tOut = tplFor("tplOut");
  const chk = checkSetup(A, tIn, tOut);
  if (chk.errors.length) throw new Error(chk.errors.join(" "));
  const res = { dry, totalEdges: edges.length, planned: 0, nIn: 0, nOut: 0, hasTransition: 0, beforeZero: 0, noLane: 0, noTemplate: 0, stacked: [], skipped: [], warnings: chk.warnings, ok: null, added: null, expected: null };
  if (!tIn && !tOut) throw new Error("No template transitions found. Build one IN and one OUT by hand, then tap Refresh.");
  log(`${dry ? "preview" : "STAMP"} | IN template @${tIn ? tc(tIn.t) : "none"} | OUT template @${tOut ? tc(tOut.t) : "none"} | tracks ${maxV}V/${maxA}A | fps ${FPS.toFixed(3)} (${FPS_SRC})`);
  res.warnings.forEach((w) => log("  warning:", w));

  // Where on the template do we measure from? With "center on the cut" ON (default) it is the template's detected CENTER,
  // so every copy gets its center on its own cut even if the template was a little off. If no center can be found
  // (or the option is off) it is the template's own cut, i.e. an exact copy. All of this is in exact ticks.
  const centerOn = $("centerOnCut").checked;
  const anchors = new Map(); // template edge -> { tk, how }
  res.centerNotes = [];
  for (const [label, tpl] of [["IN", tIn], ["OUT", tOut]]) {
    if (!tpl) continue;
    const c = await detectCenter(tpl);
    let how = "exact copy of the template";
    let anchorTk = tpl.tk;
    if (centerOn && c.tk != null) {
      anchorTk = c.tk;
      how = `center (${c.method === "split" ? "split" : "keyframes"})`;
      if (c.offsetF !== 0) res.centerNotes.push(`${label} template: its center is ${relWords(c.offsetF)}. Copies are centered on their own cuts.`);
    } else if (centerOn) {
      res.centerNotes.push(`${label} template: center not found, so copies are exact copies of it. (Cut the transition in two at its center to fix that.)`);
    } else if (c.tk != null && c.offsetF !== 0) {
      res.centerNotes.push(`${label} template: its center is ${relWords(c.offsetF)}, and copies carry the same offset (center alignment is off).`);
    }
    c.warnings.filter((w) => w !== "center not found").forEach((w) => res.centerNotes.push(`${label} template: ${w}.`));
    anchors.set(tpl, { tk: anchorTk, how });
    log(`  ${label} template anchor: ${how}${c.offsetF != null ? `, ${c.offsetF}f from its cut` : ""}, sub-frame residual ${c.residualF.toFixed(2)}f`);
  }
  res.centerNotes.forEach((n) => log("  center:", n));
  res.offGrid = 0;

  // occupancy per lane ("V7", "A3", ...); grows as we plan new stamps
  const occ = {};
  for (const p of pieces) (occ[p.kind] = occ[p.kind] || []).push([p.s, p.e]);
  for (const [k, v] of Object.entries(audioOcc)) occ[k] = (occ[k] || []).concat(v);
  const laneFree = (kind, lo, hi) => {
    if (laneNum(kind) > (kind[0] === "V" ? maxV : maxA)) return false; // lane doesn't exist
    return !(occ[kind] || []).some(([s, e]) => s < hi && e > lo);
  };

  const plan = [];
  for (const e of edges) {
    if (hasVideo(e)) { res.hasTransition++; continue; } // a lone whoosh is not a transition
    const tpl = e.type === "IN" ? tIn : tOut;
    if (!tpl || !tpl.group.length) { res.noTemplate++; res.skipped.push(`${e.type} @${tc(e.t)}: no template picked`); continue; }
    const deltaTk = e.tk - anchors.get(tpl).tk; // exact whole ticks: new cut minus the template's anchor
    if (deltaTk % TPF !== 0n) res.offGrid++;
    const delta = tkSecs(deltaTk);              // seconds, ONLY for the lane-overlap planning below
    const spans = tpl.group.map((p) => ({ p, kind: p.kind, lo: p.s + delta, hi: p.e + delta }));
    if (Math.min(...spans.map((x) => x.lo)) < 0) { res.beforeZero++; res.skipped.push(`${e.type} @${tc(e.t)}: would start before the timeline does`); continue; }

    // VIDEO: shift the whole video group up together until every layer fits (keeps layer order)
    const vSpans = spans.filter((x) => x.kind[0] === "V");
    let k = -1;
    for (let kk = 0; kk <= maxV; kk++) {
      if (vSpans.every((x) => laneFree("V" + (laneNum(x.kind) + kk), x.lo, x.hi))) { k = kk; break; }
    }
    // AUDIO: each SFX stays on its lane unless occupied, then slides down to the first free lane
    const aSpans = spans.filter((x) => x.kind[0] === "A");
    const aShift = [];
    let aOk = true;
    for (const x of aSpans) {
      let j = -1;
      for (let jj = 0; jj <= maxA; jj++) {
        if (laneFree("A" + (laneNum(x.kind) + jj), x.lo, x.hi)) { j = jj; break; }
      }
      if (j < 0) aOk = false;
      aShift.push(j);
    }
    if (k < 0 || !aOk) { res.noLane++; res.skipped.push(`${e.type} @${tc(e.t)}: no free track (${k < 0 ? "video" : "audio"} full)`); continue; }

    vSpans.forEach((x) => (occ["V" + (laneNum(x.kind) + k)] = occ["V" + (laneNum(x.kind) + k)] || []).push([x.lo, x.hi]));
    aSpans.forEach((x, i) => (occ["A" + (laneNum(x.kind) + aShift[i])] = occ["A" + (laneNum(x.kind) + aShift[i])] || []).push([x.lo, x.hi]));
    if (k > 0 || aShift.some((j) => j > 0)) {
      res.stacked.push(`${e.type} @${tc(e.t)}: ` + [
        ...vSpans.map((x) => `${x.kind}->V${laneNum(x.kind) + k}`),
        ...aSpans.map((x, i) => `${x.kind}->A${laneNum(x.kind) + aShift[i]}`),
      ].join(", "));
    }
    plan.push({ e, tpl, delta, deltaTk, aSpans, aShift, k });
  }
  res.planned = plan.length;
  res.nIn = plan.filter((p) => p.e.type === "IN").length;
  res.nOut = plan.length - res.nIn;
  res.expected = plan.reduce((n, p) => n + p.tpl.group.length, 0);
  log(`to stamp: ${res.planned} (${res.nIn} IN, ${res.nOut} OUT) | already had one: ${res.hasTransition}, before 0s: ${res.beforeZero}, no free track: ${res.noLane}, no template: ${res.noTemplate}`);
  res.stacked.forEach((s) => log("  stacked:", s));
  res.skipped.forEach((s) => log("  skipped:", s));
  plan.slice(0, 4).forEach((p) => log(`  shift ${p.e.type} @${tc(p.e.t)}: ${Math.round(tkFrames(p.deltaTk))} frames = ${p.deltaTk} ticks`));
  log(`  all shifts are whole frames: ${res.offGrid === 0 ? "yes" : "NO, " + res.offGrid + " are not"} (ticks per frame ${TPF})`);
  if (res.offGrid) res.warnings.push(`${res.offGrid} shift(s) don't land on a whole frame. Premiere will round those clips.`);

  if (!dry && plan.length) {
    const countBefore = await countLaneClips(sequence, maxV, maxA);
    let innerErr = null;
    project.lockedAccess(() => {
      try {
        const editor = ppro.SequenceEditor.getEditor(sequence);
        const zero = ppro.TickTime.createWithTicks("0");
        res.ok = project.executeTransaction((compound) => {
          for (const p of plan) {
            // the shift is built from exact integer ticks, not from decimal seconds
            const mag = ppro.TickTime.createWithTicks(String(p.deltaTk < 0n ? -p.deltaTk : p.deltaTk));
            const t = p.deltaTk >= 0n ? mag : zero.subtract(mag);
            // args: item, timeOffset, videoTrackVerticalOffset, audioTrackVerticalOffset, alignToVideo, isInsert
            // positive vertical offset = toward higher track numbers (video up, audio down)
            for (const piece of p.tpl.group) {
              const isV = piece.kind[0] === "V";
              const aj = isV ? 0 : p.aShift[p.aSpans.findIndex((x) => x.p === piece)] || 0;
              compound.addAction(editor.createCloneTrackItemAction(piece.item, t, isV ? p.k : 0, aj, true, false));
            }
          }
        }, "Transition Stamper: stamp edges");
      } catch (e) { innerErr = e; }
    });
    if (innerErr) { res.ok = false; log("INNER ERROR:", String(innerErr), innerErr.stack || ""); }
    log("executeTransaction returned:", res.ok);
    const countAfter = await countLaneClips(sequence, maxV, maxA);
    res.added = countAfter - countBefore;
    log(`clips on transition lanes: ${countBefore} -> ${countAfter} (added ${res.added}, expected ${res.expected})`);
    try { // measure what we just did, in exact ticks
      const A2 = await analyzeEdges(sequence);
      res.audit = await auditTransitions(await buildStyles(A2));
      auditLines(res.audit).forEach((l) => log(l));
    } catch (e) { log("audit failed:", String(e).slice(0, 120)); }
  }
  return res;
}

function renderResult(res) {
  let s;
  if (res.dry) {
    s = res.planned
      ? `Ready to stamp ${res.planned} transitions (${res.nIn} IN, ${res.nOut} OUT).`
      : (res.noTemplate > 0
        ? `Nothing to stamp: no IN or OUT transition is picked. Pick one in the dropdowns, or build one by hand and tap the refresh icon.`
        : res.hasTransition > 0
          ? `Nothing to stamp: ${res.hasTransition} of ${res.totalEdges} edges already have a transition. To stamp again, undo (Ctrl+Z) or delete the old ones first.`
          : "Nothing to stamp.");
  } else if (res.ok === false) {
    s = "Stamping FAILED. Nothing may have changed. Check the dev log.";
  } else if (!res.planned) {
    s = "Nothing to stamp.";
  } else {
    s = `Stamped ${res.planned} transitions (${res.nIn} IN, ${res.nOut} OUT). Ctrl+Z undoes all of it.`;
    if (res.added !== res.expected) s += `\nWarning: expected ${res.expected} new clips, found ${res.added}.`;
  }
  const stamped = !res.dry && res.ok !== false && res.planned > 0;
  if (stamped) {
    const extra = [];
    if (res.stacked.length) extra.push(`${res.stacked.length} lifted to a free track`);
    if (res.skipped.length) extra.push(`${res.skipped.length} skipped`);
    if (extra.length) s += `\n${extra.join(", ")} (see details).`;
    if (res.audit) s += `\nChecked: ${res.audit.exact} of ${res.audit.total} transitions are exactly centered and identical to their template, to the tick.`;
  }
  $("summary").textContent = s;
  // setup warnings are about what to fix BEFORE stamping; once it has run, don't leave them hanging
  showWarnings(stamped ? [] : (res.warnings || []));
  const d = [];
  if (res.centerNotes && res.centerNotes.length) d.push(...res.centerNotes);
  if (res.audit && (res.audit.off.length || res.audit.notFound.length)) d.push(...auditLines(res.audit));
  if (res.hasTransition) d.push(`${res.hasTransition} edges already had a transition (left alone).`);
  if (res.stacked.length) d.push(`${res.stacked.length} lifted to free tracks:`, ...res.stacked.map((x) => "  " + x));
  if (res.skipped.length) d.push("Skipped:", ...res.skipped.map((x) => "  " + x));
  setDetails(d.join("\n"));
}

// ---------- dev: inspect / census / edges ----------
async function dumpKeyframes(label, trackItem) {
  try {
    const chain = await trackItem.getComponentChain();
    const n = chain.getComponentCount();
    log(`${label}: ${n} components`);
    for (let i = 0; i < n; i++) {
      const comp = chain.getComponentAtIndex(i);
      const pc = comp.getParamCount();
      log(`  [${i}] ${await comp.getDisplayName()} (${pc} params)`);
      for (let p = 0; p < pc; p++) {
        const param = comp.getParam(p);
        let kfs = [], tv = "?";
        try {
          tv = param.isTimeVarying ? param.isTimeVarying() : "n/a";
          if (tv) kfs = param.getKeyframeListAsTickTimes();
        } catch (err) { tv = "err:" + String(err); }
        if (tv === true || kfs.length) log(`     ${param.displayName ?? p}: ${kfs.length} keyframes`);
      }
    }
  } catch (e) { log(`${label}: keyframe dump failed:`, String(e)); }
}
async function inspectTemplates() {
  await scan({ quiet: true });
  if (!LAST) return;
  for (const [name, id] of [["IN", "tplIn"], ["OUT", "tplOut"]]) {
    const e = LAST.edges[Number($(id).value) - 1];
    if (!e) { log(`${name}: no template`); continue; }
    log(`${name} template @${tc(e.t)}: ${groupLabel(e.group)}`);
    for (const p of e.group) {
      log(` ${p.kind} ${tc(p.s)} -> ${tc(p.e)} (${(p.e - p.s).toFixed(2)}s)`);
      if (p.kind[0] === "V") await dumpKeyframes("  " + p.kind, p.item);
    }
  }
}
// one line per track, to work out which track holds the main footage on an unfamiliar project
async function census() {
  const { sequence } = await getCtx();
  const gap = num("gapTol") > 0 ? num("gapTol") : 0.1;
  const maxV = await countTracks(sequence, "video");
  const maxA = await countTracks(sequence, "audio");
  log(`census | ${maxV} video tracks, ${maxA} audio tracks | fps ${FPS.toFixed(3)} (${FPS_SRC}) | gap tolerance ${gap}s`);
  const describe = async (items) => {
    const spans = [];
    for (const it of items) spans.push([secs(await it.getStartTime()), secs(await it.getEndTime()), it]);
    spans.sort((a, b) => a[0] - b[0]);
    let blocks = 0, last = -1e9, covered = 0;
    for (const [s, e] of spans) { if (s - last > gap) blocks++; last = Math.max(last, e); covered += e - s; }
    const names = [];
    for (const [, , it] of spans.slice(0, 2)) {
      let n = "";
      try { n = typeof it.getName === "function" ? await it.getName() : (it.name || ""); } catch (e) { n = ""; }
      if (n) names.push(String(n).slice(0, 28));
    }
    return { n: spans.length, first: spans.length ? spans[0][0] : 0, last: spans.length ? last : 0, blocks, covered, names };
  };
  for (let v = 1; v <= maxV; v++) {
    const d = await describe(await videoClips(sequence, v));
    if (!d.n) { log(`V${v}: empty`); continue; }
    log(`V${v}: ${d.n} clips | ${tc(d.first)} -> ${tc(d.last)} | ${d.blocks} blocks | ${d.covered.toFixed(0)}s of clips${d.names.length ? ' | e.g. "' + d.names.join('", "') + '"' : ""}`);
  }
  for (let a = 1; a <= maxA; a++) {
    const d = await describe(await audioClips(sequence, a));
    log(d.n ? `A${a}: ${d.n} clips | ${d.blocks} blocks | ${d.covered.toFixed(0)}s` : `A${a}: empty`);
  }
}
// dev: where is everything, and is any element a thin wide sliver (a stray line)?
async function layoutProbe() {
  log("layout probe | active tab:", activeTab);
  try {
    const sc = $("scroller"), r = sc.getBoundingClientRect();
    log(`window: inner ${window.innerWidth}x${window.innerHeight} | html client ${document.documentElement.clientWidth}x${document.documentElement.clientHeight} | body client ${document.body.clientHeight}, scroll ${document.body.scrollHeight}`);
    log(`scroller: style.height=${sc.style.height || "(none)"} | rect top ${Math.round(r.top)} h ${Math.round(r.height)} | client ${sc.clientHeight} scrollHeight ${sc.scrollHeight} | scrollTop ${sc.scrollTop} | can scroll: ${sc.scrollHeight > sc.clientHeight + 1}`);
  } catch (e) { log("scroller metrics failed:", String(e)); }
  const ids = ["pStamp", "pSetup", "pAbout", "pDev", "scan", "stamp", "tplIn", "tplOut", "confirmBox", "summary", "warnings", "detailsToggle", "details", "options"];
  for (const id of ids) {
    try {
      const el = $(id), r = el.getBoundingClientRect();
      log(`  #${id}: x${Math.round(r.left)} y${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} display:${el.style.display || "css"}`);
    } catch (e) {}
  }
  const thin = [];
  for (const el of document.querySelectorAll("*")) {
    try {
      const r = el.getBoundingClientRect();
      if (r.width > 100 && r.height > 0 && r.height <= 4) {
        thin.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className ? "." + String(el.className).replace(/\s+/g, ".") : ""} y${Math.round(r.top)} h${r.height.toFixed(1)}`);
      }
    } catch (e) {}
  }
  log("thin elements (<=4px tall, >100px wide):", thin.length ? thin.length : "none");
  thin.forEach((t) => log("  " + t));
}

// dev: for the first few edges that have a transition, where does every nearby piece sit (in frames, relative to the edge)
// and did it make it into the edge's group? Used to check transitions built from several clips (e.g. two halves meeting at the cut).
async function nearby() {
  const { sequence } = await getCtx();
  if (missingSettings().length) throw new Error("Fill in your tracks first.");
  const A = await analyzeEdges(sequence);
  const withV = A.edges.filter(hasVideo).slice(0, 6);
  log(`nearby: ${withV.length} edges with a video group (up to 6 shown) | fps ${FPS.toFixed(3)}`);
  for (const e of withV) {
    log(`edge #${e.idx} ${e.type} @${tc(e.t)} | group: ${groupLabel(e.group)}`);
    const near = A.pieces.filter((p) => p.s < e.t + 2.5 && p.e > e.t - 2.5).sort((a, b) => a.kind.localeCompare(b.kind) || a.s - b.s);
    for (const p of near) log(`   ${p.kind}: start ${frames(p.s - e.t)}f, end ${frames(p.e - e.t)}f, len ${frames(p.e - p.s)}f ${e.group.includes(p) ? "(in group)" : "(NOT in group)"}`);
  }
}

// dev, READ-ONLY. Phase 1 of the "make the plugin KNOW the center" plan.
// For each distinct transition style on the timeline it prints, relative to the cut and in frames:
//   - where every clip starts/ends (so we can see the geometry),
//   - where clips on one track MEET (a "split": the point where two halves touch),
//   - the time of every keyframe, read BOTH ways (relative to the clip / absolute in the sequence), because it is not
//     yet known which one UXP reports; whichever gives sane numbers near the cut tells us,
//   - any markers we are able to read (sequence markers; and an attempt at the clip's project item).
// Nothing here changes the timeline.
async function centerProbe() {
  const { sequence } = await getCtx();
  if (missingSettings().length) throw new Error("Fill in your tracks first.");
  const A = await analyzeEdges(sequence);
  const styles = await buildStyles(A);
  log(`center probe | ${styles.length} transition style(s) | fps ${FPS.toFixed(3)} (${FPS_SRC}) | 1 frame = ${(1 / FPS).toFixed(5)}s`);

  const markerInfo = async (owner, label) => {
    try {
      const mk = await ppro.Markers.getMarkers(owner);
      const arr = await mk.getMarkers();
      const n = arr ? arr.length : 0;
      let api = "";
      if (n) api = " | methods: " + Object.getOwnPropertyNames(Object.getPrototypeOf(arr[0])).filter((x) => x !== "constructor").join(",");
      log(`${label}: ${n} marker(s)${api}`);
      const out = [];
      for (const m of (arr || []).slice(0, 60)) {
        let start = null, name = "";
        try { start = secs(typeof m.getStart === "function" ? await m.getStart() : m.start); } catch (e) {}
        try { name = String(typeof m.getName === "function" ? await m.getName() : (m.name || "")); } catch (e) {}
        out.push({ start, name });
      }
      return out;
    } catch (e) { log(`${label}: could not read markers: ${String(e).slice(0, 120)}`); return []; }
  };
  const seqMarkers = await markerInfo(sequence, "sequence markers");

  for (const s of styles) {
    const e = s.rep;
    log(`--- style: ${s.label} | sample edge #${e.idx} ${e.type} @${tc(e.t)} (${e.t.toFixed(5)}s)`);
    const near = seqMarkers.filter((m) => m.start != null && Math.abs(m.start - e.t) < 3);
    near.forEach((m) => log(`  sequence marker "${m.name}" at ${frames(m.start - e.t)}f from the cut`));

    const byTrack = {};
    for (const p of e.group) {
      log(`  ${p.kind}: start ${frames(p.s - e.t)}f (${(p.s - e.t).toFixed(5)}s), end ${frames(p.e - e.t)}f (${(p.e - e.t).toFixed(5)}s), length ${frames(p.e - p.s)}f`);
      if (p.kind[0] === "V") (byTrack[p.kind] = byTrack[p.kind] || []).push(p);
    }
    for (const [kind, arr] of Object.entries(byTrack)) {
      arr.sort((a, b) => a.s - b.s);
      for (let i = 0; i + 1 < arr.length; i++) {
        log(`  ${kind}: two clips meet ${frames(arr[i].e - e.t)}f from the cut (gap between them ${frames(arr[i + 1].s - arr[i].e)}f)  <-- split point`);
      }
    }

    for (const p of e.group.filter((x) => x.kind[0] === "V")) {
      try {
        // keyframe times are in the clip's SOURCE time. To put one on the sequence timeline:
        //   sequence time = clip start + (keyframe time - clip in-point)
        let ip = null;
        try { ip = secs(await p.item.getInPoint()); } catch (err) {}
        log(`  ${p.kind} clip at ${frames(p.s - e.t)}f..${frames(p.e - e.t)}f | in-point ${ip == null ? "unreadable" : ip.toFixed(4) + "s"}`);
        const seqFrames = (x) => (ip == null ? NaN : (((p.s + (x - ip)) - e.t) * FPS));
        const counts = new Map(); let nParams = 0;
        const chain = await p.item.getComponentChain();
        const n = chain.getComponentCount();
        for (let i = 0; i < n; i++) {
          const comp = chain.getComponentAtIndex(i);
          const cname = await comp.getDisplayName();
          const pc = comp.getParamCount();
          for (let k = 0; k < pc; k++) {
            const param = comp.getParam(k);
            let times = [];
            try { if (param.isTimeVarying && param.isTimeVarying()) times = param.getKeyframeListAsTickTimes(); } catch (err) {}
            if (!times.length) continue;
            const ts = times.map((t) => secs(t));
            nParams++;
            new Set(ts.map((x) => Math.round(x * 1000))).forEach((m) => counts.set(m, (counts.get(m) || 0) + 1));
            log(`     ${cname} / ${param.displayName ?? k}: ${ts.length} keys | on the sequence, frames from the cut: ${ts.map((x) => seqFrames(x).toFixed(2)).join(", ")}`);
          }
        }
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        log(`     keyframe times shared by the most effects (the likely "peak"): ` + top.map(([m, c]) => `${(m / 1000).toFixed(3)}s in ${c} of ${nParams} -> ${seqFrames(m / 1000).toFixed(2)}f from the cut`).join(" | "));
      } catch (err) { log("  keyframe read failed:", String(err).slice(0, 120)); }
    }

    for (const p of e.group) {
      try {
        const pi = await p.item.getProjectItem();
        await markerInfo(pi, `  ${p.kind} project-item markers`);
      } catch (err) { log(`  ${p.kind} project-item markers: not readable (${String(err).slice(0, 80)})`); }
    }
  }
}

async function listEdges() {
  const { sequence } = await getCtx();
  if (missingSettings().length) throw new Error("Fill in your tracks first.");
  const A = await analyzeEdges(sequence);
  log(`${A.blocks.length} blocks -> ${A.edges.length} edges | fps ${FPS.toFixed(3)} (${FPS_SRC}) | ${A.maxV}V/${A.maxA}A`);
  for (const e of A.edges) log(`  #${e.idx} ${e.type} ${tc(e.t)} ${e.group.length ? "[" + groupLabel(e.group) + "]" : ""}`);
}

// ---------- button wiring ----------
let busy = false;
const setButtons = (disabled) => BUTTONS.forEach((id) => {
  try {
    $(id).disabled = disabled;
    // styled blocks have no native disabled look; Stamp also stays gray while the tracks aren't set
    setClass($(id), "off", disabled || (id === "stamp" && missingSettings().length > 0));
  } catch (e) {}
});
function guarded(fn, onDone) {
  return async () => {
    if (busy) return;
    busy = true;
    try {
      setButtons(true);
      const r = await fn();
      if (onDone) onDone(r);
    } catch (e) {
      try { $("summary").textContent = "Error: " + (e && e.message ? e.message : String(e)); } catch (e2) {}
      log("ERROR:", String(e), e && e.stack ? e.stack : "");
    } finally {
      busy = false; // never leave the panel stuck busy
      setButtons(false);
      relayout();
    }
    try { if ($("devMode").checked) await saveLog(); } catch (e) {}
  };
}
const hideConfirm = () => { $("confirmBox").style.display = "none"; relayout(); };

$("scan").addEventListener("click", guarded(scan));
$("preview").addEventListener("click", guarded(() => stampEdges(true), renderResult));
// Stamp = preview first, then ask. Nothing is written until the editor confirms.
// Warnings never block, but they are shown INSIDE the confirm box, right where the editor decides,
// and the button then says "Stamp anyway". (Errors, like a missing track, do block.)
$("stamp").addEventListener("click", guarded(async () => {
  hideConfirm();
  if (missingSettings().length) { showTab("setup"); return; } // nothing to stamp with yet: take them to Setup
  await scan({ quiet: true }); // always plan from the live timeline (after a Ctrl+Z the panel's old data is stale)
  const r = await stampEdges(true);
  renderResult(r);
  if (r.planned) {
    const w = r.warnings || [];
    $("summary").textContent = "";
    showWarnings([]);
    $("confirmText").textContent = `Stamp ${r.planned} transitions (${r.nIn} IN, ${r.nOut} OUT)? Ctrl+Z undoes all of it in one step.`;
    $("confirmWarn").textContent = w.map((x) => "Heads up: " + x).join("\n");
    $("confirmWarn").style.display = w.length ? "block" : "none";
    $("confirmStamp").textContent = w.length ? "Stamp anyway" : "Yes, stamp";
    $("confirmBox").style.display = "block";
  }
}));
$("confirmStamp").addEventListener("click", guarded(async () => {
  hideConfirm();
  const r = await stampEdges(false);
  await scan({ quiet: true }).catch(() => {});
  renderResult(r);
}));
$("cancelStamp").addEventListener("click", hideConfirm);
// tabs
$("tabStamp").addEventListener("click", () => showTab("stamp"));
$("tabSetup").addEventListener("click", () => showTab("setup"));
$("tabAbout").addEventListener("click", () => showTab("about"));
$("goSetup").addEventListener("click", () => showTab("setup"));
$("swap").addEventListener("click", swapPicks);
$("tabDev").addEventListener("click", () => showTab("dev"));
$("changeTracks").addEventListener("click", () => showTab("setup"));
$("optToggle").addEventListener("click", () => {
  const open = $("options").style.display === "none";
  $("options").style.display = open ? "block" : "none";
  $("optToggle").textContent = open ? "Hide options" : "Show options";
  relayout();
});
$("detailsToggle").addEventListener("click", () => {
  const open = $("details").style.display === "none";
  $("details").style.display = open ? "block" : "none";
  $("detailsToggle").textContent = open ? "Hide details" : "Show details";
  relayout();
});
$("setupDone").addEventListener("click", guarded(async () => {
  saveSettings();
  showTab("stamp");
  await scan();
}));
$("listEdges").addEventListener("click", guarded(listEdges));
$("inspectTpl").addEventListener("click", guarded(inspectTemplates));
$("census").addEventListener("click", guarded(census));
$("layoutProbe").addEventListener("click", guarded(layoutProbe));
$("nearbyProbe").addEventListener("click", guarded(nearby));
$("centerProbe").addEventListener("click", guarded(centerProbe));
$("auditNow").addEventListener("click", guarded(auditNow));
$("clearLog").addEventListener("click", () => { logEl.value = ""; });

// any change invalidates a pending confirm; optional remembering
// editing a track applies right away: no "save" button to hunt for
SETTING_IDS.forEach((id) => $(id).addEventListener("change", () => {
  hideConfirm(); saveSettings(); updateTrackSummary(); updateSetupNote();
  if (!missingSettings().length) guarded(scan)();
}));
["tplIn", "tplOut"].forEach((id) => $(id).addEventListener("change", () => { hideConfirm(); saveTemplatePicks(); updateSwapTag(); updateCenterInfo(); }));
$("rememberSettings").addEventListener("change", () => { setPref("rememberSettings", $("rememberSettings").checked ? "1" : "0"); saveSettings(); });
$("rememberTemplates").addEventListener("change", () => { setPref("rememberTemplates", $("rememberTemplates").checked ? "1" : "0"); saveTemplatePicks(); });
$("centerOnCut").checked = getPref("centerOnCut") !== "0"; // ON by default
$("centerOnCut").addEventListener("change", () => { setPref("centerOnCut", $("centerOnCut").checked ? "1" : "0"); hideConfirm(); updateCenterInfo(); });
$("rememberSettings").checked = getPref("rememberSettings") === "1";
$("rememberTemplates").checked = getPref("rememberTemplates") === "1";
$("devMode").checked = getPref("devMode") === "1";

// ---------- dev mode + command bridge ----------
// Dev mode polls cmd.json in the project folder: {"id":"x1","action":"scan|listEdges|preview|inspect|census|stamp"}
// and writes the outcome to log.txt + bridge-result.json. "stamp" only runs if the box is ticked.
let bridgeTimer = null, bridgeBusy = false;
async function bridgeTick() {
  if (bridgeBusy || busy) return;
  bridgeBusy = true;
  try {
    const fs = require("uxp").storage.localFileSystem;
    const folder = await fs.getEntryWithUrl(DEV_DIR);
    let entry = null;
    try { entry = await folder.getEntry("cmd.json"); } catch (e) { entry = null; }
    if (!entry) { bridgeBusy = false; return; }
    const raw = await entry.read();
    try { await entry.delete(); } catch (e) {}
    let cmd; try { cmd = JSON.parse(raw); } catch (e) { cmd = null; }
    const id = cmd && cmd.id ? cmd.id : "?";
    const action = cmd && cmd.action;
    logEl.value = "";
    if (cmd && cmd.tab) showTab(cmd.tab); // optional: look at a specific tab (dev testing)
    if (cmd && cmd.settings) { // optional: set the track fields, e.g. {"cutTrack":4,"tplTrack":6,"sfxTrack":3} (panel state only, not the timeline)
      for (const id of SETTING_IDS) if (cmd.settings[id] != null) $(id).value = String(cmd.settings[id]);
      updateTrackSummary(); updateSetupNote();
    }
    if (cmd && cmd.options && cmd.options.centerOnCut != null) { $("centerOnCut").checked = !!cmd.options.centerOnCut; updateCenterInfo(); } // dev testing
    log(`[bridge] ${id}: ${action}`);
    let status = "ok", error = null;
    busy = true;
    try {
      if (action === "scan") await scan();
      else if (action === "listEdges") await listEdges();
      else if (action === "inspect") await inspectTemplates();
      else if (action === "census") await census();
      else if (action === "layout") await layoutProbe();
      else if (action === "nearby") await nearby();
      else if (action === "center") await centerProbe();
      else if (action === "audit") await auditNow();
      else if (action === "preview") { await scan({ quiet: true }); renderResult(await stampEdges(true)); }
      else if (action === "stamp") {
        if (!$("allowBridgeStamp").checked) { status = "refused"; error = "Bridge stamping is not enabled in the panel."; log("[bridge] REFUSED: tick 'Allow bridge to STAMP' first."); }
        else { const r = await stampEdges(false); await scan({ quiet: true }).catch(() => {}); renderResult(r); }
      } else { status = "error"; error = "unknown action"; log("[bridge] unknown action:", action); }
    } catch (e) { status = "error"; error = String(e); log("ERROR:", String(e), e && e.stack ? e.stack : ""); }
    busy = false;
    log(`[bridge] ${id}: ${status}`);
    await saveLog();
    await writeDevFile("bridge-result.json", JSON.stringify({ id, action, status, error, finishedAt: new Date().toISOString() }));
  } catch (e) { console.log("bridgeTick failed", String(e)); }
  bridgeBusy = false;
}
function applyDevMode() {
  const on = $("devMode").checked;
  $("tabDev").style.display = on ? "block" : "none";
  if (!on && activeTab === "dev") showTab("stamp");
  setPref("devMode", on ? "1" : "0");
  if (bridgeTimer) { clearInterval(bridgeTimer); bridgeTimer = null; }
  if (on) { bridgeTimer = setInterval(bridgeTick, 1500); $("bridgeStatus").textContent = "bridge: listening for cmd.json every 1.5s"; }
  else $("bridgeStatus").textContent = "bridge: off";
}
$("devMode").addEventListener("change", applyDevMode);
applyDevMode();

// About tab: show the installed version (the dev copy and the release copy have different ones)
try { $("aboutVersion").textContent = "Version " + require("uxp").versions.plugin; } catch (e) { $("aboutVersion").textContent = ""; }

// ---------- follow the active project / sequence ----------
// Switching projects or timelines used to leave the old dropdowns and results on screen.
let activeSig = null;
async function watchActive() {
  if (busy || bridgeBusy) return;
  try {
    const project = await ppro.Project.getActiveProject();
    const seq = project ? await project.getActiveSequence() : null;
    const sig = project && seq ? projectKey(project) + "|" + String(seq.name) : "none";
    if (activeSig === null) { activeSig = sig; return; } // first tick: just remember where we are
    if (sig === activeSig) return;
    activeSig = sig;
    clearResults();
    LAST = null;
    await guarded(scan)();
  } catch (e) {}
}
setInterval(watchActive, 2000);

// first scan on load
fitScroller();
guarded(scan)();
