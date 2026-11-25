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
| `host.minVersion` | `25.6.0` | `26.0.0` (Premiere 2026; tested by the author on 27.0 and on Premiere 2026) |
| permissions | clipboard + file access (dev log/bridge) | none |

Adobe's guidance: set the id before packaging and keep it **stable across updates**. Changing it later makes installs look like a different plugin. Edit the constants at the top of the script to change the id, version or minimum Premiere version.

## 2. Package it as a .ccx (UDT)

1. UXP Developer Tool > **Add Plugin** > choose `dist/transition-stamper/manifest.json`.
2. On that plugin's row, open the **•••** menu > **Package**, and choose an output folder.
3. UDT writes a `.ccx` named from the plugin id. (The plugin does not need to be loaded in Premiere.) A red notification with **Details** means packaging failed; read the log there.

## 3. Install it (editor's machine)

1. Double-click the `.ccx`. Adobe's installer agent takes over (the Creative Cloud window may or may not show anything).
2. If a warning about packages from outside the Marketplace appears, choose **Install**.
3. Restart Premiere if it was open. Then: **Window > UXP Plugins > Transition Stamper**.

End users do **not** need Premiere's developer mode; that is only for loading unpackaged plugins from UDT. Administrative privileges may be requested.

### What the install actually does

(An editor-facing version of these steps, including the command-line option, is in [install.md](install.md).)

Double-clicking a `.ccx` is handled by Adobe's **Unified Plugin Installer Agent (UPIA)**, a background component that ships with Creative Cloud, not by the Creative Cloud app window itself. So the install can succeed even when the Creative Cloud app shows nothing about it (a friend's machine did exactly that).

On Windows it unpacks the plugin into `%APPDATA%\Adobe\UXP\Plugins\External\com.stamper.cane_<version>\` and registers it in `%APPDATA%\Adobe\UXP\PluginsInfo\v1\premierepro.json` (status `enabled`, with the plugin's minimum Premiere version). Premiere reads that file at startup. No admin rights were needed on the developer's machine.

To install without opening anything, run the installer agent directly (PowerShell):

```
& "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "C:\path\to\com.stamper.cane_premierepro.ccx"
```

Copying files into the `External` folder by hand is **not** supported: the plugin also has to be registered in `premierepro.json`. The agent only exists on machines with Creative Cloud components installed, which any Premiere installed through Creative Cloud has.

Updating: build a new version with a higher `version`, package it with the same id, and install it over the old one.

## Verified

- **Install on a second machine** (a friend's): the `.ccx` went through Creative Cloud Desktop and installed (2026-11-25).
- **Uninstall and command-line reinstall** (developer's machine, 2026-11-25): uninstalling from the Creative Cloud app removed the plugin folder and its `premierepro.json` entry; then `UnifiedPluginInstallerAgent.exe /install` printed `Installation Successful`, the Creative Cloud app listed the plugin as installed (version 0.1.0), and the panel loaded in Premiere.

## Not yet verified

- Exact Premiere 2026 build numbers it has been tried on (the author reports it works on 2026; the build wasn't recorded), and anything older than 26.0.
- Whether Creative Cloud Desktop's "outside Marketplace" warning needs anything beyond clicking Install.
