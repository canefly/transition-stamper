# Building and sharing a release

## 1. Bump the version, then build

Set `"version"` in the root `manifest.json` (major.minor.patch). That is the one place to bump it. Then:

```
node scripts/build-release.js
```

This writes two things, both git-ignored:

- `dist/transition-stamper/` with only `manifest.json`, `index.html` and `index.js`
- `releases/com.stamper.cane_<version>_premierepro.ccx`, the finished, installable package

A `.ccx` is a plain zip of those three files at the top level, so the script writes it directly. **No UXP Developer Tool is needed to package.** UDT is only for development (Load & Watch).

The release manifest differs from the dev one (see `scripts/build-release.js`):

| | dev (`manifest.json`) | release (`dist/`, the `.ccx`) |
| --- | --- | --- |
| plugin id | `com.stamper.transitionspike` | `com.stamper.cane` |
| version | from `manifest.json` | the same number |
| `host.minVersion` | `25.6.0` | `26.0.0` (Premiere 2026) |
| permissions | clipboard + file access (dev log/bridge) | none |

Adobe's guidance: keep the id **stable across updates**; changing it later makes installs look like a different plugin. The id and minimum Premiere version are constants at the top of the script.

## 2. Check it, then publish

1. Install it yourself first (next section) and look at **About**: it shows the installed version.
2. Commit, push, and tag the release commit (`v<version>`).
3. Create a GitHub Release for that tag and attach the `.ccx`:

```
gh release create v<version> releases/com.stamper.cane_<version>_premierepro.ccx --title "Transition Stamper <version>" --notes-file <notes.md>
```

(UDT can still package a `.ccx` too: **Add Plugin** on `dist/transition-stamper/manifest.json`, then **•••** > **Package**. If you do, remove and re-add the plugin after changing the manifest; UDT may reuse the one it saw when you added it.)

## 3. Install it (editor's machine)

1. Double-click the `.ccx`. Adobe's installer agent takes over (the Creative Cloud window may or may not show anything).
2. If a warning about packages from outside the Marketplace appears, choose **Install**.
3. In Premiere: **Window > UXP Plugins > Transition Stamper**. A restart wasn't needed in our tests; if the panel isn't listed, restart Premiere.

End users do **not** need Premiere's developer mode; that is only for loading unpackaged plugins from UDT. Administrative privileges may be requested.

### What the install actually does

(An editor-facing version of these steps, including the command-line option, is in [install.md](install.md).)

Double-clicking a `.ccx` is handled by Adobe's **Unified Plugin Installer Agent (UPIA)**, a background component that ships with Creative Cloud, not by the Creative Cloud app window itself. So the install can succeed even when the Creative Cloud app shows nothing about it (a friend's machine did exactly that).

On Windows it unpacks the plugin into `%APPDATA%\Adobe\UXP\Plugins\External\com.stamper.cane_<version>\` and registers it in `%APPDATA%\Adobe\UXP\PluginsInfo\v1\premierepro.json` (status `enabled`, with the plugin's minimum Premiere version). Premiere picks that up without a restart in our tests. No admin rights were needed on the developer's machine.

To install without opening anything, run the installer agent directly (PowerShell):

```
& "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "C:\path\to\com.stamper.cane_premierepro.ccx"
```

Copying files into the `External` folder by hand is **not** supported: the plugin also has to be registered in `premierepro.json`. The agent only exists on machines with Creative Cloud components installed, which any Premiere installed through Creative Cloud has.

Updating: build a new version with a higher `version`, package it with the same id, and install it over the old one.

## Verified

- **A `.ccx` written by `scripts/build-release.js` (no UDT) installs** over a previous version with the installer agent: it printed `Installation Successful`, the old version's folder was replaced, and Premiere's plugin list showed the new version enabled (2026-11-25, 0.1.1 over 0.1.0).
- **Install on a second machine** (a friend's): the `.ccx` went through Creative Cloud Desktop and installed (2026-11-25).
- **Uninstall and command-line reinstall** (developer's machine, 2026-11-25): uninstalling from the Creative Cloud app removed the plugin folder and its `premierepro.json` entry; then `UnifiedPluginInstallerAgent.exe /install` printed `Installation Successful`, the Creative Cloud app listed the plugin as installed (version 0.1.0), and the panel loaded in Premiere.

## Not yet verified

- Exact Premiere 2026 build numbers it has been tried on (the author reports it works on 2026; the build wasn't recorded), and anything older than 26.0.
- Whether Creative Cloud Desktop's "outside Marketplace" warning needs anything beyond clicking Install.
