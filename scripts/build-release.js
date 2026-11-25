// Builds the release of the plugin: a folder AND the finished .ccx package.
//   node scripts/build-release.js
//
//   dist/transition-stamper/                       the release files (manifest.json, index.html, index.js)
//   releases/com.stamper.cane_<version>_premierepro.ccx   the installable package (a .ccx is a plain zip)
//
// What differs from the dev copy (manifest.json in the repo root):
//   - a separate, stable plugin id, so it never collides with the dev copy loaded from UDT
//   - host.minVersion set to the oldest Premiere we are willing to support (see OPTIONS below)
//   - NO requiredPermissions: dev mode's file access (log.txt / cmd.json) is not shipped.
//     index.js already catches that failure silently, so the panel just works without it.
// The version comes from the root manifest.json (one place to bump it).
// Only manifest.json, index.html and index.js go in. Docs, scripts and git stuff stay out.
// No UXP Developer Tool is needed to package. UDT is only for development.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OPTIONS = {
  id: "com.stamper.cane",   // keep this stable across updates; Adobe: set it before packaging
  minVersion: "26.0.0",     // Premiere 2026
};

const root = path.join(__dirname, "..");
const out = path.join(root, "dist", "transition-stamper");
const releases = path.join(root, "releases");

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
manifest.id = OPTIONS.id;
manifest.host = { app: "premierepro", minVersion: OPTIONS.minVersion }; // a .ccx targets exactly one host
delete manifest.requiredPermissions;
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("manifest version must be major.minor.patch, got " + manifest.version);

// ---- release folder ----
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ["index.html", "index.js"]) fs.copyFileSync(path.join(root, f), path.join(out, f));
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// ---- .ccx (zip) ----
// Same layout UDT produces: the three files at the top level, deflate-compressed, manifest first.
function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
function makeZip(files) {
  const { time, date } = dosDateTime(new Date());
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const data = fs.readFileSync(path.join(out, f.name));
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data) >>> 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);   // local file header
    lh.writeUInt16LE(20, 4);           // version needed
    lh.writeUInt16LE(0, 6);            // flags
    lh.writeUInt16LE(8, 8);            // method: deflate
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);           // extra length
    parts.push(lh, name, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);   // central directory header
    ch.writeUInt16LE(20, 4);           // version made by
    ch.writeUInt16LE(20, 6);           // version needed
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    // extra, comment, disk, internal attrs, external attrs: all zero
    ch.writeUInt32LE(offset, 42);      // offset of the local header
    central.push(ch, name);

    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

fs.mkdirSync(releases, { recursive: true });
const ccxPath = path.join(releases, `${OPTIONS.id}_${manifest.version}_premierepro.ccx`);
fs.writeFileSync(ccxPath, makeZip([{ name: "manifest.json" }, { name: "index.html" }, { name: "index.js" }]));

console.log("Release folder:", out);
console.log("Package:       ", ccxPath, `(${fs.statSync(ccxPath).size} bytes)`);
console.log(`  id ${manifest.id} | version ${manifest.version} | Premiere ${manifest.host.minVersion}+ | permissions: none`);
console.log("Install it by double-clicking the .ccx, or see docs/install.md for the command-line way.");
