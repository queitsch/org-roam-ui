# AGENTS.md — notes for coding agents working on org-roam-ui

## What this repo is

A Next.js 11 / React 17 frontend (plus a small Emacs package, `org-roam-ui.el`) that
visualizes an org-roam note graph with `react-force-graph`. The Emacs side serves the
**static export in `out/`** over `simple-httpd` on port **35901** and pushes graph data,
theme, and commands over a websocket on port **35903** (`ws://localhost:35903`). The
frontend is a static SPA: all data arrives via that websocket, so a dev build served from
any port still talks to the running Emacs.

**Gotcha:** an installed org-roam-ui Emacs package (e.g. `~/.emacs.d/elpa/org-roam-ui-*/`)
serves *its own copy* of `out/`, not this repo's. Rebuilding this repo does **not** change
what `http://localhost:35901/` serves unless Emacs's `org-roam-ui-app-build-dir` points at
this repo's `out/` (or you copy `out/` into the installed package). For quick testing,
serve this repo's `out/` on another port (`python3 -m http.server 35911 -d out`) — the app
still connects to Emacs's websocket on 35903. CORS from any `http://localhost:*` origin is
accepted by Ollama by default.

## Building (2026, Node 26)

- This is a **yarn** project (`yarn.lock` is authoritative; `package-lock.json` is stale —
  `npm ci` fails with ERESOLVE/out-of-sync errors). Without yarn installed, use
  `npx yarn@1 install --frozen-lockfile --ignore-engines`.
- Webpack in Next 11 uses MD4; on modern Node you must set
  `NODE_OPTIONS=--openssl-legacy-provider` for `yarn build` / `yarn export`.
- Full pipeline: `tsc --noEmit` (use `./node_modules/.bin/tsc`, not `npx tsc`), then
  `build`, then `export` (writes `out/`, which is committed — see "chore: build" commits).

## Graph architecture (files that matter here)

- `pages/index.tsx` — everything lives here: websocket handling, filtering
  (`filteredGraphData` memo), local/scoped mode, and the `Graph` component that renders
  `ForceGraph2D`/`ForceGraph3D`.
- Community detection: `jLouvain()` (package `jlouvain.js`) runs inside the
  `filteredGraphData` `useMemo` in `pages/index.tsx` **only when
  `coloring.method === 'community'`**, and stores `{ nodeId: communityNumber }` in
  `clusterRef.current`. Community numbers are **not stable across runs/filters**.
- Node colors: `util/getNodeColorById.ts` —
  `visuals.nodeColorScheme[community % nodeColorScheme.length]`. Colors are Chakra theme
  keys (e.g. `'red.500'`), resolved via `util/getThemeColor.ts`; `util/hexToRGBA.ts` adds
  alpha.
- The coloring method is toggled in `components/Tweaks/Visual/GraphColorSelect.tsx`
  ("Number of links" = `degree` vs "Communities" = `community`) and persisted in
  localStorage key `coloring` via `util/persistant-state.ts` (which shallow-merges stored
  objects with the defaults from `components/config.ts`, so new config fields propagate).

## Community labels + zones + LLM naming (added 2026-07)

### New files

- `components/Graph/drawCommunities.ts` — per-frame canvas drawing. Groups rendered nodes
  by `clusterRef` community, trims outliers (keeps points within 1.2× the median distance
  of the community centroid — communities are spatially interleaved in a dense graph, so
  untrimmed convex hulls cover everything), computes a convex hull (monotone chain), and:
  - `layer: 'zones'` (called from `onRenderFramePre`, i.e. *behind* nodes/links): fills the
    hull + strokes it with a thick round-joined line of the same translucent color, which
    pads and rounds the hull; the fill/stroke overlap reads as a subtle border.
  - `layer: 'labels'` (called from `onRenderFramePost`, i.e. *on top*): draws the community
    name at the trimmed centroid, community-colored with a background-colored outline so it
    stays readable over links.
- `util/communityNames.ts` — talks to an **OpenAI-compatible** endpoint (Ollama at
  `http://192.168.1.222:11434/v1`):
  - `GET {url}/models` picks a model when `llmModel` is `''` (prefers ids matching
    `/instruct/i`, skips ids containing `embed`). On this server that resolves to
    `qwen2.5:7b-instruct-q8_0`, which behaves well.
  - `POST {url}/chat/completions` per community, 2 concurrent workers, top-20
    highest-degree note titles in the prompt, asks for a 1–3 word English label.
  - Response cleanup strips `<think>…</think>`, converts `_`/`-` to spaces (models emit
    snake_case; deleting underscores glues words together), caps at 4 words / 40 chars.
  - Names are cached in localStorage key `communityNamesCache-v2`, keyed by
    `memberCount:hash(top-20 titles)` so they survive reloads and unstable Louvain
    numbering; delete that key to force re-naming.
- Wiring in `pages/index.tsx`: a `useEffect` (on `filteredGraphData` /
  `coloring.method` / llm settings) builds `{community: [titles sorted by degree]}`,
  skips communities smaller than `communityMinSize`, and streams names into
  `communityNamesRef` (a ref, not state — force-graph redraws every frame anyway, so no
  re-render is needed and names pop in as they arrive). Effect cleanup cancels in-flight
  naming.

### Config (`initialColoring` in `components/config.ts`)

```ts
method: 'degree' | 'community'  // zones/labels only drawn for 'community'
communityZones: true
communityLabels: true
communityLabelFontSize: 48      // on-screen px target, clamped in graph units
communityMinSize: 3             // smaller communities get no zone/label/LLM call
zoneOpacity: 0.075
llmUrl: 'http://192.168.1.222:11434/v1'
llmModel: ''                    // '' = auto-pick from GET /models
```

The Emacs side can override the endpoint via `org-roam-ui-ollama-path` and
`org-roam-ui-ollama-model` (defcustoms in `org-roam-ui.el`, sent through the
`variables` websocket message as `ollamaPath`/`ollamaModel`); when set, they take
precedence over `llmUrl`/`llmModel`. Documented in README "Community naming (Ollama)".

`communityZones`, `communityLabels`, `zoneOpacity`, and `communityLabelFontSize` are
user-facing: `components/Tweaks/Visual/CommunitiesPanel.tsx` (a "Communities" accordion
section in the Visual settings panel, wired up in `VisualsPanel.tsx`).

### Limitations / notes

- 2D only. The 3D view (`ForceGraph3D`) has no `onRenderFramePre`; zones there would need
  THREE.js meshes.
- The browser calls Ollama directly; Ollama's default CORS allows `http://localhost:*`
  origins (verified via preflight). A non-localhost deployment needs `OLLAMA_ORIGINS`.
- Zones/labels also render in local (scoped) mode using the scoped nodes' positions;
  cluster assignments still come from the full filtered graph.
- Errors from the LLM endpoint are logged to the console and simply leave communities
  unlabeled; zones don't depend on naming.

### Verification (done against the live Emacs instance)

Served `out/` on :35911, set localStorage `coloring` to `{method:'community'}`, and
watched the real graph: ~57 communities got zones and sensible names ("programming",
"recipes", "French literature and culture", "Brutalist Architecture", …) within ~40 s on
first load, instantly from cache afterwards. Note: Chrome throttles `requestAnimationFrame`
for unfocused/occluded windows — a "frozen" canvas during automated testing usually means
the window lost focus, not a hang.
