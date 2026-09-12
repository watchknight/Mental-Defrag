import { PhysicsEngine } from '../physics/engine';
import { soundFX } from '../audio/soundFX';

export interface ShortcutEngineOptions {
  physics: PhysicsEngine;
  onSpawnRequested: (screenX: number, screenY: number) => void;
  onMuteToggled?: (isMuted: boolean) => void;
  onAutoClusterToggled?: (enabled: boolean) => void;
  onExportRequested?: () => void;
}

let activeToastTimeout: number | null = null;

export function showHudToast(message: string, durationMs: number = 1800): void {
  let toast = document.getElementById('hud-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'hud-toast';
    toast.className = 'hud-toast';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add('visible');

  if (activeToastTimeout !== null) {
    clearTimeout(activeToastTimeout);
  }

  activeToastTimeout = window.setTimeout(() => {
    toast?.classList.remove('visible');
    activeToastTimeout = null;
  }, durationMs);
}

export class ShortcutEngine {
  private physics: PhysicsEngine;
  private onSpawnRequested: (screenX: number, screenY: number) => void;
  private onMuteToggled?: (isMuted: boolean) => void;
  private onAutoClusterToggled?: (enabled: boolean) => void;
  private onExportRequested?: () => void;
  private modalElement: HTMLElement | null = null;
  private isModalOpen: boolean = false;

  constructor(options: ShortcutEngineOptions) {
    this.physics = options.physics;
    this.onSpawnRequested = options.onSpawnRequested;
    this.onMuteToggled = options.onMuteToggled;
    this.onAutoClusterToggled = options.onAutoClusterToggled;
    this.onExportRequested = options.onExportRequested;

    this.createModal();
    this.setupListeners();
  }

  private isInputFocused(): boolean {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName.toLowerCase();
    return (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      active.getAttribute('contenteditable') === 'true'
    );
  }

  private createModal(): void {
    let modal = document.getElementById('shortcut-cheat-sheet');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'shortcut-cheat-sheet';
      modal.className = 'shortcut-modal-backdrop';
      modal.innerHTML = `
        <div class="shortcut-modal-card">
          <div class="shortcut-modal-header">
            <div class="shortcut-modal-title">
              <span class="shortcut-title-icon">⌘</span>
              <span>Keyboard & Gesture Shortcuts</span>
            </div>
            <button class="shortcut-modal-close" aria-label="Close shortcuts">✕</button>
          </div>
          <div class="shortcut-modal-body">
            <div class="shortcut-grid">
              <div class="shortcut-row">
                <span class="shortcut-desc">Create node at cursor</span>
                <span class="shortcut-keys"><kbd>N</kbd> or <kbd>C</kbd> / <kbd>Double-click</kbd></span>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Defrag hovered node</span>
                <span class="shortcut-keys"><kbd>Backspace</kbd> / <kbd>Delete</kbd> / <kbd>Right-click</kbd></span>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Frame all active nodes</span>
                <span class="shortcut-keys"><kbd>F</kbd></span>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Reset camera (100% origin)</span>
                <span class="shortcut-keys"><kbd>0</kbd> or <kbd>Ctrl</kbd>+<kbd>0</kbd></span>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Pan infinite canvas</span>
                <span class="shortcut-keys"><kbd>Space</kbd> + <kbd>Drag</kbd> / <kbd>Middle-drag</kbd></span>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Smooth zoom (25% – 300%)</span>
                <span class="shortcut-keys"><kbd>Wheel</kbd> / <kbd>Pinch</kbd></span>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Toggle sound effects</span>
                <span class="shortcut-keys"><kbd>M</kbd></span>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Toggle semantic clustering</span>
                <span class="shortcut-keys"><kbd>S</kbd></span>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Export & Backup Canvas</span>
                <span class="shortcut-keys"><kbd>E</kbd> or <kbd>Ctrl</kbd>+<kbd>E</kbd></span>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Import Obsidian / JSON</span>
                <span class="shortcut-keys"><kbd>Drop</kbd> file anywhere</span>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Radar Mini-map navigation</span>
                <span class="shortcut-keys"><kbd>Click</kbd> / <kbd>Drag</kbd> on radar</span>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Toggle shortcut guide</span>
                <span class="shortcut-keys"><kbd>?</kbd></span>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Cancel / Close dialog</span>
                <span class="shortcut-keys"><kbd>Esc</kbd></span>
              </div>
            </div>
          </div>
          <div class="shortcut-modal-footer">
            <span>Press <kbd>Esc</kbd> or click outside to dismiss</span>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    this.modalElement = modal;

    const closeBtn = modal.querySelector('.shortcut-modal-close');
    closeBtn?.addEventListener('click', () => {
      this.closeModal();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeModal();
      }
    });
  }

  public openModal(): void {
    if (!this.modalElement) return;
    this.isModalOpen = true;
    this.modalElement.classList.add('visible');
  }

  public closeModal(): void {
    if (!this.modalElement) return;
    this.isModalOpen = false;
    this.modalElement.classList.remove('visible');
  }

  public toggleModal(): void {
    if (this.isModalOpen) {
      this.closeModal();
    } else {
      this.openModal();
    }
  }

  /**
   * Frames all active nodes with 15% margin padding
   */
  public frameAllNodes(): void {
    const nodes = this.physics.nodeBodies;
    const camera = this.physics.camera;

    if (nodes.length === 0) {
      camera.targetZoom = 1.0;
      camera.targetX = window.innerWidth / 2;
      camera.targetY = window.innerHeight / 2;
      showHudToast('Origin Centered (No nodes)');
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < nodes.length; i++) {
      const b = nodes[i];
      const radius = (b as unknown as { nodeData?: { radius: number } }).nodeData?.radius || 50;
      minX = Math.min(minX, b.position.x - radius);
      maxX = Math.max(maxX, b.position.x + radius);
      minY = Math.min(minY, b.position.y - radius);
      maxY = Math.max(maxY, b.position.y + radius);
    }

    const spanW = Math.max(120, maxX - minX);
    const spanH = Math.max(120, maxY - minY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // 15% margin padding on all sides (effective viewport: 70% of screen)
    const availW = window.innerWidth * 0.70;
    const availH = window.innerHeight * 0.70;

    const fitZoom = Math.min(availW / spanW, availH / spanH);
    const targetZoom = Math.max(0.25, Math.min(2.0, fitZoom));

    camera.targetZoom = targetZoom;
    camera.targetX = window.innerWidth / 2 - centerX * targetZoom;
    camera.targetY = window.innerHeight / 2 - centerY * targetZoom;

    showHudToast(`Framed ${nodes.length} Node${nodes.length === 1 ? '' : 's'}`);
  }

  /**
   * Resets camera to origin (0, 0) with 1.0 zoom
   */
  public resetView(): void {
    const camera = this.physics.camera;
    camera.targetZoom = 1.0;
    camera.targetX = window.innerWidth / 2;
    camera.targetY = window.innerHeight / 2;
    showHudToast('View Reset (100%)');
  }

  /**
   * Defrag currently hovered node under cursor
   */
  public defragHoveredNode(): void {
    const cursor = this.physics.getCursorPosition();
    if (!cursor) {
      showHudToast('Hover a node to defrag');
      return;
    }

    const worldPos = this.physics.screenToWorld(cursor.x, cursor.y);
    let hit = this.physics.getNodeAt(worldPos.x, worldPos.y);

    // If slightly off center, check proximity within radius + 12px
    if (!hit) {
      for (const b of this.physics.nodeBodies) {
        const radius = (b as unknown as { nodeData?: { radius: number } }).nodeData?.radius || 50;
        const dist = Math.hypot(b.position.x - worldPos.x, b.position.y - worldPos.y);
        if (dist <= radius + 12) {
          hit = b;
          break;
        }
      }
    }

    if (hit) {
      const text = (hit as unknown as { nodeData?: { text: string } }).nodeData?.text || 'Node';
      soundFX.playDefrag();
      this.physics.defragNode(hit);
      const label = text.length > 20 ? `${text.substring(0, 18)}...` : text;
      showHudToast(`Defragged "${label}"`);
    } else {
      showHudToast('No node hovered');
    }
  }

  private setupListeners(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      // Handle Escape for modal or cancel
      if (e.key === 'Escape') {
        if (this.isModalOpen) {
          e.preventDefault();
          this.closeModal();
          return;
        }
      }

      // Suppress all shortcuts when typing inside an input or editable field
      if (this.isInputFocused()) {
        return;
      }

      // 1. Toggle Cheat Sheet Modal with '?'
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        this.toggleModal();
        return;
      }

      // 2. Mute Audio with 'M'
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        const isMuted = soundFX.toggleMute();
        if (this.onMuteToggled) {
          this.onMuteToggled(isMuted);
        }
        showHudToast(isMuted ? 'Sound: Muted' : 'Sound: Enabled');
        return;
      }

      // 3. Reset Zoom and Center with '0' or Ctrl+0 / Cmd+0
      if (e.key === '0' || (e.ctrlKey && e.key === '0') || (e.metaKey && e.key === '0')) {
        e.preventDefault();
        this.resetView();
        return;
      }

      // 4. Frame All Nodes with 'F'
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        this.frameAllNodes();
        return;
      }

      // 5. Spawn Node at Cursor with 'N' or 'C'
      if (e.key === 'n' || e.key === 'N' || e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        const cursor = this.physics.getCursorPosition() || {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        };
        this.onSpawnRequested(cursor.x, cursor.y);
        return;
      }

      // 6. Burst / Defrag Hovered Node with 'Backspace' or 'Delete'
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        this.defragHoveredNode();
        return;
      }

      // 7. Toggle Semantic Auto-Clustering with 'S'
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        const enabled = this.physics.toggleAutoClustering();
        if (this.onAutoClusterToggled) {
          this.onAutoClusterToggled(enabled);
        }
        showHudToast(enabled ? 'Semantic Clustering: ON' : 'Semantic Clustering: OFF');
        return;
      }

      // 8. Open Export & Backup Modal with 'E' or Ctrl+E / Cmd+E
      if ((e.key === 'e' || e.key === 'E') && !e.altKey) {
        e.preventDefault();
        if (this.onExportRequested) {
          this.onExportRequested();
        }
        return;
      }
    });
  }
}
