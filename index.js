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
}

// ---------- tabs ----------
let activeTab = "stamp";
function showTab(name) {
  activeTab = name;
  for (const t of ["stamp", "setup", "dev"]) {
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
const optTc = (sel) => { const o = sel.options[sel.options.length ? Math.max(0, [...sel.options].findIndex((x) => x.value === sel.value)) : 0]; return o ? String(o.textContent).split(" ")[0] : ""; };
function saveTemplatePicks() {
  if (!$("rememberTemplates").checked || !currentKey) return;
  setPref("tpl." + currentKey, JSON.stringify({ IN: optTc($("tplIn")), OUT: optTc($("tplOut")) }));
}

// ---------- helpers ----------
let FPS = 30, FPS_SRC = "assumed 30";
async function initFps(sequence) {
  try {
    const fr = await (await sequence.getSettings()).getVideoFrameRate();
    if (fr && fr.value > 0) { FPS = fr.value; FPS_SRC = "sequence settings"; return; }
  } catch (e) {}
  try {
    const f = TICKS_PER_SEC / Number(await sequence.getTimebase());
    if (f > 0) { FPS = f; FPS_SRC = "timebase"; }
  } catch (e) {}
}
function tc(sec) { // HH:MM:SS:FF (non-drop-frame display)
  const nominal = Math.round(FPS), total = Math.round(sec * FPS);
  const s = Math.floor(total / nominal), p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}:${p(total % nominal)}`;
}
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

  const spans = [];
  for (const c of await videoClips(sequence, cutTrack)) spans.push([secs(await c.getStartTime()), secs(await c.getEndTime())]);
  spans.sort((a, b) => a[0] - b[0]);

  const blocks = [];
  for (const [s, e] of spans) {
    const b = blocks[blocks.length - 1];
    if (b && s - b.e <= gap) b.e = Math.max(b.e, e);
    else blocks.push({ s, e });
  }
  const edges = [];
  for (const b of blocks) { edges.push({ t: b.s, type: "IN" }); edges.push({ t: b.e, type: "OUT" }); }
  edges.sort((a, b) => a.t - b.t);
  edges.forEach((e, i) => (e.idx = i + 1));

  // transition pieces: every video track from the transition track up + the SFX lane
  const pieces = [];
  for (let vn = vTpl; vn <= maxV; vn++) {
    for (const it of await videoClips(sequence, vn)) {
      pieces.push({ item: it, kind: "V" + vn, s: secs(await it.getStartTime()), e: secs(await it.getEndTime()) });
    }
  }
  for (const it of await audioClips(sequence, aTrack)) {
    pieces.push({ item: it, kind: "A" + aTrack, s: secs(await it.getStartTime()), e: secs(await it.getEndTime()) });
  }
  // lanes below the SFX lane: occupancy only (for sliding an SFX down)
  const audioOcc = {};
  for (let an = aTrack + 1; an <= maxA; an++) {
    audioOcc["A" + an] = [];
    for (const it of await audioClips(sequence, an)) audioOcc["A" + an].push([secs(await it.getStartTime()), secs(await it.getEndTime())]);
  }
  // small tolerance: SFX clips can be as short as 0.23s
  for (const ed of edges) ed.group = pieces.filter((p) => p.s <= ed.t + 0.02 && p.e >= ed.t - 0.02);
  return { edges, pieces, blocks, audioOcc, maxV, maxA };
}

const groupLabel = (g) => {
  const kinds = {};
  for (const p of g) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
  return Object.entries(kinds).map(([k, v]) => k + (v > 1 ? "x" + v : "")).join(" + ");
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
function fillSelect(selId, edges, type) {
  const sel = $(selId), prev = sel.value;
  sel.innerHTML = "";
  for (const e of edges.filter((x) => x.type === type)) {
    const o = document.createElement("option");
    o.value = String(e.idx);
    o.textContent = `${tc(e.t)}  (${groupLabel(e.group)})`;
    sel.appendChild(o);
  }
  if (!sel.options.length) { const o = document.createElement("option"); o.value = "0"; o.textContent = "none found: build one by hand first"; sel.appendChild(o); }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}
function restoreTemplatePicks() {
  if (!$("rememberTemplates").checked || !currentKey) return;
  try {
    const saved = JSON.parse(getPref("tpl." + currentKey) || "null");
    if (!saved) return;
    for (const [selId, type] of [["tplIn", "IN"], ["tplOut", "OUT"]]) {
      const sel = $(selId);
      const o = [...sel.options].find((x) => String(x.textContent).split(" ")[0] === saved[type]);
      if (o) sel.value = o.value;
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
    $("summary").textContent = "Set your tracks in the Setup tab first.";
    showWarnings([]); setDetails("");
    showTab("setup");
    return;
  }
  LAST = await analyzeEdges(sequence);
  const chk = checkSetup(LAST, null, null);
  if (chk.errors.length) {
    $("summary").textContent = "Problem: " + chk.errors.join(" ");
    showWarnings(chk.warnings); setDetails("");
    return;
  }
  const { edges, blocks } = LAST;
  const withG = edges.filter((e) => e.group.length);
  fillSelect("tplIn", withG, "IN");
  fillSelect("tplOut", withG, "OUT");
  restoreTemplatePicks();
  const nIn = edges.filter((e) => e.type === "IN").length;
  $("summary").textContent = `Found ${blocks.length} blocks on V${num("cutTrack")}: ${nIn} IN + ${edges.length - nIn} OUT edges. ${withG.length} already have a transition.`;
  showWarnings(chk.warnings);
  setDetails("");
  if (!opts.quiet) log(`scan: ${blocks.length} blocks, ${edges.length} edges, ${withG.length} with transitions | tracks ${LAST.maxV}V/${LAST.maxA}A | fps ${FPS.toFixed(3)} (${FPS_SRC})`);
}

// ---------- stamping ----------
async function stampEdges(dry) {
  const { project, sequence } = await getCtx();
  const miss = missingSettings();
  if (miss.length) throw new Error(`Fill in your ${miss.join(", ")} first.`);
  const A = await analyzeEdges(sequence);
  const { edges, pieces, audioOcc, maxV, maxA } = A;
  const tIn = Number($("tplIn").value) > 0 ? edges[Number($("tplIn").value) - 1] : null;
  const tOut = Number($("tplOut").value) > 0 ? edges[Number($("tplOut").value) - 1] : null;
  const chk = checkSetup(A, tIn, tOut);
  if (chk.errors.length) throw new Error(chk.errors.join(" "));
  const res = { dry, planned: 0, nIn: 0, nOut: 0, hasTransition: 0, beforeZero: 0, noLane: 0, noTemplate: 0, stacked: [], skipped: [], warnings: chk.warnings, ok: null, added: null, expected: null };
  if (!tIn && !tOut) throw new Error("No template transitions found. Build one IN and one OUT by hand, then tap Refresh.");
  log(`${dry ? "preview" : "STAMP"} | IN template @${tIn ? tc(tIn.t) : "none"} | OUT template @${tOut ? tc(tOut.t) : "none"} | tracks ${maxV}V/${maxA}A | fps ${FPS.toFixed(3)} (${FPS_SRC})`);
  res.warnings.forEach((w) => log("  warning:", w));

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
    if (e.group.length) { res.hasTransition++; continue; }
    const tpl = e.type === "IN" ? tIn : tOut;
    if (!tpl || !tpl.group.length) { res.noTemplate++; res.skipped.push(`${e.type} @${tc(e.t)}: no template picked`); continue; }
    const delta = e.t - tpl.t;
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
    plan.push({ e, tpl, delta, aSpans, aShift, k });
  }
  res.planned = plan.length;
  res.nIn = plan.filter((p) => p.e.type === "IN").length;
  res.nOut = plan.length - res.nIn;
  res.expected = plan.reduce((n, p) => n + p.tpl.group.length, 0);
  log(`to stamp: ${res.planned} (${res.nIn} IN, ${res.nOut} OUT) | already had one: ${res.hasTransition}, before 0s: ${res.beforeZero}, no free track: ${res.noLane}, no template: ${res.noTemplate}`);
  res.stacked.forEach((s) => log("  stacked:", s));
  res.skipped.forEach((s) => log("  skipped:", s));

  if (!dry && plan.length) {
    const countBefore = await countLaneClips(sequence, maxV, maxA);
    let innerErr = null;
    project.lockedAccess(() => {
      try {
        const editor = ppro.SequenceEditor.getEditor(sequence);
        const zero = ppro.TickTime.createWithSeconds(0);
        res.ok = project.executeTransaction((compound) => {
          for (const p of plan) {
            const mag = ppro.TickTime.createWithSeconds(Math.abs(p.delta));
            const t = p.delta >= 0 ? mag : zero.subtract(mag);
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
  }
  return res;
}

function renderResult(res) {
  let s;
  if (res.dry) {
    s = res.planned ? `Ready to stamp ${res.planned} transitions (${res.nIn} IN, ${res.nOut} OUT).` : "Nothing to stamp.";
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
  }
  $("summary").textContent = s;
  // setup warnings are about what to fix BEFORE stamping; once it has run, don't leave them hanging
  showWarnings(stamped ? [] : (res.warnings || []));
  const d = [];
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
  const ids = ["pStamp", "pSetup", "pDev", "scan", "stamp", "tplIn", "tplOut", "confirmBox", "summary", "warnings", "detailsToggle", "details", "options"];
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
    setClass($(id), "off", disabled); // styled blocks have no native disabled look
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
$("clearLog").addEventListener("click", () => { logEl.value = ""; });

// any change invalidates a pending confirm; optional remembering
// editing a track applies right away: no "save" button to hunt for
SETTING_IDS.forEach((id) => $(id).addEventListener("change", () => {
  hideConfirm(); saveSettings(); updateTrackSummary(); updateSetupNote();
  if (!missingSettings().length) guarded(scan)();
}));
["tplIn", "tplOut"].forEach((id) => $(id).addEventListener("change", () => { hideConfirm(); saveTemplatePicks(); }));
$("rememberSettings").addEventListener("change", () => { setPref("rememberSettings", $("rememberSettings").checked ? "1" : "0"); saveSettings(); });
$("rememberTemplates").addEventListener("change", () => { setPref("rememberTemplates", $("rememberTemplates").checked ? "1" : "0"); saveTemplatePicks(); });
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
    log(`[bridge] ${id}: ${action}`);
    let status = "ok", error = null;
    busy = true;
    try {
      if (action === "scan") await scan();
      else if (action === "listEdges") await listEdges();
      else if (action === "inspect") await inspectTemplates();
      else if (action === "census") await census();
      else if (action === "layout") await layoutProbe();
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
guarded(scan)();
