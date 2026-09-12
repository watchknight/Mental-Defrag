import './style.css';
import { PhysicsEngine } from './physics/engine';
import { soundFX } from './audio/soundFX';
import { loadCanvasState } from './storage/storage';
import { MiniMap } from './ui/minimap';
import { ShortcutEngine, showHudToast } from './ui/shortcuts';
import { ExportModal } from './ui/exportModal';
import { NodeManager } from './physics/nodeManager';
import { DropOverlay } from './ui/dropOverlay';
import { HUD } from './ui/hud';

const canvas = document.getElementById('physics-canvas') as HTMLCanvasElement;

if (!canvas) {
  throw new Error('Canvas element #physics-canvas not found');
}

// 1. Initialize custom canvas physics engine with sound hooks
const physics = new PhysicsEngine({
  canvas,
  onFpsUpdate: (fps) => {
    hud.updateFps(fps);
    hud.updateZoom(physics.camera.zoom);
  },
  onNodeCountUpdate: (count) => {
    hud.updateNodeCount(count);
  },
  onLinkCountUpdate: (count) => {
    hud.updateLinkCount(count);
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

// 2. Initialize NodeManager, Full-Window Drag-and-Drop Ingestion Overlay, & Export Modal
const nodeManager = new NodeManager(physics);
new DropOverlay({ physics, nodeManager });
const exportModal = new ExportModal({ physics, nodeManager });

// 3. Initialize Shortcut Engine
const shortcuts = new ShortcutEngine({
  physics,
  onSpawnRequested: (sx, sy) => {
    promptSpawnAt(sx, sy);
  },
  onMuteToggled: (isMuted) => {
    hud.updateSound(isMuted);
  },
  onAutoClusterToggled: (enabled) => {
    hud.updateAutoCluster(enabled);
  },
  onExportRequested: () => {
    exportModal.open();
  },
});

// 4. Initialize Modern HUD Manager with Desktop Collapsible Bar & Mobile Action Dock
const hud = new HUD({
  onSpawnRequested: () => {
    const vpHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    promptSpawnAt(window.innerWidth / 2, Math.round(vpHeight * 0.38));
  },
  onFrameRequested: () => {
    shortcuts.frameAll();
  },
  onAutoClusterToggle: () => {
    const enabled = physics.toggleAutoClustering();
    showHudToast(enabled ? 'Semantic Clustering: ON' : 'Semantic Clustering: OFF');
    return enabled;
  },
  onSoundToggle: () => {
    const isMuted = soundFX.toggleMute();
    showHudToast(isMuted ? 'Sound: Muted' : 'Sound: Enabled');
    return isMuted;
  },
  onExportRequested: () => {
    exportModal.open();
  },
  onHelpRequested: () => {
    shortcuts.toggleModal();
  },
  initialSoundMuted: soundFX.getIsMuted(),
  initialAutoCluster: true,
});

// 5. Initialize Minimalist Radar Mini-Map with export trigger
const minimap = new MiniMap({
  camera: physics.camera,
  onExportClick: () => exportModal.open(),
});

physics.onAfterRender = () => {
  minimap.render(physics.nodeBodies, physics.springConstraints, physics.camera);
};

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

hud.updateNodeCount(physics.nodeBodies.length);
hud.updateLinkCount(physics.springConstraints.length);

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

    hud.updateZoom(physics.camera.targetZoom);
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

// 6. Virtual Keyboard Safe Spawner Interaction
let activeSpawnWrapper: HTMLElement | null = null;
let activeSpawnCleanup: (() => void) | null = null;

function removeSpawnInput() {
  if (activeSpawnCleanup) {
    activeSpawnCleanup();
    activeSpawnCleanup = null;
  }
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

  // If on a mobile device or screen is cramped, check if screenY will collide with keyboard
  const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  // If in the bottom 45% of the viewport, smoothly pan camera up so input remains visible above keyboard
  if (screenY > viewportHeight * 0.55) {
    const targetScreenY = Math.round(viewportHeight * 0.38);
    const panDy = targetScreenY - screenY;
    physics.camera.panBy(0, panDy, true);
    screenY = targetScreenY;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'node-spawn-container';

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
  input.autocapitalize = 'sentences';

  wrapper.appendChild(halo);
  wrapper.appendChild(input);
  document.body.appendChild(wrapper);
  activeSpawnWrapper = wrapper;

  // Real-time position tracking relative to visualViewport without camera displacement
  const repositionInput = () => {
    const currentScreen = physics.worldToScreen(worldPos.x, worldPos.y);
    halo.style.left = `${currentScreen.x}px`;
    halo.style.top = `${currentScreen.y}px`;
    input.style.left = `${currentScreen.x}px`;
    input.style.top = `${currentScreen.y}px`;
  };

  const onViewportResize = () => {
    repositionInput();
    input.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    window.scrollTo(0, 0);
  };

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewportResize);
    window.visualViewport.addEventListener('scroll', onViewportResize);
  }

  activeSpawnCleanup = () => {
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', onViewportResize);
      window.visualViewport.removeEventListener('scroll', onViewportResize);
    }
  };

  requestAnimationFrame(() => {
    input.focus();
    input.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
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

// 7. Desktop Double-Click & Right-Click
canvas.addEventListener('dblclick', (e: MouseEvent) => {
  e.preventDefault();
  promptSpawnAt(e.clientX, e.clientY);
});

canvas.addEventListener('contextmenu', (e: MouseEvent) => {
  e.preventDefault();
  const worldPos = physics.screenToWorld(e.clientX, e.clientY);
  const hitBody = physics.getNodeAt(worldPos.x, worldPos.y);
  if (hitBody) {
    soundFX.playDefrag();
    physics.defragNode(hitBody);
  }
});

// 8. Unified Pointer & Touch Gesture System
interface ActivePointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  pointerType: string;
}

const activePointers = new Map<number, ActivePointer>();
let isMultiTouching = false;
let initialPinchDist = 0;
let lastPinchMidX = 0;
let lastPinchMidY = 0;

// Long-press defrag state (550ms still hold with haptic vibration)
let longPressTimer: number | null = null;
let longPressTarget: Matter.Body | null = null;
let longPressStartX = 0;
let longPressStartY = 0;

// Mobile double-tap state (< 300ms, distance < 28px)
let lastTouchTapTime = 0;
let lastTouchTapX = 0;
let lastTouchTapY = 0;

canvas.addEventListener('pointerdown', (e: PointerEvent) => {
  activePointers.set(e.pointerId, {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    startX: e.clientX,
    startY: e.clientY,
    startTime: performance.now(),
    pointerType: e.pointerType,
  });

  // Multi-Touch Pinch & Drag (2 fingers)
  if (activePointers.size === 2) {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressTarget = null;
    }
    removeSpawnInput();

    isMultiTouching = true;
    physics.isPanning = true;

    // Disengage mouseConstraint so bodies are not dragged while pinching/panning
    if (physics.mouseConstraint.body) {
      (physics.mouseConstraint as unknown as { body: Matter.Body | null }).body = null;
      physics.mouseConstraint.constraint.bodyB = null;
    }

    const ptrs = Array.from(activePointers.values());
    initialPinchDist = Math.hypot(ptrs[0].x - ptrs[1].x, ptrs[0].y - ptrs[1].y);
    lastPinchMidX = (ptrs[0].x + ptrs[1].x) / 2;
    lastPinchMidY = (ptrs[0].y + ptrs[1].y) / 2;
    return;
  }

  // Single-touch gesture handling (Long-press 550ms still hold)
  if (e.pointerType === 'touch' && activePointers.size === 1) {
    longPressStartX = e.clientX;
    longPressStartY = e.clientY;
    const worldPos = physics.screenToWorld(e.clientX, e.clientY);
    longPressTarget = physics.getNodeAt(worldPos.x, worldPos.y);

    if (longPressTarget) {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
      }
      longPressTimer = window.setTimeout(() => {
        if (longPressTarget) {
          if ('vibrate' in navigator) {
            try {
              navigator.vibrate(40);
            } catch (_) {}
          }
          soundFX.playDefrag();
          physics.defragNode(longPressTarget);
          longPressTarget = null;

          if (physics.mouseConstraint.body) {
            (physics.mouseConstraint as unknown as { body: Matter.Body | null }).body = null;
            physics.mouseConstraint.constraint.bodyB = null;
          }
        }
        longPressTimer = null;
      }, 550);
    }
  }

  // Desktop Mouse Panning: Middle-Click OR Space + Left-Click
  if (e.pointerType === 'mouse') {
    if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
      e.preventDefault();
      isMousePanning = true;
      physics.isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      updateCursorStyle();
    }
  }
});

window.addEventListener('pointermove', (e: PointerEvent) => {
  const ptr = activePointers.get(e.pointerId);
  if (ptr) {
    ptr.x = e.clientX;
    ptr.y = e.clientY;
  }

  // Two-finger multi-touch pinch-zoom & pan
  if (activePointers.size === 2 && isMultiTouching) {
    const ptrs = Array.from(activePointers.values());
    const currentDist = Math.hypot(ptrs[0].x - ptrs[1].x, ptrs[0].y - ptrs[1].y);
    const midX = (ptrs[0].x + ptrs[1].x) / 2;
    const midY = (ptrs[0].y + ptrs[1].y) / 2;

    // 1. Two-finger drag pan
    const panDx = midX - lastPinchMidX;
    const panDy = midY - lastPinchMidY;
    if (Math.abs(panDx) > 0 || Math.abs(panDy) > 0) {
      physics.camera.panBy(panDx, panDy, true);
    }

    // 2. Two-finger pinch zoom
    if (initialPinchDist > 10 && currentDist > 10) {
      const zoomRatio = currentDist / initialPinchDist;
      const factor = 1 + (zoomRatio - 1) * 0.45;
      physics.camera.zoomAt(midX, midY, factor);
      hud.updateZoom(physics.camera.targetZoom);
      initialPinchDist = currentDist;
    }

    lastPinchMidX = midX;
    lastPinchMidY = midY;
    return;
  }

  // Single-touch: cancel long-press if finger moves > 8px (to allow smooth dragging)
  if (longPressTimer !== null) {
    const dist = Math.hypot(e.clientX - longPressStartX, e.clientY - longPressStartY);
    if (dist > 8) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressTarget = null;
    }
  }

  // Desktop mouse panning
  if (isMousePanning) {
    e.preventDefault();
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    panStartX = e.clientX;
    panStartY = e.clientY;
    physics.camera.panBy(dx, dy, true);
  }
});

window.addEventListener('pointerup', (e: PointerEvent) => {
  const ptr = activePointers.get(e.pointerId);
  activePointers.delete(e.pointerId);

  if (isMultiTouching && activePointers.size < 2) {
    isMultiTouching = false;
    physics.isPanning = isMousePanning;
  }

  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressTarget = null;
  }

  if (isMousePanning && (e.button === 1 || e.button === 0)) {
    isMousePanning = false;
    physics.isPanning = false;
    updateCursorStyle();
  }

  // Mobile Touch Double-Tap to Spawn (< 300ms, distance < 28px)
  if (ptr && ptr.pointerType === 'touch' && !isMultiTouching) {
    const moveDist = Math.hypot(e.clientX - ptr.startX, e.clientY - ptr.startY);
    if (moveDist < 12) {
      const now = performance.now();
      const timeSinceLastTap = now - lastTouchTapTime;
      const tapDistance = Math.hypot(e.clientX - lastTouchTapX, e.clientY - lastTouchTapY);

      if (timeSinceLastTap > 40 && timeSinceLastTap < 300 && tapDistance < 28) {
        const worldPos = physics.screenToWorld(e.clientX, e.clientY);
        const hitBody = physics.getNodeAt(worldPos.x, worldPos.y);
        if (!hitBody) {
          promptSpawnAt(e.clientX, e.clientY);
        }
        lastTouchTapTime = 0;
      } else {
        lastTouchTapTime = now;
        lastTouchTapX = e.clientX;
        lastTouchTapY = e.clientY;
      }
    }
  }
});

window.addEventListener('pointercancel', (e: PointerEvent) => {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) {
    isMultiTouching = false;
    physics.isPanning = isMousePanning;
  }
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressTarget = null;
  }
});
