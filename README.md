# Mental Defrag 🧠✨

> An ambient, zero-gravity physics canvas and thought-processing sandbox for brainstorming, clustering, and mental defragmentation.

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![Matter.js](https://img.shields.io/badge/Matter.js-Physics-4B8BBE?style=flat)
![Hugging Face](https://img.shields.io/badge/%F0%9F%A4%97%20Transformers.js-Embeddings-FFD21E?style=flat)
![Web Audio API](https://img.shields.io/badge/Web%20Audio%20API-Procedural%20FX-orange?style=flat)

---

## Overview

**Mental Defrag** is a cognitive canvas designed to clear mental clutter. Instead of static text outlines or rigid trees, your thoughts float as interactive, zero-gravity bodies in a frictionless physics environment. Connect related thoughts with elastic springs, cluster ideas semantically with client-side AI, and "defrag" thoughts with resonant particle explosions.

---

## Key Features

- 🌌 **Zero-Gravity Physics Engine**: Built with Matter.js. Thoughts float in an infinite 2D space with subtle air friction, boundary cushions, and dynamic cursor magnetic repulsion.
- 🔗 **Elastic Thought Springs**: Drag between thoughts to connect them with bidirectional elastic springs. Double-click on any empty canvas area or press <kbd>N</kbd> to spawn thoughts.
- 💥 **The "Defrag" Burst**: Right-click or press <kbd>Delete</kbd> / <kbd>Backspace</kbd> on any node to defrag it. Destroys the node and spawns a glowing particle explosion with resonant procedural audio.
- 🤖 **Client-Side Semantic Clustering**: Utilizes `@xenova/transformers` (`all-MiniLM-L6-v2`) locally in the browser to compute 384-dimensional vector embeddings. Related thoughts automatically pull toward each other and group into color-coded semantic hulls (with a zero-latency TF-IDF fallback).
- 🎵 **Procedural Web Audio Engine**: 100% native Web Audio API synthesis—no external MP3/WAV assets. Includes sine-wave spawn sweeps, high-damped band-pass collision ticks, and low-frequency resonant defrag pulses. Mute toggle via <kbd>M</kbd> or HUD icon.
- 📥 **Obsidian `.canvas` & JSON Drag-and-Drop**: Drag and drop any Obsidian Canvas or JSON backup file anywhere on the browser window to import thoughts and connections. Features a smart **Merge at Cursor** vs. **Replace Canvas** dialog and a staggered 200ms cascade spawner to eliminate physics explosions.
- 📤 **Comprehensive Exporters**:
  - **Obsidian Canvas (`.canvas`)**: Full compatibility with Obsidian's infinite canvas spec.
  - **Structured Markdown (`.md`)**: Hierarchical cluster outlines with bidirectional wikilinks (`[[Topic]]`).
  - **JSON Snapshot (`.json`)**: Complete state backup including camera viewport and spring topologies.
- 🗺️ **Minimalist Radar Mini-Map**: Fixed glassmorphic corner mini-map showing active thought clusters, spring links, camera viewport wireframe frustum, and click-to-teleport navigation.
- ✨ **Ambient Canvas Visuals**: Interactive background dot-grid with cursor magnetic lens distortion, breathing halos, and velocity trails.
- 💾 **Auto-Save & Session Restore**: Debounced automatic local storage persistence seamlessly restores your active canvas state on reload.

---

## Keyboard & Gesture Shortcuts

| Key / Gesture | Action |
| :--- | :--- |
| <kbd>N</kbd> or <kbd>C</kbd> / Double-click | Create new thought node at cursor |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> / Right-click | Defrag hovered thought |
| <kbd>Space</kbd> + Drag / Middle-click Drag | Pan infinite canvas |
| <kbd>Mouse Wheel</kbd> / Pinch-zoom | Zoom in / out (25% – 300%) |
| <kbd>F</kbd> | Frame all active nodes in viewport |
| <kbd>0</kbd> or <kbd>Ctrl</kbd>+<kbd>0</kbd> | Reset camera to origin (100%) |
| <kbd>S</kbd> | Toggle automated semantic AI clustering |
| <kbd>M</kbd> | Toggle procedural audio effects |
| <kbd>E</kbd> or <kbd>Ctrl</kbd>+<kbd>E</kbd> | Open Export & Backup modal |
| Drag & drop `.canvas` / `.json` | Ingest graph into physics simulation |
| <kbd>?</kbd> | Toggle Keyboard & Gesture Cheat Sheet |
| <kbd>Esc</kbd> | Close active modal or cancel prompt |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/) or [pnpm](https://pnpm.io/)

### Installation

```bash
# Clone the repository
git clone https://github.com/watchknight/Mental-Defrag.git

# Navigate into project directory
cd Mental-Defrag

# Install dependencies
npm install
```

### Development

Start the local Vite development server:

```bash
npm run dev
```

Open `http://localhost:5173/` in your browser.

### Production Build

Type-check and compile the production bundle:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

---

## Tech Stack

- **Runtime & Bundler**: [Vite](https://vitejs.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Physics**: [Matter.js](https://brm.io/matter-js/)
- **AI / Embeddings**: [@xenova/transformers](https://huggingface.co/docs/transformers.js)
- **Icons**: [Lucide](https://lucide.dev/)
- **Audio**: Native Web Audio API (`AudioContext`)
- **Rendering**: HTML5 Canvas 2D Context

---

## License

MIT © [watchknight](https://github.com/watchknight)
