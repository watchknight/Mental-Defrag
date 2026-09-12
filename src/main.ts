import './style.css';
import { PhysicsEngine } from './physics/engine';
import { soundFX } from './audio/soundFX';
import { loadCanvasState } from './storage/storage';
import { MiniMap } from './ui/minimap';
import { ShortcutEngine, showHudToast } from './ui/shortcuts';
import { ExportModal } from './ui/exportModal';
import { NodeManager } from './physics/nodeManager';
import { DropOverlay } from './ui/dropOverlay';
import { Activity, Layers, Share2, Disc, Volume2, VolumeX, HelpCircle, createIcons } from 'lucide';

const canvas = document.getElementById('physics-canvas') as HTMLCanvasElement;

if (!canvas) {
  throw new Error('Canvas element #physics-canvas not found');
}

// 1. Populate HUD diagnostics
const hudPanel = document.querySelector('.hud-panel');
if (hudPanel) {
  const subtitle = hudPanel.querySelector('.hud-subtitle');
  if (subtitle) {
    subtitle.textContent = 'Double-click or [N] to create • [Del] to defrag • [F] frame • [S] cluster • [E] export • [?] shortcuts';
  }

  const statsContainer = document.createElement('div');
  statsContainer.className = 'hud-stats';
  statsContainer.innerHTML = `
    <div class="stat-item">
      <i data-lucide="activity"></i>
      <span id="fps-display">60 FPS</span>
    </div>
    <div class="stat-item">
      <i data-lucide="layers"></i>
      <span id="node-count-display">0 Nodes</span>
    </div>
    <div class="stat-item">
      <i data-lucide="share-2"></i>
      <span id="link-count-display">0 Links</span>
    </div>
    <div class="stat-item">
      <i data-lucide="disc"></i>
      <span id="zoom-display">100%</span>
    </div>
  `;
  hudPanel.appendChild(statsContainer);
}

const updateNodeCountUI = (count: number) => {
  const nodeCountDisplay = document.getElementById('node-count-display');
  if (nodeCountDisplay) {
    nodeCountDisplay.textContent = `${count} Node${count === 1 ? '' : 's'}`;
  }
};

const updateLinkCountUI = (count: number) => {
  const linkCountDisplay = document.getElementById('link-count-display');
  if (linkCountDisplay) {
    linkCountDisplay.textContent = `${count} Link${count === 1 ? '' : 's'}`;
  }
};

const updateZoomUI = (zoom: number) => {
  const zoomDisplay = document.getElementById('zoom-display');
  if (zoomDisplay) {
    zoomDisplay.textContent = `${Math.round(zoom * 100)}%`;
  }
};

// 2. Audio and Help Control Button Setup
const audioBtn = document.getElementById('audio-control-btn');
const helpBtn = document.getElementById('help-btn');

function renderAudioIcon(isMuted: boolean) {
  if (!audioBtn) return;
  audioBtn.innerHTML = isMuted
    ? '<i data-lucide="volume-x"></i>'
    : '<i data-lucide="volume-2"></i>';
  createIcons({
    icons: {
      Volume2,
      VolumeX,
      HelpCircle,
    },
  });
}

if (audioBtn) {
  renderAudioIcon(soundFX.getIsMuted());

  audioBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isMuted = soundFX.toggleMute();
    renderAudioIcon(isMuted);
    showHudToast(isMuted ? 'Sound: Muted' : 'Sound: Enabled');
  });
}

// Render base HUD icons
createIcons({
  icons: {
    Activity,
    Layers,
    Share2,
    Disc,
    Volume2,
    VolumeX,
    HelpCircle,
  },
});

// 3. Initialize custom canvas physics engine with sound hooks
const physics = new PhysicsEngine({
  canvas,
  onFpsUpdate: (fps) => {
    const fpsDisplay = document.getElementById('fps-display');
    if (fpsDisplay) {
      fpsDisplay.textContent = `${fps} FPS`;
    }
    updateZoomUI(physics.camera.zoom);
  },
  onNodeCountUpdate: (count) => {
    updateNodeCountUI(count);
  },
  onLinkCountUpdate: (count) => {
    updateLinkCountUI(count);
  },
  onCollision: () => {
    soundFX.playClick();
  },
  onDragStart: () => {
    soundFX.playClick();
  },
  onLinkCreated: () => {
    soundFX.playClick();
  },
});

// 3b. Initialize NodeManager & Full-Window Drag-and-Drop Ingestion Overlay
const nodeManager = new NodeManager(physics);
new DropOverlay({ physics, nodeManager });

// 3c. Initialize Export & Backup Modal
const exportModal = new ExportModal({ physics, nodeManager });

// 3d. Initialize Minimalist Radar Mini-Map with export trigger
const minimap = new MiniMap({
  camera: physics.camera,
  onExportClick: () => exportModal.open(),
});

physics.onAfterRender = () => {
  minimap.render(physics.nodeBodies, physics.springConstraints, physics.camera);
};

// 3d. Auto-Cluster Pill Button & Shortcut Engine
const autoClusterBtn = document.getElementById('auto-cluster-btn');

function updateAutoClusterUI(enabled: boolean) {
  if (!autoClusterBtn) return;
  if (enabled) {
    autoClusterBtn.classList.add('active');
  } else {
    autoClusterBtn.classList.remove('active');
  }
}

if (autoClusterBtn) {
  autoClusterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const enabled = physics.toggleAutoClustering();
    updateAutoClusterUI(enabled);
    showHudToast(enabled ? 'Semantic Clustering: ON' : 'Semantic Clustering: OFF');
  });
}

const shortcuts = new ShortcutEngine({
  physics,
  onSpawnRequested: (sx, sy) => {
    promptSpawnAt(sx, sy);
  },
  onMuteToggled: (isMuted) => {
    renderAudioIcon(isMuted);
  },
  onAutoClusterToggled: (enabled) => {
    updateAutoClusterUI(enabled);
  },
  onExportRequested: () => {
    exportModal.open();
  },
});

if (helpBtn) {
  helpBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    shortcuts.toggleModal();
  });
}

// 4. Session Restore: Attempt to read saved state from localStorage
const savedState = loadCanvasState();
let isRestored = false;

if (savedState && savedState.length > 0) {
  isRestored = physics.restoreState(savedState);
}

// Fallback: spawn introductory nodes if no prior session exists
if (!isRestored) {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;

  // Tech / Dev cluster
  physics.createNode(cx - 220, cy - 80, 'Fix backend API endpoint');
  physics.createNode(cx - 90, cy - 130, 'Debug auth token expiration');

  // Groceries / Life cluster
  physics.createNode(cx + 120, cy + 70, 'Buy groceries at market');
  physics.createNode(cx + 250, cy + 120, 'Organic fruits & vegetables');
}

updateNodeCountUI(physics.nodeBodies.length);
updateLinkCountUI(physics.springConstraints.length);

// Start physics & custom rendering loop
physics.start();

// 5. Pan & Zoom Event Handling
let isSpacePressed = false;
let isMousePanning = false;
let panStartX = 0;
let panStartY = 0;

function updateCursorStyle() {
  if (isMousePanning) {
    canvas.style.cursor = 'grabbing';
    document.body.style.cursor = 'grabbing';
  } else if (isSpacePressed) {
    canvas.style.cursor = 'grab';
    document.body.style.cursor = 'grab';
  } else {
    canvas.style.cursor = 'default';
    document.body.style.cursor = 'default';
  }
}

// Zooming via Mouse Wheel & Pinch-zoom
canvas.addEventListener(
  'wheel',
  (e: WheelEvent) => {
    e.preventDefault();

    if (e.ctrlKey) {
      // Trackpad pinch-to-zoom
      const zoomFactor = Math.pow(0.992, e.deltaY);
      physics.camera.zoomAt(e.clientX, e.clientY, zoomFactor);
    } else if (Math.abs(e.deltaX) > 0 || (e.shiftKey && Math.abs(e.deltaY) > 0)) {
      // Two-finger trackpad pan or Shift+scroll
      physics.camera.panBy(-e.deltaX, -e.deltaY, true);
    } else {
      // Standard discrete wheel scroll
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      physics.camera.zoomAt(e.clientX, e.clientY, zoomFactor);
    }

    updateZoomUI(physics.camera.targetZoom);
  },
  { passive: false }
);

// Space key listener for pan mode
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'INPUT') {
    isSpacePressed = true;
    updateCursorStyle();
  }
});

window.addEventListener('keyup', (e: KeyboardEvent) => {
  if (e.code === 'Space') {
    isSpacePressed = false;
    if (!isMousePanning) {
      updateCursorStyle();
    }
  }
});

// Panning: Middle-Click OR Space + Left-Click
canvas.addEventListener('mousedown', (e: MouseEvent) => {
  if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
    e.preventDefault();
    isMousePanning = true;
    physics.isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    updateCursorStyle();
  }
});

window.addEventListener('mousemove', (e: MouseEvent) => {
  if (isMousePanning) {
    e.preventDefault();
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    panStartX = e.clientX;
    panStartY = e.clientY;
    physics.camera.panBy(dx, dy, true);
  }
});

window.addEventListener('mouseup', (e: MouseEvent) => {
  if (isMousePanning) {
    if (e.button === 1 || e.button === 0) {
      isMousePanning = false;
      physics.isPanning = false;
      updateCursorStyle();
    }
  }
});

// 6. Spawning Interaction (Desktop double-click & Mobile double-tap)
let activeSpawnWrapper: HTMLElement | null = null;

function removeSpawnInput() {
  if (activeSpawnWrapper) {
    activeSpawnWrapper.remove();
    activeSpawnWrapper = null;
  }
}

function promptSpawnAt(screenX: number, screenY: number) {
  // Convert screen coordinates to world coordinates
  const worldPos = physics.screenToWorld(screenX, screenY);

  const hitBody = physics.getNodeAt(worldPos.x, worldPos.y);
  if (hitBody) return;

  removeSpawnInput();

  const wrapper = document.createElement('div');

  const halo = document.createElement('div');
  halo.className = 'node-spawn-halo';
  halo.style.left = `${screenX}px`;
  halo.style.top = `${screenY}px`;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'node-inline-input';
  input.placeholder = 'type & press enter';
  input.style.left = `${screenX}px`;
  input.style.top = `${screenY}px`;
  input.autocomplete = 'off';

  wrapper.appendChild(halo);
  wrapper.appendChild(input);
  document.body.appendChild(wrapper);
  activeSpawnWrapper = wrapper;

  requestAnimationFrame(() => {
    input.focus();
  });

  input.addEventListener('keydown', (evt: KeyboardEvent) => {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      const text = input.value.trim();
      if (text) {
        physics.createNode(worldPos.x, worldPos.y, text);
        soundFX.playSpawn();
      }
      removeSpawnInput();
    } else if (evt.key === 'Escape') {
      evt.preventDefault();
      removeSpawnInput();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (activeSpawnWrapper === wrapper) {
        removeSpawnInput();
      }
    }, 180);
  });
}

// Double-click on desktop
canvas.addEventListener('dblclick', (e: MouseEvent) => {
  e.preventDefault();
  promptSpawnAt(e.clientX, e.clientY);
});

// 7. Right-Click Destruction on Desktop
canvas.addEventListener('contextmenu', (e: MouseEvent) => {
  e.preventDefault();

  const worldPos = physics.screenToWorld(e.clientX, e.clientY);
  const hitBody = physics.getNodeAt(worldPos.x, worldPos.y);
  if (hitBody) {
    soundFX.playDefrag();
    physics.defragNode(hitBody);
  }
});

// 8. Mobile Touch Gestures: Tap-and-Hold to Defrag & Drag to Move & Double-Tap to Spawn
let touchTimer: number | null = null;
let touchStartX = 0;
let touchStartY = 0;
let longPressTarget: Matter.Body | null = null;
let lastTapTime = 0;
let lastTapX = 0;
let lastTapY = 0;

canvas.addEventListener(
  'touchstart',
  (e: TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      const worldPos = physics.screenToWorld(touch.clientX, touch.clientY);
      longPressTarget = physics.getNodeAt(worldPos.x, worldPos.y);

      // Start 500ms long-press defrag timer if touching an existing node
      if (longPressTarget) {
        touchTimer = window.setTimeout(() => {
          if (longPressTarget) {
            soundFX.playDefrag();
            physics.defragNode(longPressTarget);
            longPressTarget = null;
          }
        }, 500);
      }
    }
  },
  { passive: true }
);

canvas.addEventListener(
  'touchmove',
  (e: TouchEvent) => {
    if (touchTimer && e.touches.length === 1) {
      const touch = e.touches[0];
      const moveDist = Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY);
      // If user moves finger > 10px, cancel long-press to allow smooth dragging
      if (moveDist > 10) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
    }
  },
  { passive: true }
);

canvas.addEventListener('touchend', (e: TouchEvent) => {
  if (touchTimer) {
    clearTimeout(touchTimer);
    touchTimer = null;
  }

  // Mobile double-tap on empty canvas detection
  if (e.changedTouches.length === 1) {
    const touch = e.changedTouches[0];
    const now = performance.now();
    const timeSinceLastTap = now - lastTapTime;
    const tapDistance = Math.hypot(touch.clientX - lastTapX, touch.clientY - lastTapY);

    if (timeSinceLastTap < 320 && tapDistance < 25) {
      const worldPos = physics.screenToWorld(touch.clientX, touch.clientY);
      const hitBody = physics.getNodeAt(worldPos.x, worldPos.y);
      if (!hitBody) {
        promptSpawnAt(touch.clientX, touch.clientY);
      }
      lastTapTime = 0;
    } else {
      lastTapTime = now;
      lastTapX = touch.clientX;
      lastTapY = touch.clientY;
    }
  }
});

canvas.addEventListener('touchcancel', () => {
  if (touchTimer) {
    clearTimeout(touchTimer);
    touchTimer = null;
  }
});
