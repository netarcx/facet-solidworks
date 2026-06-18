# Facet — a context-aware Stream Deck companion for SolidWorks

Facet puts the *right* SolidWorks commands under your fingers on a Stream Deck, and changes
what's on the deck **automatically** as your context in SolidWorks changes. Enter a sketch and
the deck becomes sketch tools; open a drawing and it becomes drafting tools. Less "where is
that button," more getting your vision into the program.

> **Targets:** Stream Deck MK.2 (15 keys) · SolidWorks 2026 · Windows.
> Working product name **Facet** — easy to rebrand.

## How it fits together

Two processes, bridged by a private local WebSocket:

```
SolidWorks 2026  ──(COM/STA)──►  Facet.AddIn  ──ws://127.0.0.1──►  Facet plugin  ──►  Stream Deck
   context engine  ▲                  server                          client (Node)       MK.2
   command runner  └──────────────────── keyDown ◄───────────────────────┘
```

- **`addin/`** — C#/.NET Framework 4.8 COM add-in (`ISwAddin`). Watches SolidWorks context via
  events, hosts the WebSocket server, and runs commands via `ISldWorks.RunCommand`. Compiles
  on a machine with SolidWorks 2026 installed.
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
the add-in. Build it with `pwsh installer\build.ps1` (needs a SolidWorks 2026 machine + Inno
Setup). See **[installer/README.md](installer/README.md)**.

## Status

Phase 0 — handshake & foundations. See the project plan for the full roadmap.
