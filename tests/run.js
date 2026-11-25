// Run: node tests/run.js
// Drives the REAL index.js against a fake Premiere (see mock-premiere.js).
const assert = require("assert");
const { Timeline, boot } = require("./mock-premiere");

const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m || "value"}: ${a} !== ${b}`);

// A timeline shaped like the real one (V4 = main footage, V7/V8 = transitions, A3 = whoosh, A4 = music)
//   Block A 0-12.9          (two clips, inner cut at 7.2)      existing OUT @12.9  (V7+V8+A3)
//   Block B 20.13-60        (two clips, inner cut at 40)       existing IN  @20.13 (V7+A3)
//   Block C 80-100
//   Block D 101.24-130      (1.24s after C: OUT/IN collision on V7/V8 -> IN must stack to V9)
//   Block E 140-150, F 150.3-170 (0.3s gap: video collision AND whoosh collision -> A4 is music -> A5)
//   Block G 300-310
function buildTimeline({ withTemplates = true } = {}) {
  const tl = new Timeline({ videoTracks: 9, audioTracks: 7, fps: 30 });
  [[0, 7.2], [7.2, 12.9], [20.13, 40], [40, 60], [80, 100], [101.24, 130], [140, 150], [150.3, 170], [300, 310]]
    .forEach(([s, e]) => tl.addV(4, s, e, "main"));
  if (withTemplates) {
    // OUT template: 2.2s adjustment layers on V7+V8 (hit 0.83s in) + 0.53s whoosh starting 0.23s before the hit
    tl.addV(7, 12.07, 14.27, "out-v7"); tl.addV(8, 12.07, 14.27, "out-v8"); tl.addA(3, 12.67, 13.2, "out-sfx");
    // IN template: one adjustment layer on V7 + 0.23s whoosh
    tl.addV(7, 19.3, 21.5, "in-v7"); tl.addA(3, 20.03, 20.26, "in-sfx");
  }
  tl.addA(4, 140, 160, "music"); // forces the F-IN whoosh down past A4
  return tl;
}

const OUT = { v: [-0.83, 1.37], a: [-0.23, 0.3] };   // relative to the edge
const IN = { v: [-0.83, 1.37], a: [-0.1, 0.13] };

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  PASS", name); }
  catch (e) { failed++; console.log("  FAIL", name, "\n       ", e.message); }
}

(async () => {
  console.log("Transition Stamper: simulated tests\n");

  await test("scan finds blocks, edges and templates", async () => {
    const tl = buildTimeline();
    const p = await boot(tl);
    assert.match(p.els.summary.textContent, /Found 7 A-roll blocks: 7 IN \+ 7 OUT edges\. 2 already have a transition\./);
    assert.strictEqual(p.els.tplIn.options.length, 1);
    assert.strictEqual(p.els.tplOut.options.length, 1);
    assert.match(p.els.tplIn.options[0].textContent, /00:00:20:04.*V7 \+ A3/);   // 20.13s @30fps = 20:04
    assert.match(p.els.tplOut.options[0].textContent, /00:00:12:27.*V7 \+ V8 \+ A3/);
  });

  await test("preview plans the right stamps and changes NOTHING", async () => {
    const tl = buildTimeline();
    const p = await boot(tl);
    const before = tl.snapshot();
    await p.click("preview");
    assert.strictEqual(tl.snapshot(), before, "preview mutated the timeline");
    assert.strictEqual(tl.transactions, 0);
    assert.match(p.els.summary.textContent, /Ready to stamp 11 transitions \(5 IN, 6 OUT\)\./);
    assert.match(p.els.details.textContent, /moved to free tracks/);
    assert.match(p.els.details.textContent, /IN @00:01:41:07: V7->V9/);      // 101.24s
    assert.match(p.els.details.textContent, /IN @00:02:30:09: V7->V9, A3->A5/); // 150.3s: video up, whoosh down past the music
    assert.match(p.els.details.textContent, /before the timeline does/);      // intro edge at 0s
  });

  await test("stamp: correct counts per lane, no overlaps, no errors", async () => {
    const tl = buildTimeline();
    const p = await boot(tl);
    await p.click("stamp");
    assert.deepStrictEqual(tl.errors, [], "clone errors: " + tl.errors.join("; "));
    assert.deepStrictEqual(tl.overlaps(), [], "overlapping clips");
    assert.strictEqual(tl.transactions, 1, "should be ONE transaction (one Ctrl+Z)");
    assert.strictEqual(tl.count("V", 7), 2 + 3 + 6);  // 2 existing + 3 IN (5 minus 2 stacked) + 6 OUT
    assert.strictEqual(tl.count("V", 8), 1 + 6);
    assert.strictEqual(tl.count("V", 9), 2);          // the two stacked INs
    assert.strictEqual(tl.count("A", 3), 2 + 4 + 6);  // 4 IN whooshes stayed (one slid down) + 6 OUT
    assert.strictEqual(tl.count("A", 4), 1);          // music untouched
    assert.strictEqual(tl.count("A", 5), 1);          // the slid whoosh
    assert.match(p.els.summary.textContent, /Stamped 11 transitions \(5 IN, 6 OUT\)/);
    assert.doesNotMatch(p.els.summary.textContent, /Warning/);
  });

  await test("stamp: every clone sits exactly where its template puts it (hit point on the edge)", async () => {
    const tl = buildTimeline();
    const p = await boot(tl);
    await p.click("stamp");
    const has = (kind, track, start, len) => tl.items(kind, track).some((i) => Math.abs(i.start - start) < 1e-6 && Math.abs(i.end - i.start - len) < 1e-6);
    const outs = [60, 100, 130, 150, 170, 310], ins = [80, 101.24, 140, 150.3, 300];
    for (const e of outs) {
      assert.ok(has("V", 7, e + OUT.v[0], 2.2), `OUT V7 @${e}`);
      assert.ok(has("V", 8, e + OUT.v[0], 2.2), `OUT V8 @${e}`);
      assert.ok(has("A", 3, e + OUT.a[0], 0.53), `OUT sfx @${e}`);
    }
    // INs: video on V7, except the two collisions which live on V9
    for (const e of ins) {
      const stacked = e === 101.24 || e === 150.3;
      assert.ok(has("V", stacked ? 9 : 7, e + IN.v[0], 2.2), `IN video @${e}`);
      const sfxLane = e === 150.3 ? 5 : 3;
      assert.ok(has("A", sfxLane, e + IN.a[0], 0.23), `IN sfx @${e} on A${sfxLane}`);
    }
  });

  await test("stamp leaves existing transitions, inner cuts and the 0s edge alone", async () => {
    const tl = buildTimeline();
    const p = await boot(tl);
    const origV7 = tl.items("V", 7).map((i) => i.start);
    await p.click("stamp");
    origV7.forEach((s) => assert.ok(tl.items("V", 7).some((i) => Math.abs(i.start - s) < 1e-6), "existing V7 clip moved @" + s));
    // inner cuts at 7.2 and 40 must have no transition around them (hit would start at cut-0.83)
    [7.2, 40].forEach((c) => assert.ok(!tl.items("V", 7).some((i) => Math.abs(i.start - (c - 0.83)) < 1e-6), "stamped an inner cut @" + c));
    assert.ok(!tl.items("V", 7).some((i) => i.start < 0), "something before 0s");
    assert.ok(!tl.items("V", 7).some((i) => Math.abs(i.start - -0.83) < 1e-6), "stamped the 0s edge");
  });

  await test("running again after a stamp finds nothing left to do", async () => {
    const tl = buildTimeline();
    const p = await boot(tl);
    await p.click("stamp");
    const after = tl.snapshot();
    await p.click("preview");
    assert.match(p.els.summary.textContent, /Nothing to stamp\./);
    assert.strictEqual(tl.snapshot(), after);
  });

  await test("no templates on the timeline gives a clear message, not a crash", async () => {
    const tl = buildTimeline({ withTemplates: false });
    const p = await boot(tl);
    await p.click("preview");
    assert.match(p.els.summary.textContent, /No template transitions found/);
    assert.strictEqual(tl.transactions, 0);
  });

  await test("a single hand-built IN only (no OUT template) stamps INs and reports the OUTs as skipped", async () => {
    const tl = buildTimeline();
    tl.video[6] = tl.video[6].filter((i) => i.name !== "out-v7");
    tl.video[7] = []; tl.audio[2] = tl.audio[2].filter((i) => i.name !== "out-sfx");
    const p = await boot(tl);
    await p.click("preview");
    assert.match(p.els.summary.textContent, /Ready to stamp \d+ transitions/);
    assert.match(p.els.details.textContent, /OUT @.*no template picked/);
  });

  await test("a track layout without enough free video tracks skips instead of crashing", async () => {
    const tl = new Timeline({ videoTracks: 8, audioTracks: 7, fps: 30 }); // no V9 to stack onto
    [[0, 12.9], [20.13, 60], [80, 100], [101.24, 130]].forEach(([s, e]) => tl.addV(4, s, e, "main"));
    tl.addV(7, 12.07, 14.27); tl.addV(8, 12.07, 14.27); tl.addA(3, 12.67, 13.2);
    tl.addV(7, 19.3, 21.5); tl.addA(3, 20.03, 20.26);
    const p = await boot(tl);
    await p.click("stamp");
    assert.deepStrictEqual(tl.errors, []);
    assert.deepStrictEqual(tl.overlaps(), []);
    assert.match(p.els.details.textContent, /no free track/);
  });

  await test("bridge: scan/preview work and write log.txt + bridge-result.json", async () => {
    const tl = buildTimeline();
    const p = await boot(tl);
    await p.devOn();
    await p.bridge({ id: "t1", action: "preview" });
    assert.match(p.files.get("log.txt"), /to stamp: 11 \(5 IN, 6 OUT\)/);
    const r = JSON.parse(p.files.get("bridge-result.json"));
    assert.strictEqual(r.id, "t1"); assert.strictEqual(r.status, "ok");
    assert.ok(!p.files.has("cmd.json"), "cmd.json should be consumed");
    assert.strictEqual(tl.transactions, 0);
  });

  await test("bridge: stamp is REFUSED unless the box is ticked", async () => {
    const tl = buildTimeline();
    const p = await boot(tl);
    await p.devOn();
    const before = tl.snapshot();
    await p.bridge({ id: "t2", action: "stamp" });
    assert.strictEqual(JSON.parse(p.files.get("bridge-result.json")).status, "refused");
    assert.strictEqual(tl.snapshot(), before, "bridge stamped without permission");
    p.els.allowBridgeStamp.checked = true;
    await p.bridge({ id: "t3", action: "stamp" });
    assert.strictEqual(JSON.parse(p.files.get("bridge-result.json")).status, "ok");
    assert.strictEqual(tl.transactions, 1);
  });

  await test("bridge: unknown action / bad JSON do not crash or touch the timeline", async () => {
    const tl = buildTimeline();
    const p = await boot(tl);
    await p.devOn();
    const before = tl.snapshot();
    await p.bridge({ id: "t4", action: "format-c-drive" });
    assert.strictEqual(JSON.parse(p.files.get("bridge-result.json")).status, "error");
    p.files.set("cmd.json", "{not json");
    await p.bridge("x");
    assert.strictEqual(tl.snapshot(), before);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
