# Facet — a context-aware Stream Deck companion for SolidWorks

Facet puts the *right* SolidWorks commands under your fingers on a Stream Deck, and changes
what's on the deck **automatically** as your context in SolidWorks changes. Enter a sketch and
the deck becomes sketch tools; open a drawing and it becomes drafting tools. Less "where is
that button," more getting your vision into the program.

> **Targets:** Stream Deck MK.2 (15 keys) · SolidWorks 2024+ · Windows.
> Working product name **Facet** — easy to rebrand.

## How it fits together

Two processes, bridged by a private local WebSocket:

```
SolidWorks 2024+  ──(COM/STA)──►  Facet.AddIn  ──ws://localhost──►  Facet plugin  ──►  Stream Deck
   context engine  ▲                  server                          client (Node)       MK.2
   command runner  └──────────────────── keyDown ◄───────────────────────┘
```

- **`addin/`** — C#/.NET Framework 4.8 COM add-in (`ISwAddin`). Watches SolidWorks context via
  events, hosts the WebSocket server, and runs commands via `ISldWorks.RunCommand`. Compiles
  on a machine with SolidWorks 2024+ installed.
- **`plugin/`** — Node.js/TypeScript Stream Deck plugin (`@elgato/streamdeck`). Connects to the
  add-in, repaints the 15 keys per context, forwards key presses.
- **`shared/`** — the contract both halves obey: `protocol.md` (messages), `catalog.json`
  (context → key → command map, the single source of truth), `design-tokens.json`.
- **`tools/`** — `mock-addin.mjs`, a stand-in add-in server so the whole deck experience is
  testable **without** SolidWorks.
- **`installer/`**, **`docs/`** — packaging and documentation.

## Quick start

Develop the deck experience without SolidWorks:

```bash
cd plugin && npm install && npm run build      # build the plugin
node ../tools/mock-addin.mjs                    # fake SolidWorks context feed
```

See **[docs/RUN.md](docs/RUN.md)** for the full run + build-on-SolidWorks-workstation steps.

## Installer

`installer/` builds a single **`Facet-Setup.exe`** that installs both halves and COM-registers
the add-in. Build it with `pwsh installer\build.ps1` (needs a SolidWorks 2024+ machine + Inno
Setup). See **[installer/README.md](installer/README.md)**.

## Status

Working end to end: the add-in loads in SolidWorks, the deck follows context
(Part / Sketch / Assembly / Drawing / selection), command keys fire real SolidWorks
commands with ✓/⚠ feedback, New Part/Assembly/Drawing create documents, and a bundled
profile auto-fills the 15 keys.

## Known limitations

- **Home (top-left) and More (bottom-right) keys are placeholders** — navigation/overflow
  pages aren't implemented yet, so 2 of 15 keys are inert per layout.
- **Toggle keys don't show on/off state** — Section, Construction, Hide/Show, Transparency,
  and Edit Sheet look the same whether active or not (the add-in doesn't report toggle state yet).
- **MK.2 (5×3) only** — other Stream Deck models (XL, Mini, +, Neo) aren't supported yet.
- **Selection overlay is Part-only** (`part.selection`); assembly/drawing selection variants TBD.
- **Single SolidWorks version per build** — the interop assemblies are copied locally, pinning a
  built installer to the SolidWorks version of the build machine (see `installer/README.md`).
