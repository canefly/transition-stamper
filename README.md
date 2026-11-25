# Transition Stamper

A Premiere Pro panel that stamps your hand-built transition onto every cut in a video that needs one, in one click. Built for documentary-style edits with 50 to 200+ transitions per video.

You build **one IN** and **one OUT** transition by hand (adjustment layers with keyframes, plus a whoosh SFX). Transition Stamper copies them, with their keyframes and SFX, to the start and end of every block of main footage, and undoes in a single Ctrl+Z.

## Status

Working in Premiere Pro 27.0 on real projects (up to 75 transitions stamped at once, 30 and 29.97 fps). Installable as a `.ccx` (Premiere 2026 / 26.0 and newer); see [the install guide](docs/install.md). Version history is in [CHANGELOG.md](CHANGELOG.md).

### Known limitation: stamped transitions aren't linked

Hand-built transitions often have the whoosh linked to the adjustment layer so they move together. Stamped copies come out as separate, **unlinked** clips, because Premiere's plugin API has no way to link clips. The timing is right; to move one transition as a unit, marquee-select across its tracks (or press Ctrl+L on its clips). Details in [docs/decisions.md](docs/decisions.md).

## Quick start (development)

1. Premiere Pro 27.0: **Settings > Plugins > Enable developer mode**, then restart Premiere.
2. Install **Adobe UXP Developer Tool (UDT)** from Creative Cloud.
3. UDT: **Add Plugin** and choose `manifest.json` in this folder, then **Load & Watch**.
4. Premiere: **Window > UXP Plugins > Transition Stamper**.
5. Fill in your three tracks, pick your IN and OUT, **Rescan**, **Stamp all edges**, confirm.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Docs

- [Installing it (for editors)](docs/install.md)
- [What it does and why](docs/overview.md)
- [Tech stack](docs/tech-stack.md)
- [Development workflow](docs/development.md)
- [Decisions, findings and known limits](docs/decisions.md)
- [Building and sharing a release (.ccx)](docs/release.md)
- [Original handoff notes](CONTEXT.md) (how the project started)
