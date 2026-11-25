// Builds the release copy of the plugin into dist/transition-stamper/
//   node scripts/build-release.js
//
// What differs from the dev copy (manifest.json in the repo root):
//   - a separate, stable plugin id, so it never collides with the dev copy loaded from UDT
//   - a real version number
//   - host.minVersion set to what we have actually tested
//   - NO requiredPermissions: dev mode's file access (log.txt / cmd.json) is not shipped.
//     index.js already catches that failure silently, so the panel just works without it.
// Only manifest.json, index.html and index.js are copied. Docs, scripts and git stuff stay out.

const fs = require("fs");
const path = require("path");

const OPTIONS = {
  id: "com.stamper.cane",   // keep this stable across updates; Adobe: set it before packaging
  version: "0.1.0",         // major.minor.patch
  minVersion: "27.0.0",     // only 27.0 has been tested; widen once an older Premiere has been tried
};

const root = path.join(__dirname, "..");
const out = path.join(root, "dist", "transition-stamper");

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
manifest.id = OPTIONS.id;
manifest.version = OPTIONS.version;
manifest.host = { app: "premierepro", minVersion: OPTIONS.minVersion }; // a .ccx targets exactly one host
delete manifest.requiredPermissions;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ["index.html", "index.js"]) fs.copyFileSync(path.join(root, f), path.join(out, f));
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log("Release folder:", out);
console.log(`  id ${manifest.id} | version ${manifest.version} | Premiere ${manifest.host.minVersion}+ | permissions: none`);
console.log("Next: UDT > Add Plugin > this folder's manifest.json > ... > Package");
