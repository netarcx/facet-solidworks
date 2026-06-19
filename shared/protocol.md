# Facet wire protocol (v1)

A tiny JSON message protocol over a single local WebSocket. The **SolidWorks add-in is the
server** (`ws://127.0.0.1:<port>`); the **Stream Deck plugin is the client**. The add-in owns
the longer lifecycle and the source of truth, so the plugin connects out and reconnects.

Every message is a single JSON object with a `type` field. Unknown `type`s are ignored
(forward-compatibility). All messages carry `v: 1`.

## Discovery

The add-in listens on a **fixed primary port `8723`** (fallback scan `8723–8733`). The plugin
tries each port in order until a `hello` is received. The port the add-in actually bound is
echoed in `hello.port` for logging.

---

## Add-in → plugin

### `hello` — sent immediately on connect
```json
{ "v": 1, "type": "hello", "app": "SolidWorks", "appVersion": "33.5.0", "port": 8723,
  "protocol": 1, "addinVersion": "0.1.0" }
```

### `context` — the live SolidWorks context; sent on every change (coalesced ≤ 20 Hz)
```json
{ "v": 1, "type": "context",
  "docType": "part",                 // none | part | assembly | drawing
  "inSketch": false,                 // true while editing a sketch
  "activeCommand": null,             // swCommands_e name of the open tool/PMP, or null
  "selection": { "count": 1, "types": ["edge"] },  // summarized selection
  "docTitle": "bracket.SLDPRT",
  "layout": "part"                   // resolved layout key the plugin should show
}
```
The add-in resolves `layout` (the catalog key) so layout policy lives in one place. Order of
precedence: `inSketch` → `sketch`; else by `docType`; selection may promote an overlay variant
(e.g. `part.selection`). The plugin just renders `catalog[layout]`.

### `result` — feedback for a prior `invoke`
```json
{ "v": 1, "type": "result", "nonce": "abc123", "ok": true, "message": null }
```
`ok:true` → plugin flashes ✓ (`showOk`); `ok:false` → plugin flashes ⚠ (`showAlert`) with
optional `message`.

---

## Plugin → add-in

### `ready` — sent after the plugin processes `hello`
```json
{ "v": 1, "type": "ready", "device": "streamdeck_mk2", "pluginVersion": "0.1.0" }
```

### `invoke` — a key was pressed; run the bound command
```json
{ "v": 1, "type": "invoke", "nonce": "abc123",
  "command": "swCommands_Extrude",   // catalog binding's swCommand
  "commandId": null,                  // optional raw int id (fallback when no enum name)
  "slot": 6, "layout": "part" }       // for logging / future analytics
```
The add-in marshals onto the SolidWorks STA thread and calls
`ISldWorks.RunCommand(id, "")`, then replies with `result` (matched by `nonce`).

---

## Connection lifecycle

- Plugin connects → add-in sends `hello` → plugin sends `ready` → add-in sends initial
  `context`.
- If the socket drops, the plugin shows a neutral **"waiting for SolidWorks"** state and
  retries every 2 s (and on Stream Deck `systemDidWakeUp`).
- The add-in pushes a fresh `context` whenever SolidWorks state changes; the plugin never polls.
