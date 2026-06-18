# Running Facet

Two halves: the **plugin** (Node, runs anywhere with the Stream Deck app) and the **add-in**
(C# COM, builds + runs on a SolidWorks 2026 workstation). You can develop and demo the entire
deck experience using the **mock add-in** — no SolidWorks required.

---

## A. Develop the deck experience without SolidWorks

Requirements: Node 20+, the Stream Deck desktop app (6.5+), an MK.2 (or the SD app's virtual
device), and the Elgato CLI (`npm i -g @elgato/cli`).

```bash
# 1. Build the plugin
cd plugin
npm install
npm run build                 # → com.swrobotics.facet.sdPlugin/bin/plugin.js

# 2. Install it into the Stream Deck app (symlinks the dev folder)
streamdeck link com.swrobotics.facet.sdPlugin
streamdeck restart com.swrobotics.facet

# 3. In the Stream Deck app, drag the "Facet Key" action onto all 15 keys.
#    (A bundled profile that does this automatically lands in the Phase 3 polish pass.)

# 4. In a second terminal, play SolidWorks:
cd ../tools
npm install
node mock-addin.mjs            # interactive — press p/s/a/d/x/n to switch context
#   or: node mock-addin.mjs --auto   to cycle automatically
```

You should see the deck repaint as you switch contexts (Part → Sketch → Assembly → Drawing),
and pressing a command key logs an `invoke` in the mock terminal and flashes ✓ on the key.

`npm run watch` in `plugin/` rebuilds + restarts the plugin on save.

---

## B. Build + register the add-in on a SolidWorks 2026 workstation

Requirements: SolidWorks 2026 installed, .NET SDK (or MSBuild/Visual Studio), admin rights for
COM registration.

```powershell
cd addin

# Build (override SolidWorksPath if not installed at the default location)
dotnet build -c Release
#   e.g. dotnet build -c Release -p:SolidWorksPath="D:\Apps\SOLIDWORKS Corp\SOLIDWORKS"

# Register for COM (run this terminal as Administrator)
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe /codebase `
  bin\x64\Release\net48\Facet.AddIn.dll

# To unregister later:
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe /unregister `
  bin\x64\Release\net48\Facet.AddIn.dll
```

Then launch SolidWorks → **Tools ▸ Add-Ins** → confirm **Facet** is listed and checked. The
add-in starts its WebSocket server on `ws://127.0.0.1:8723`. Start the plugin (section A, steps
1–3) and it connects automatically. Diagnostic log: `%TEMP%\Facet.log`.

> The add-in references the interop DLLs from `…\SOLIDWORKS\api\redist` with
> *Embed Interop Types = false*, targets **.NET Framework 4.8 / x64**, and writes its load keys
> under `HKLM\SOFTWARE\SolidWorks\AddIns` + `HKCU\…\AddInsStartup` via its
> `[ComRegisterFunction]`.

---

## C. Phase 0 acceptance demo

With the add-in registered and the plugin connected:

1. **Open a part** → deck shows the Part layout.
2. **Start a sketch** → deck flips to Sketch tools.
3. Press **Circle**, then **Exit Sketch** → SolidWorks runs each command; deck returns to Part.
4. **Select an edge** → Fillet/Chamfer promote to the front (`part.selection` layout).
5. Open an **assembly**, then a **drawing** → deck repaints to each context automatically.
6. **Quit SolidWorks** → deck shows "Start SolidWorks to begin"; relaunch → it reconnects.

> Command IDs in `shared/catalog.json` are best-effort `swCommands_e` names and are validated
> live in Phase 2 (since `RunCommand` opens the real UI, any wrong id simply no-ops and flashes
> ⚠ — easy to spot and correct).

---

## Troubleshooting

- **Plugin shows "Looking for SolidWorks…" forever** — the add-in isn't running or its port is
  blocked. Check `%TEMP%\Facet.log` for the bound port; the plugin scans 8723–8733.
- **A key flashes ⚠ instead of running** — that command's `swCommands_e` id needs correcting in
  `shared/catalog.json` (rebuild the plugin after editing).
- **Add-in missing from Tools ▸ Add-Ins** — re-run RegAsm as admin; confirm x64 RegAsm and that
  the build is x64.
