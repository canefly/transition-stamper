# Building and sharing a release

## 1. Build the release folder

```
node scripts/build-release.js
```

This writes `dist/transition-stamper/` (git-ignored) containing only `manifest.json`, `index.html` and `index.js`. The release manifest differs from the dev one in `scripts/build-release.js`:

| | dev (`manifest.json`) | release (`dist/`) |
| --- | --- | --- |
| plugin id | `com.stamper.transitionspike` | `com.stamper.cane` |
| version | `0.0.1` | `0.1.0` |
| `host.minVersion` | `25.6.0` | `27.0.0` (only version tested) |
| permissions | clipboard + file access (dev log/bridge) | none |

Adobe's guidance: set the id before packaging and keep it **stable across updates**. Changing it later makes installs look like a different plugin. Edit the constants at the top of the script to change the id, version or minimum Premiere version.

## 2. Package it as a .ccx (UDT)

1. UXP Developer Tool > **Add Plugin** > choose `dist/transition-stamper/manifest.json`.
2. On that plugin's row, open the **•••** menu > **Package**, and choose an output folder.
3. UDT writes a `.ccx` named from the plugin id. (The plugin does not need to be loaded in Premiere.) A red notification with **Details** means packaging failed; read the log there.

## 3. Install it (editor's machine)

1. Double-click the `.ccx`. Creative Cloud Desktop opens.
2. Review the warning about packages from outside the Marketplace and choose **Install**.
3. In Premiere: **Window > UXP Plugins > Transition Stamper**.

End users do **not** need Premiere's developer mode; that is only for loading unpackaged plugins from UDT. Administrative privileges may be requested. The command-line alternative is the Unified Plugin Installer Agent (`UnifiedPluginInstallerAgent.exe /install <path>` on Windows).

Updating: build a new version with a higher `version`, package it with the same id, and install it over the old one.

## Not yet verified

- Install on a machine other than the developer's.
- Behaviour on Premiere older than 27.0.
- Whether Creative Cloud Desktop's "outside Marketplace" warning needs anything beyond clicking Install.
