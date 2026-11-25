// A fake Premiere + fake panel DOM + fake UXP file system, so index.js can run in plain Node.
// It encodes OUR understanding of the API, including the rules we learned the hard way:
//  - createCloneTrackItemAction must be called inside executeTransaction (inside lockedAccess),
//    otherwise: "The script object is no longer valid."
//  - a clone that lands on top of an existing clip is recorded as an error (real Premiere would overwrite it)
//  - positive vertical offset = toward higher track numbers (ASSUMPTION, verified only by real runs)
// It CANNOT prove real Premiere behaves like this. It catches logic bugs in our code.

const fs = require("fs");
const path = require("path");

const TICKS = 254016000000;
class TickTime {
  constructor(sec) { this.seconds = sec; this.ticksNumber = Math.round(sec * TICKS); this.ticks = String(this.ticksNumber); }
  static createWithSeconds(s) { return new TickTime(s); }
  static createWithTicks(t) { return new TickTime(Number(t) / TICKS); }
  add(o) { return new TickTime(this.seconds + o.seconds); }
  subtract(o) { return new TickTime(this.seconds - o.seconds); }
}

class Item {
  constructor(kind, trackIdx, start, end, name) {
    this.kind = kind; this.trackIdx = trackIdx; this.start = start; this.end = end; this.name = name || "";
  }
  async getStartTime() { return new TickTime(this.start); }
  async getEndTime() { return new TickTime(this.end); }
}

class Timeline {
  constructor({ videoTracks = 9, audioTracks = 7, fps = 30 } = {}) {
    this.fps = fps;
    this.video = Array.from({ length: videoTracks }, () => []);
    this.audio = Array.from({ length: audioTracks }, () => []);
    this.errors = [];
    this.state = { locked: false, inTransaction: false };
    this.transactions = 0;
  }
  // 1-based track numbers, like the UI (V4, A3)
  addV(track, start, end, name) { const it = new Item("V", track - 1, start, end, name); this.video[track - 1].push(it); return it; }
  addA(track, start, end, name) { const it = new Item("A", track - 1, start, end, name); this.audio[track - 1].push(it); return it; }
  items(kind, track) { return (kind === "V" ? this.video : this.audio)[track - 1] || []; }
  count(kind, track) { return this.items(kind, track).length; }
  snapshot() {
    return JSON.stringify([this.video.map((t) => t.map((i) => [i.start, i.end])), this.audio.map((t) => t.map((i) => [i.start, i.end]))]);
  }
  // any two clips overlapping on the same lane?
  overlaps() {
    const bad = [];
    const check = (lanes, k) => lanes.forEach((lane, idx) => {
      const s = [...lane].sort((a, b) => a.start - b.start);
      for (let i = 1; i < s.length; i++) if (s[i].start < s[i - 1].end - 1e-9) bad.push(`${k}${idx + 1} @${s[i].start.toFixed(2)}`);
    });
    check(this.video, "V"); check(this.audio, "A");
    return bad;
  }

  // ----- the fake `premierepro` module -----
  module() {
    const tl = this;
    const trackWrap = (kind, idx) => ({
      async getTrackItems() { return [...tl.items(kind, idx + 1)].sort((a, b) => a.start - b.start); },
    });
    const sequence = {
      name: "Test Sequence",
      async getVideoTrack(i) { if (i < 0 || i >= tl.video.length) throw new Error("bad video track index"); return trackWrap("V", i); },
      async getAudioTrack(i) { if (i < 0 || i >= tl.audio.length) throw new Error("bad audio track index"); return trackWrap("A", i); },
      async getSettings() { return { async getVideoFrameRate() { return { value: tl.fps }; } }; },
      async getTimebase() { return String(Math.round(TICKS / tl.fps)); },
    };
    const editor = {
      createCloneTrackItemAction(item, offset, vOff, aOff, alignToVideo, isInsert) {
        if (!tl.state.inTransaction) throw new Error("The script object is no longer valid.");
        return {
          apply() {
            const isV = item.kind === "V";
            const dest = item.trackIdx + (isV ? vOff : aOff);
            const lanes = isV ? tl.video : tl.audio;
            if (dest < 0 || dest >= lanes.length) { tl.errors.push(`clone to missing ${item.kind}${dest + 1}`); return; }
            const ni = new Item(item.kind, dest, item.start + offset.seconds, item.end + offset.seconds, item.name);
            if (ni.start < -1e-9) { tl.errors.push(`clone starts before 0 on ${item.kind}${dest + 1}`); return; }
            if (lanes[dest].some((o) => o.start < ni.end - 1e-9 && o.end > ni.start + 1e-9)) tl.errors.push(`clone overlaps on ${item.kind}${dest + 1} @${ni.start.toFixed(2)}`);
            lanes[dest].push(ni);
          },
        };
      },
    };
    const project = {
      async getActiveSequence() { return sequence; },
      lockedAccess(cb) { tl.state.locked = true; try { cb(); } finally { tl.state.locked = false; } },
      executeTransaction(cb, name) {
        if (!tl.state.locked) throw new Error("executeTransaction outside lockedAccess");
        tl.state.inTransaction = true;
        const acts = [];
        try { cb({ addAction(a) { acts.push(a); } }); } finally { tl.state.inTransaction = false; }
        acts.forEach((a) => a.apply());
        tl.transactions++;
        return true;
      },
    };
    return {
      Project: { async getActiveProject() { return project; } },
      SequenceEditor: { getEditor() { return editor; } },
      TickTime,
      Constants: { TrackItemType: { CLIP: 1 } },
    };
  }
}

// ----- fake panel DOM -----
function makeDom() {
  const els = {};
  const mk = (id, init = {}) => {
    const el = {
      id, value: "", checked: false, textContent: "", style: {}, disabled: false, options: [], listeners: {}, scrollTop: 0, scrollHeight: 0,
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      async fire(t) { await Promise.all((this.listeners[t] || []).map((f) => f())); },
      appendChild(o) { this.options.push(o); if (this.value === "") this.value = o.value; },
      ...init,
    };
    Object.defineProperty(el, "innerHTML", { get() { return ""; }, set(v) { if (v === "") { this.options = []; this.value = ""; } } });
    els[id] = el;
    return el;
  };
  mk("scan"); mk("preview"); mk("stamp"); mk("listEdges"); mk("inspectTpl"); mk("census"); mk("clearLog");
  mk("tplIn"); mk("tplOut");
  mk("cutTrack", { value: "4" }); mk("tplTrack", { value: "7" }); mk("sfxTrack", { value: "3" }); mk("gapTol", { value: "0.1" });
  mk("devMode"); mk("allowBridgeStamp"); mk("bridgeStatus"); mk("log"); mk("summary"); mk("details"); mk("dev");
  return {
    els,
    document: { getElementById: (id) => { if (!els[id]) throw new Error("no element #" + id); return els[id]; }, createElement: () => ({ value: "", textContent: "" }) },
  };
}

// ----- fake UXP file system (in memory) -----
function makeFs() {
  const files = new Map();
  const entry = (name) => ({
    async read() { return files.get(name); },
    async delete() { files.delete(name); },
    async write(t) { files.set(name, t); },
  });
  const folder = {
    async getEntry(name) { if (!files.has(name)) throw new Error("not found: " + name); return entry(name); },
    async createFile(name) { files.set(name, files.get(name) || ""); return entry(name); },
  };
  return { files, uxp: { storage: { localFileSystem: { async getEntryWithUrl() { return folder; } } } } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Load the REAL index.js against the fakes. Returns handles for driving it.
async function boot(timeline) {
  const dom = makeDom();
  const memfs = makeFs();
  let tick = null;
  const env = {
    document: dom.document,
    localStorage: { getItem: () => null, setItem: () => {} },
    setInterval: (fn) => { tick = fn; return 1; },
    clearInterval: () => { tick = null; },
    quiet: { log() {}, warn() {}, error() {} },
  };
  const modules = { premierepro: timeline.module(), uxp: memfs.uxp };
  const req = (m) => { if (!(m in modules)) throw new Error("unknown module " + m); return modules[m]; };
  const code = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  new Function("require", "document", "localStorage", "setInterval", "clearInterval", "console", code)(
    req, env.document, env.localStorage, env.setInterval, env.clearInterval, env.quiet
  );
  const settle = async () => { for (let i = 0; i < 400 && dom.els.scan.disabled; i++) await sleep(2); await sleep(5); };
  await settle(); // initial auto-scan
  return {
    els: dom.els, files: memfs.files, timeline,
    settle,
    async click(id) { await dom.els[id].fire("click"); await settle(); },
    async bridge(cmd) { memfs.files.set("cmd.json", JSON.stringify(cmd)); await tick(); await settle(); },
    devOn() { dom.els.devMode.checked = true; return dom.els.devMode.fire("change"); },
  };
}

module.exports = { Timeline, boot, TickTime };
