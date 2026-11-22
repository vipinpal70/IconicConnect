# 3D Scan Visualization — Theory & Developer Guide

**Branch:** `feat/3d-scan-visualization`

**Who this is for:** any developer who needs to understand, fix or extend the 3D preview.

**How to read it:**

| Section | What it covers |
|---|---|
| 1 | What the feature is |
| 2 | The big picture (how the pieces connect) |
| 3 | Every library, and why |
| 4 | Every file: what it does, why it exists, what problem it solves, what it connects to |
| 5 | The two main flows, step by step |
| 6 | Key concepts in plain words |
| 7 | Why things are built this way (decisions) |
| 8 | Known limits |
| 9 | How to test, debug and extend |
| 10 | Branch history |

---

## 1. What this feature is

Inside a case page, users can open the case's dental scans in an interactive 3D viewer:

- **Rotate, zoom and pan** the scan freely (full 360°, including turning it upside down).
- **See two clearly separated previews**:
  - **Case Submission**: the scan files the lab uploaded when creating the case.
  - **Design Output**: the final design file and design previews uploaded by the designer / QC team.
- **Draw markup on the 3D surface**: freehand pen, highlighter, surface line / margin line, arrow, distance measurement, angle measurement, and comment pins.
- **Organise markup in layers** (show/hide, lock, opacity), with undo/redo.
- **Save markup explicitly** to the database, with a revision history. Unsaved work survives a crash or refresh (a local draft).
- **Show or hide individual scan files** inside a case ZIP (e.g. upper jaw, lower jaw, bite scan).

Supported file types:

| Format | Comes from |
|---|---|
| `.zip` | A whole case archive (3Shape, iTero, Medit, exocad exports) |
| `.dcm` | 3Shape's own mesh format. Not medical DICOM, despite the name. |
| `.stl` | Most CAD exports and iTero |
| `.ply` | Medit (can carry real tooth/gum colours) |
| `.obj` | Generic 3D |

---

## 2. The big picture

```
 CASE PAGE (CaseDetailView.tsx)
   │  builds two lists of 3D files: "Case Submission" and "Design Output"
   ▼
 Case3DPreviewPanel.tsx ──hover──► model-cache.ts (prefetch: start downloading early)
   │  user clicks "Open"
   ▼
 Dental3DViewer.tsx  (the full-screen viewer: toolbar, layers panel, presets, save buttons)
   │
   ├─ useAnnotationEditor.ts ──► /api/cases/[id]/annotations  (load / save markup)
   │        └─ annotation-draft-storage.ts (local crash-recovery draft in IndexedDB)
   │
   └─ <Canvas> (React Three Fiber = the 3D scene)
        ├─ ViewerControls.tsx      camera: free 360° rotation, zoom, pan, view presets
        ├─ ModelMesh.tsx           draws the scan meshes
        │     └─ model-cache.ts ─► Web Worker (model-loader.worker.ts)
        │                              └─ model-pipeline.ts
        │                                   ├─ scan-archive.ts     (download + unzip)
        │                                   ├─ scan-visibility.ts  (which files to show first)
        │                                   ├─ 3shape-dcm (+patch) (read .dcm)
        │                                   ├─ stl-weld.ts         (read .stl fast)
        │                                   ├─ three-mesh-bvh      (drawing index)
        │                                   └─ meshoptimizer       (lighter copy of huge meshes)
        ├─ AnnotationRenderer.tsx  draws saved markup (lines, pins, measurements)
        ├─ AnnotationPicker.tsx    click to select / eraser
        └─ DrawingInteraction.tsx  turns mouse input into new markup
```

**Key idea:** all heavy work happens in a **Web Worker** (a background thread): downloading, unzipping, parsing and preparing the 3D data. The page stays responsive while a 300 MB scan loads. The main thread only receives ready-made number arrays and hands them to the GPU.

---

## 3. Libraries: what each one is for

| Library | Version | What it is | Why we use it |
|---|---|---|---|
| `three` | 0.186 | three.js, the standard WebGL 3D engine for the browser | Meshes, materials, lights, camera, raycasting (finding where the mouse hits the surface), STL/PLY/OBJ loaders, `TrackballControls` |
| `@react-three/fiber` (R3F) | 9 | Lets you write a three.js scene as React components (`<Canvas>`, `<mesh>`, …) | The viewer is a React app; R3F keeps the 3D scene in sync with React state. We use `frameloop="demand"` so it only draws when something changes. |
| `@react-three/drei` | 10 | Ready-made R3F helpers | `Line` (thick, anti-aliased lines for markup), `Html` (labels that follow a 3D point), `PerspectiveCamera` |
| `three-mesh-bvh` | 0.9 | Builds a **BVH** (a spatial index) for a mesh | Without it, finding the point under the mouse on a 1-million-triangle scan means testing every triangle, which is far too slow for smooth drawing. With it, each test takes microseconds. |
| `3shape-dcm` | 1.0.0 (from GitHub, **patched**) | Reads 3Shape `.dcm` files, including decrypting the common "CE" scheme | 3Shape is the most common scanner; its scans arrive as `.dcm`. We patched its triangle decoder to be ~32× faster (see `patches/`). |
| `fflate` | 0.8 | Fast ZIP/deflate in pure JavaScript | Case files arrive as ZIPs. We **stream**-unzip them while they download, so we never hold the whole archive in memory. |
| `meshoptimizer` | 1.3 | Mesh simplification (WebAssembly) | Some full-arch STL scans have 6–7 million triangles. We make a lighter display copy (~1.5 M triangles, ≤ 0.01 mm deviation) so rotation stays smooth on weaker GPUs. Drawing still uses the full-detail mesh. |
| `patch-package` (dev) | 8 | Applies our patch files to `node_modules` after every install | Ships our fix to `3shape-dcm` without forking it. Runs automatically through the `postinstall` script in `package.json`. |
| `@types/three` (dev) | 0.186 | TypeScript types for three.js | Type safety |
| `lucide-react` | (existing) | Icons | Toolbar and panel icons |

---

## 4. File-by-file guide

All viewer files live in **`src/components/viewer3d/`** unless noted otherwise. For each file:

- **Does:** what it does
- **Why:** why it exists, or the problem it solves
- **Connects to:** the files it talks to

### 4.1 Entry points on the case page

#### `src/components/CaseDetailView.tsx` (existing file, modified)
- **Does:**
  - Builds the two lists of openable 3D files:
    - `submission3DSources`: the lab's uploaded case files.
    - `design3DSources`: the final design file (`caseRecord.outputFile`) plus 3D/ZIP design previews.
  - Lazy-loads the viewer bundle with `next/dynamic` (`ssr: false`), so three.js is only downloaded when someone opens a preview.
  - Preloads that bundle when the user hovers the Open button.
- **Why:**
  - Users must always know whether they are looking at **what the lab sent** or **what we designed**.
  - Lab users only see the Design Output once the case reaches `submitted_to_client`, `approved` or `delivered` (`DESIGN_RELEASED_STATUSES`). Staff always see it.
- **Connects to:** `Case3DPreviewPanel`, `Dental3DViewer`, `preview-sources`.

#### `Case3DPreviewPanel.tsx`
- **Does:**
  - Renders the two labelled columns (Case Submission / Design Output) with an Open button per file.
  - Shows empty states: "no files", "expired under the retention policy", and "design not released yet".
- **Why:** gives users a clear, separate entry point for each kind of preview.
- **Speed:**
  - On hover/focus it calls `prefetchModel`, so the download starts before the click.
  - `onIntent` preloads the viewer code.
- **Connects to:** `model-cache` (prefetch), `preview-sources` (labels, sizes).

#### `preview-sources.ts`
- **Does:**
  - Defines `Model3DSource` (one openable file: id, kind, title, fileName, url, size).
  - `PREVIEW_KIND_META` holds the shared labels, descriptions and badge colours for "Case Submission" and "Design Output".
  - Helpers:
    - `isPreviewable3DFile()`: is this extension viewable?
    - `fileNameFromUrl()`
    - `formatFileSize()`
- **Why:** one place for terminology, so the case page and the viewer always use the same words. It is kept free of three.js imports so list pages stay light.
- **Connects to:** `CaseDetailView`, `Case3DPreviewPanel`, `Dental3DViewer`.

### 4.2 The viewer shell

#### `Dental3DViewer.tsx`
- **Does:** the main viewer component. It owns:
  - **Header:** case number, Case Submission / Design Output badge, revision badge, save status (Saved / Unsaved / Saving / Failed), Save and Discard buttons, version history, fullscreen, close.
  - **Source switcher tabs:** jump between the submission and the design output; tabs prefetch on hover.
  - **Left toolbar:** tools grouped as navigate · draw · measure · annotate · erase, each with a keyboard shortcut (V, B, H, L, A, M, N, P, E). Also the current stroke style, and undo/redo.
  - **Style bar:** `DrawingStylePanel`, shown for drawing tools.
  - **Bottom bar:** view presets (Top, Bottom, Front, Back, Left, Right, Reset), Wireframe, material (Enamel / Clay / Normal), model opacity.
  - **Right panel:**
    - "Scan components", one row per file, showing its state: shown, hidden, "loads when shown", loading, skipped with a reason.
    - Markup layers, and the marks in the active layer.
  - **Hint bar:** how to use the current tool; "Preparing the scan surface for drawing…" while the drawing index is built.
  - **The `<Canvas>`:**
    - `frameloop="demand"` (draw only on change)
    - `dpr` 1–1.5
    - `stencil: true` (needed by the highlighter)
    - `HeadLights`: lights attached to the camera, so whatever side you rotate to is lit.
  - **Dialogs:** pin text, version history.
- **Why:** this is the screen users actually work in; it wires every other piece together.
- **Connects to:**
  - Scene: `ViewerControls`, `ModelMesh`, `AnnotationRenderer`, `AnnotationPicker`, `DrawingInteraction`.
  - State and UI: `useAnnotationEditor`, `DrawingStylePanel`, `model-cache`.

#### `ViewerControls.tsx`
- **Does:** the camera controller.
  - Uses three.js **`TrackballControls`**: free rotation in every direction, with inertia.
  - Mouse mapping:
    - **Navigate tool:** left-drag rotates, right-drag pans, wheel / middle-drag zooms.
    - **Drawing tools:** left button draws, **right-drag rotates**, middle-drag pans, wheel zooms. On touch, one finger draws and two fingers zoom/pan.
  - View presets via `setView()`: Top, Bottom, Front, Back, Left, Right, Reset. Each one sets both the camera position and its "up" direction, so there's no flip at the poles.
  - Frames a newly loaded model automatically. When you only toggle files, it adjusts the zoom limits without moving the camera.
  - While the camera moves, it lowers the resolution to 1× and tells the viewer to hide HTML labels.
  - Disables TrackballControls' A/S/D hold keys, which clashed with the tool shortcuts.
- **Why:**
  - The previous `OrbitControls` stopped vertical rotation at the top and bottom, so users could not turn the scan over. This was the original "can't rotate 360°" complaint.
  - Rotating while drawing removes constant tool switching.
- **Connects to:** receives `ModelFrame` (center, radius, up axis) from `ModelMesh` via the viewer; `Dental3DViewer` calls `setView`.

#### `DrawingStylePanel.tsx`
- **Does:** colour swatches, width presets and a slider for stroke thickness (1–16 px), plus `[` / `]` shortcuts (handled in the viewer).
- **Why:** markup needs readable, consistent colours and thicknesses for clinical communication.
- **Connects to:** `Dental3DViewer` → `useAnnotationEditor` (active colour / width).

### 4.3 Showing the scan

#### `ModelMesh.tsx`
- **Does:** draws the loaded scan files in the 3D scene.
  - Gets a **live model handle** from `model-cache` and re-renders whenever new data arrives: a hidden file decoded, the drawing index ready, a lighter display copy ready.
  - Wraps worker data in three.js `BufferGeometry`. This is cheap, because the normals and bounds were already computed in the worker.
  - **Drawing index:** attaches the BVH when it arrives (`attachBvh`), then reports "surface ready for drawing".
  - **Huge meshes:** when a lighter display copy (LOD) arrives, the mesh shows that copy. It keeps a hidden full-detail copy, `userData.raycastTarget`, for accurate drawing.
  - **Materials:** one per mesh, **updated in place** when the material mode, opacity or wireframe changes (`configureMaterial`). Recreating them made the GPU recompile shaders, which caused a visible stall.
  - **Visibility:** each file's visibility is its explicit toggle, or its default from `scan-visibility`. Switching a hidden file on asks the worker to decode it.
  - **Camera hints:** computes the **camera frame** (bounds of the visible meshes plus the **up axis** from `view-orientation`) and sends it to the viewer.
  - Assigns a colour per file (antagonist, preparation, CAD restoration, gum, …).
  - Fallback: a procedural arch when no file URL is given.
- **Important:** meshes are drawn in **raw model coordinates** (no re-centring). Saved markup is stored in the same coordinates, so marks stay on the right spot whichever files are visible.
- **Connects to:** `model-cache`, `view-orientation`, `bvh-setup`; reports to `Dental3DViewer` (files list, frame, surface ready).

#### `view-orientation.ts`
- **Does:** `inferUpAxis()` decides which world axis points "up" (towards the biting surface).
  - A dental arch is much flatter than it is wide, so the thinnest side of each scan's bounding box is its vertical axis. Each scan votes, weighted by triangle count; single crowns (CAD) don't vote.
  - When both jaws are present, the sign is chosen so the **upper jaw is above the lower jaw**.
- **Why:** scanners disagree. 3Shape and iTero export **Y-up**; Medit and most STL exports are **Z-up**. Without this, many cases opened side-on, and some 3Shape exports opened upside down.
- **Note:** only the camera uses this. Geometry and saved markup are never rotated.
- **Connects to:** `ModelMesh` → `ViewerControls`.

#### `bvh-setup.ts`
- **Does:** installs `three-mesh-bvh` into three.js once:
  - `computeBoundsTree` / `disposeBoundsTree` on geometries
  - accelerated `raycast` on meshes
- **Why:** makes surface picking fast enough to draw at full frame rate on dense scans.
- **Connects to:** imported by `ModelMesh`; used implicitly by every raycast in `DrawingInteraction`.

### 4.4 Loading pipeline (runs in the background worker)

#### `model-cache.ts`
- **Does:** the main-thread side of loading.
  - Starts the **Web Worker** and talks to it: `load`, `decode`, `release` messages.
  - Keeps a **session cache** of loaded models, shared by every viewer on the page:
    - LRU, at most 4 models / 640 MB
    - never evicts a model that is on screen
    - never written to disk (patient data)
  - Each loaded model is a **`ModelHandle`** with live state:
    - files and their status: ready / deferred / loading / skipped / error
    - decoded meshes
    - BVHs and LODs as they arrive
  - `prefetchModel()` starts loading on hover; `isModelCached()` lets the UI say "instant".
  - **Fallbacks:**
    - If workers are unavailable or the worker crashes, it runs the same pipeline on the main thread.
    - If the worker dies after a model loaded, it marks the handle so `ModelMesh` builds any missing BVHs itself.
- **Why:** opening a preview a second time, or switching Submission ↔ Design, should be instant. Loading must never freeze the page.
- **Connects to:** `model-loader.worker`, `model-pipeline` (types and fallback), `ModelMesh`, `Case3DPreviewPanel`, `Dental3DViewer`.

#### `model-loader.worker.ts`
- **Does:** the Web Worker entry point.
  - Receives requests, creates one `ModelSession` per model, and posts back progress, the finished model, and follow-up events.
  - Uses **transferable buffers**: arrays move to the main thread with zero copying.
- **Why:** keeps downloading, unzipping, parsing and BVH building off the main thread.
- **Connects to:** `model-pipeline` (does the work), `model-cache` (the caller).

#### `model-pipeline.ts`
- **Does:** the actual loading logic, as a `ModelSession`. Work is ordered for **time to first view**:
  1. Download. For ZIPs, stream-unzip with `scan-archive` and keep only the files relevant to the preview type (`selectEntries`).
  2. Decide which files are shown by default (`scan-visibility`). **Only those are decoded now.** Hidden files stay as raw bytes in the session, and `decode(file)` processes them later when switched on.
  3. Decode each file:
     - `.dcm` → `3shape-dcm`
     - binary `.stl` → `stl-weld`
     - ASCII `.stl`, `.ply`, `.obj` → three.js loaders
  4. Finalise each mesh: weld duplicate corners when needed (smooth shading, ⅓ of the memory), compute normals and bounds.
  5. Return the model. The first view can now render.
  6. **In the background:**
     - Build an **indirect BVH** per mesh (needed only for drawing).
     - For meshes above **2 M triangles**, build a **simplified display index** with `meshoptimizer` (target 1.5 M triangles, max 0.01 mm deviation).
- Unreadable files become `status: 'error'` instead of failing the whole case.
- **Why:**
  - Before, everything — including hidden duplicate scans — was parsed and indexed before anything appeared.
  - Example: the Bowman case took ~21 s of processing; it now takes 0.63 s.
- **Connects to:** `scan-archive`, `scan-visibility`, `stl-weld`, `3shape-dcm`, `three-mesh-bvh`, `meshoptimizer`; used by `model-loader.worker` and `model-cache`.

#### `scan-archive.ts`
- **Does:**
  - `classifyArchiveEntry()` sorts each ZIP entry into a category:
    - `scan`: a DCM in a `Scans/` folder
    - `cad`: a DCM in a `CAD/` folder (the designed restoration)
    - `mesh`: STL / PLY / OBJ
    - `other`
    - Ignores `Backup/` and `__MACOSX/`.
  - `selectEntries()`:
    - Case Submission: shows the scans.
    - Design Output: shows the design **together with** the scans, so reviewers see it in context.
  - `extractMeshEntries()` stream-unzips in a single pass with `fflate`:
    - **Limits:** 1 GB archive, 400 MB per file, 512 MB of 3D data in total, 48 files.
    - A file over a limit, or one that can't be extracted, is **skipped with a reason** instead of failing the case.
  - `fetchFileResponse()` / `readResponse()`: download with progress, and a clear message when a file has expired (404).
- **Why:**
  - 3Shape `Backup/` folders hold old copies in a different coordinate frame (they pulled the camera far away).
  - One oversized file used to make the whole case fail to open.
- **Connects to:** `model-pipeline`; `ModelPurpose` and `MeshCategory` types are used across the viewer.

#### `scan-visibility.ts`
- **Does:** `defaultVisibleFiles()` decides which files are shown when the viewer opens. The rules come from real lab exports:

  | Rule | Effect |
  |---|---|
  | Designed restorations (CAD) | Always shown |
  | 3Shape helper scans (`AuxScanDir/`, `Misc/`, bite/articulator scans) | Hidden |
  | Several scans per jaw | Only the best one shown: `MB …` → plain → `Raw …` → `PrePreparation…` |
  | Medit bite pieces (`TotalJaw*`) | Hidden |
  | `*modelbase*` STLs in a case submission | Hidden when the jaw scans exist |
  | Rules would hide everything | Everything shown |

- **Why:**
  - Some 3Shape cases showed 6 overlapping, misaligned meshes at once, which looked broken.
  - Hidden files are not decoded until needed, so these rules also decide most of the loading time.
- **Connects to:** `model-pipeline` (what to decode), `view-orientation` (reuses `jawOf()`).

#### `stl-weld.ts`
- **Does:**
  - `isBinaryStl()` detects binary STL by its exact file size.
  - `weldBinaryStl()` reads the triangles **once** and merges identical corners through a fast hash table, producing an indexed mesh directly. `-0` and `+0` are treated as the same point.
- **Why:**
  - STL stores every triangle corner separately. The standard route (three.js `STLLoader` + `mergeVertices`) took **10.3 s** and huge temporary memory for a 316 MB, 6.6 M-triangle scan.
  - This takes **0.67 s**, with the same result.
- **Connects to:** `model-pipeline`.

#### `patches/3shape-dcm+1.0.0.patch` (repo root) + `src/types/3shape-dcm.d.ts`
- **Does:**
  - The patch replaces the `.dcm` triangle decoder inside `node_modules/3shape-dcm`. It used `Array.splice` on every triangle, which is quadratic: seconds per scan. The patched version uses a linked list in typed arrays, which is linear.
  - The `.d.ts` file gives TypeScript types for the untyped package.
- **Why:**
  - DCM parsing was the **main cause of slow loading** for 3Shape cases: 38 s total across the samples, now 1.1 s.
  - The output is **byte-identical**: verified on 29 real files, and pinned by a checksum test.
- **How it's applied:** `npm install` / `npm ci` runs `postinstall: patch-package`, which re-applies it.
- **`.gitattributes`** keeps the patch file in LF line endings so it applies on every OS.
- **Connects to:** `model-pipeline` (`parse`).

### 4.5 Markup (annotations)

#### `src/types/annotation.ts`
- **Does:** the data model for markup:
  - `ToolMode`
  - annotation types:
    - `BrushAnnotation` (pen or highlighter)
    - `PolylineAnnotation` (surface line, open or closed)
    - `DistanceAnnotation`
    - `AngleAnnotation`
    - `PinAnnotation` (comment with optional surface normal)
    - `ArrowAnnotation`
  - `AnnotationLayer` (with `source`: which preview it belongs to)
  - `AnnotationDocument` (all layers + revision)
  - save payload/response types.
- **Why:** one shared contract between the viewer, the editor hook, local drafts and the API.
- **Connects to:** almost every markup file and the annotation API.

#### `src/lib/hooks/useAnnotationEditor.ts`
- **Does:** the markup "brain" (React hook). It holds:
  - the current document
  - the active tool, layer, colour and stroke width
  - the selected mark
  - undo/redo stacks
  - save status: saved / dirty / saving / error

  Behaviour:
  - Loads the document from the API on open.
  - **Separate layers per preview:** marks made on the Case Submission and on the Design Output never mix (`layer.source`). Old layers without a source count as submission.
  - Every edit pushes to undo history and marks the document **dirty**.
  - Dirty changes are written to a **local draft** (IndexedDB) after 800 ms. On reopen it offers "Recover Draft".
  - **Explicit save:** `PUT` with `expectedRevision`. A **409** means someone else saved first, and the user is told instead of overwriting.
  - Warns before leaving the page with unsaved changes.
- **Why:** markup is clinical communication. It must never be silently lost or overwritten, but autosaving every stroke to PostgreSQL would be wasteful.
- **Connects to:** `Dental3DViewer`, `annotation-draft-storage`, `/api/cases/[id]/annotations`.

#### `src/lib/storage/annotation-draft-storage.ts`
- **Does:** saves, loads and clears local drafts in the browser's **IndexedDB** (falls back to localStorage). Drafts are keyed by user + case.
- **Why:** crash/refresh recovery without writing to the database on every change.
- **Connects to:** `useAnnotationEditor`.

#### `DrawingInteraction.tsx`
- **Does:** turns mouse/pen input into new markup on the scan surface:
  - **Pen / highlighter:**
    - captures **coalesced pointer events**: the many samples a fast hand produces between frames, so strokes don't cut corners
    - raycasts each one onto the surface and lifts it 0.06 mm off it (`SURFACE_OFFSET_MM`)
    - smooths the stroke on release (`stroke-smoothing`)
  - **Surface line / margin:** click points; each segment is re-projected along the surface; click the first point to close; Enter / double-click finishes; Backspace removes the last point.
  - **Distance, angle, arrow:** click-by-click, with live previews.
  - **Pin:** asks the viewer for the comment text, and stores the surface normal.
  - **Esc** cancels; switching tools abandons a half-finished mark.
  - Raycasts only meshes whose **BVH is ready**. For a simplified (LOD) mesh it raycasts the full-detail copy, so marks sit exactly on the real surface.
- **Why:** this is the interaction layer that makes drawing feel precise and smooth.
- **Connects to:** `stroke-smoothing`, `markup-materials`, `useAnnotationEditor` (`addAnnotation`), `ModelMesh` (the meshes it raycasts).

#### `stroke-smoothing.ts`
- **Does:**
  - `smoothStroke()`: a moving average removes jitter, then centripetal **Catmull-Rom** resampling produces evenly spaced points (clean thick lines).
  - Geometry helpers: `pathLength()`, `angleAtVertex()`, `angleArcPoints()` (the arc drawn on angle measurements).
  - Constants: surface offset, minimum sample spacing.
- **Why:** raw mouse samples on a 3D surface are jagged; smoothed strokes look professional. The live preview uses the same smoothing, so what you see is what you get.
- **Connects to:** `DrawingInteraction`, `AnnotationRenderer`.

#### `markup-materials.ts`
- **Does:** shared rendering settings for markup:
  - `OVERLAY_MATERIAL_PROPS`: polygon offset, so lines never sink into or flicker against the scan.
  - Highlighter width ×3 and opacity 0.4.
  - `highlighterStencilProps()`: uses the GPU **stencil buffer** so each highlighter stroke draws every pixel once.
- **Why:** a semi-transparent thick line overlaps itself at every joint and would show dark blotches. The stencil trick keeps it even, while different strokes still blend.
- **Connects to:** `AnnotationRenderer`, `DrawingInteraction`. Requires the canvas to have `stencil: true`.

#### `AnnotationRenderer.tsx`
- **Does:** draws all saved markup from visible layers: pen/highlighter strokes, surface lines (vertex dots and a length badge when selected), angles (arms, arc, degree badge), distances (endpoints, mm badge), pins and arrows.
  - **Selection** shows a white halo; the mark keeps its own colour.
  - **Pins** stand along the stored surface normal, so they read correctly from any side and on Z-up scans.
  - **HTML labels** are hidden while the camera moves (`hideLabels`): each label is a DOM element repositioned every frame.
- **Why:** shows the markup. It is kept free of input handling so it stays cheap to render.
- **Connects to:** `markup-materials`, `stroke-smoothing`, `Dental3DViewer` (layers, selection, delete).

#### `annotation-picking.ts` + `AnnotationPicker.tsx`
- **Does:**
  - `pickAnnotation()` projects each mark's points to the screen and measures the distance to the cursor (pins by their head). It never picks hidden layers; for the eraser it skips locked layers.
  - `AnnotationPicker` listens on the canvas:
    - **Navigate tool:** a click (not a drag) selects a mark.
    - **Eraser:** click, or drag across marks, to delete them. Throttled to one check per frame, with no double deletes in one drag.
- **Why:** previously every mark had R3F pointer handlers, so R3F raycast every stroke **on every mouse move**, even while rotating. Rotation got slower as markup grew. Now marks are only tested on a click.
- **Connects to:** `Dental3DViewer` (layers, select, delete).

### 4.6 Server and database

#### `db/migrations/20261027000100_annotation_documents.sql` + `src/db/schema/annotation.ts`
- **Does:** creates two tables (dbmate migration + Drizzle schema).

  | Table | Holds |
  |---|---|
  | `annotation_documents` | One per case: current `revision`, `schema_version`, `document_data` (JSONB: all layers and marks), created/updated by and at |
  | `annotation_versions` | An audit copy of every saved revision: who saved it and when |

- **Why:** durable markup with a full history; JSONB keeps the flexible markup structure in one row.

#### `src/app/api/cases/[id]/annotations/route.ts` (+ `[documentId]/route.ts`, `versions/route.ts`)
- **Does:**
  - **GET:** returns the case's annotation document, or an empty one at revision 0.
  - **PUT / POST (`handleSave`):** checks role and case access, then in **one transaction** checks `expectedRevision`. A mismatch returns **409 Conflict**. Otherwise it writes the next revision and an audit row.
  - **`[documentId]` PUT:** an alias for the same save.
  - **`versions` GET:** the last 30 revisions, for the history dialog.
  - Roles: admin, QC, designer, account manager, client and sub-user. Lab users only see their own lab's cases.
- **Why:** safe concurrent editing (optimistic concurrency) and an audit trail.
- **Connects to:** `useAnnotationEditor`, `annotation` schema.

#### Related existing routes touched on this branch
- **`src/app/api/cases/files/route.ts`:**
  - Serves case files to the viewer through `/api/cases/files?labName=&fileName=`, after an access check.
  - HTML (exocad web viewer) previews are redirected to a short-lived R2 URL so they render.
  - `R2_DIRECT_DOWNLOADS=true` can redirect 3D files to R2 directly (faster large downloads).
- **`src/app/api/cases/[id]/preview-files/*`:** design preview files; their 3D/ZIP previews appear under Design Output.

### 4.7 Tests

All tests run with `npx vitest run`.

| File | Covers |
|---|---|
| `src/lib/__tests__/model-pipeline.test.ts` | DCM patch parity (checksums from the unpatched parser); ZIP classification incl. `Backup/`; one-pass design ZIP; decode on demand; one bad file doesn't fail the case; file-count limit skips; background BVH |
| `src/lib/__tests__/viewer3d-rules.test.ts` | Visibility rules on real 3Shape / Medit / STL layouts; up-axis detection (Y-up, Z-up, upside-down export); STL welding vs three.js; picking (hit, miss, hidden/locked layers) |
| `src/lib/__tests__/stroke-smoothing.test.ts` | Smoothing and geometry helpers |
| `src/lib/__tests__/annotation-api.test.ts` | Annotation save API |
| `src/lib/storage/__tests__/annotation-draft-storage.test.ts` | Local drafts |

---

## 5. The two main flows, step by step

### 5.1 Opening a preview

1. The user **hovers** an Open button → `prefetchModel()` asks the worker to start downloading, and the viewer code is preloaded.
2. The user **clicks** → `Dental3DViewer` mounts → `ModelMesh` calls `loadModel()` (instant if already cached).
3. **In the worker:**
   1. download + stream-unzip (`scan-archive`)
   2. pick relevant files (`selectEntries`)
   3. choose defaults (`scan-visibility`)
   4. decode only those (`3shape-dcm` / `stl-weld` / loaders)
   5. normals + bounds
   6. post the arrays to the main thread
4. `ModelMesh` creates geometries and computes the frame + up axis (`view-orientation`) → `ViewerControls` frames the camera. **The model is visible.**
5. **In the background:** the worker builds BVHs (drawing becomes available; the hint "Preparing the scan surface…" disappears) and, for huge meshes, a lighter display copy that is swapped in.
6. The user switches on a hidden file in the Layers panel → the worker decodes it → it appears.

### 5.2 Drawing and saving markup

1. The user picks a tool (e.g. **B** for pen) → `ViewerControls` moves rotation to the right mouse button.
2. Dragging on the scan → `DrawingInteraction` raycasts (BVH) → smooths → `addAnnotation()` in `useAnnotationEditor`.
3. The document becomes **dirty** → a local draft is saved after 800 ms (IndexedDB).
4. The user clicks **Save** → `PUT /api/cases/[id]/annotations` with `expectedRevision`:
   - same revision → saved as `revision + 1`, with an audit row in `annotation_versions`
   - different revision → 409 → "another user saved changes"
5. Reopening later loads the saved document. Marks appear in exactly the same place, because they are stored in raw model coordinates.

---

## 6. Key concepts in plain words

| Term | Meaning here |
|---|---|
| **Mesh / triangles** | A 3D scan is a surface made of many small triangles. Dental scans have roughly 50 k to 7 M. |
| **Welding** | STL/OBJ repeat each shared corner for every triangle. Merging identical corners gives smooth shading and about ⅓ of the memory. |
| **Normals** | The direction each surface point faces; needed for lighting. Computed in the worker. |
| **Raycasting** | Shooting an invisible ray from the mouse into the scene to find the surface point under the cursor. |
| **BVH** | A tree of boxes around groups of triangles. A ray skips whole boxes it doesn't hit, so the point under the mouse is found without testing millions of triangles. "Indirect" means the mesh's own triangle order is left untouched. |
| **LOD (level of detail)** | A lighter copy of a huge mesh for display only. |
| **Web Worker** | A background thread in the browser. Heavy work there doesn't freeze the page. |
| **Transferable** | Moving a large array between threads without copying it. |
| **Render on demand** | The 3D scene is only redrawn when something changes, instead of 60 times a second. |
| **DPR** | Device pixel ratio: render resolution. Lowered to 1× while moving, for smoothness. |
| **Stencil buffer** | A per-pixel scratch value on the GPU; used so a translucent highlighter stroke paints each pixel once. |
| **Polygon offset** | Nudges markup towards the camera so it never flickers against the scan surface. |
| **Trackball vs orbit** | Orbit keeps the camera upright and stops at the poles. Trackball lets you turn the object in any direction. |
| **Optimistic concurrency** | Saves carry the revision they started from; if someone else saved in between, the save is rejected (409) instead of overwriting their work. |
| **DCM** | 3Shape's own mesh format (XML + base64, often encrypted with the "CE" scheme). Not medical DICOM. |

---

## 7. Why things are built this way

1. **A worker, not the main thread.** Parsing a 100–300 MB case would freeze the page for seconds.
2. **Decode only what's shown.** Most 3Shape ZIPs contain several duplicates of each scan; showing all of them was both slow and confusing.
3. **BVH after first view.** It is only needed for drawing; users want to see the scan first.
4. **Patch the DCM parser, not fork it.** The fix is one function. patch-package keeps it small and visible, and the checksum test catches drift if the package is updated.
5. **Raw model coordinates.** If meshes were re-centred on the visible files, the centre would move as files are toggled, and saved marks would drift.
6. **Camera-only orientation.** Rotating geometry would change coordinates and break saved markup.
7. **Separate markup per preview.** A mark on the lab's scan means something different from a mark on the design.
8. **Explicit save + local draft.** Clinical markup must be deliberate and auditable, yet never lost on a crash.
9. **Trackball controls.** Clinicians need to look at the underside and the biting surfaces, which orbit-style controls cannot reach.

---

## 8. Known limits

- **Front of the arch is not detected.** The up axis is detected reliably, but which side is the front teeth is not, so some STL cases open viewed from the tongue side. One drag or a preset fixes it.
- **Very large ZIPs** (e.g. 274 MB) spend seconds unzipping. In the browser this overlaps the download.
- **Encrypted 3Shape library parts** ("External models" using 3Shape's Key Exchange) cannot be read by any offline reader. They show as errors only if no other files exist.
- **Speed on real graphics cards is unmeasured.** Frame rates on real GPUs were not benchmarked. Behaviour was checked in headless Edge with software rendering.
- **Old markup may be shifted.** Markup saved on this branch before the move to raw model coordinates (only on this branch, never on `master`) may appear shifted.

---

## 9. How to test, debug and extend

**Run checks:**

```
npx tsc --noEmit
npx eslint src/components/viewer3d
npx vitest run
npm run build
```

**Debug tips:**
- **Slow load:** look at the Layers panel; many files "loading" means the visibility rules may be showing too much. Check the browser's Performance panel: worker time vs main-thread time.
- **Drawing does nothing:** the BVH may not be ready yet (hint bar) or the file is hidden.
- **Wrong orientation:** check `inferUpAxis` input (bounding boxes, jaw names).
- **DCM suddenly slow after a dependency update:** the patch may not have applied. `npm install` output should show `3shape-dcm@1.0.0 ✔`.

**Extending:**
- **New file format:** add a decoder in `model-pipeline.ts › decodeGeometries`, the extension in `SUPPORTED_EXTENSIONS`, `MESH_EXTENSIONS` (`scan-archive.ts`) and `PREVIEWABLE_EXTENSIONS` (`preview-sources.ts`).
- **New markup tool:**
  1. Add the type in `types/annotation.ts`.
  2. Capture it in `DrawingInteraction`.
  3. Draw it in `AnnotationRenderer`.
  4. Make it pickable in `annotation-picking.ts`.
  5. Add a toolbar entry in `TOOL_GROUPS` (`Dental3DViewer`).
- **New default-visibility rule:** edit `scan-visibility.ts` and add a case to `viewer3d-rules.test.ts` using the real file layout.

---

## 10. Branch history (3D work)

| Commit | Date | What it added |
|---|---|---|
| `8985434` | 2026-10-27 | Viewer foundation: explicit-save annotation architecture, DB tables, API, editor hook, local drafts, first viewer/renderer/drawing, BVH setup |
| `dc6bec8` | 2026-10-27 | Production build and React 19 compiler fixes |
| `662e839` | 2026-10-29 | 3Shape scan visualization: `.dcm` support (`3shape-dcm`), ZIP archive reading (`scan-archive.ts`), scan components list |
| `17853d9` | 2026-10-29 | HTML (exocad) previews served from R2 so they render |
| `697b8d2` | 2026-11-17 | Professional drawing (smoothing, thickness, colours, highlighter, surface line, angle, arrow), Case Submission vs Design Output previews, Web Worker loading with cache and prefetch |
| `20c4cc2` | 2026-11-17 | Bulk upload fixes (safe file keys so design files never overwrite lab scans) — related file-safety work |
| `ffe0fde` | 2026-11-18 | Free 360° rotation (TrackballControls), up-axis detection, patched DCM parser (~32×), fast STL welding, decode-on-demand, background BVH/LOD, skip-not-fail limits, render on demand, click-based picking |

The full analysis and measurements behind the last commit are in `enhance-3d-preview-plan.md` (local file).
