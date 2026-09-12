import {
  Plus,
  Maximize2,
  Orbit,
  Volume2,
  VolumeX,
  Share2,
  Activity,
  Layers,
  Disc,
  HelpCircle,
  createIcons,
} from 'lucide';

export interface HUDOptions {
  onSpawnRequested: () => void;
  onFrameRequested: () => void;
  onAutoClusterToggle: () => boolean;
  onSoundToggle: () => boolean;
  onExportRequested: () => void;
  onHelpRequested: () => void;
  initialSoundMuted: boolean;
  initialAutoCluster: boolean;
}

/**
 * Detects whether the current device/browser environment is a touch device.
 */
export function isTouchDevice(): boolean {
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches
  );
}

export class HUD {
  private options: HUDOptions;
  private isTouch: boolean;
  private isMuted: boolean;
  private isAutoCluster: boolean;
  private isShortcutsCollapsed: boolean = false;

  private dockElement: HTMLElement | null = null;
  private shortcutBarElement: HTMLElement | null = null;
  private expandBtnElement: HTMLElement | null = null;
  private autoClusterHeaderBtn: HTMLElement | null = null;
  private audioControlBtn: HTMLElement | null = null;

  private fpsDisplay: HTMLElement | null = null;
  private nodeCountDisplay: HTMLElement | null = null;
  private linkCountDisplay: HTMLElement | null = null;
  private zoomDisplay: HTMLElement | null = null;

  constructor(options: HUDOptions) {
    this.options = options;
    this.isTouch = isTouchDevice();
    this.isMuted = options.initialSoundMuted;
    this.isAutoCluster = options.initialAutoCluster;

    // Check saved collapsed state for desktop shortcut bar safely
    try {
      const savedCollapsed = localStorage.getItem('mental_defrag_hud_shortcuts_collapsed');
      this.isShortcutsCollapsed = savedCollapsed === 'true';
    } catch {
      this.isShortcutsCollapsed = false;
    }

    this.initHUD();
  }

  private initHUD(): void {
    if (this.isTouch) {
      document.body.classList.add('touch-device');
    }

    this.setupDesktopPanel();
    this.setupTopRightControls();

    if (this.isTouch) {
      this.setupMobileDock();
    }

    this.renderIcons();
  }

  /**
   * Set up desktop HUD panel, stats counters, and collapsible shortcut bar
   */
  private setupDesktopPanel(): void {
    const hudPanel = document.querySelector('.hud-panel');
    if (!hudPanel) return;

    // 1. Header Auto-Cluster button setup
    this.autoClusterHeaderBtn = document.getElementById('auto-cluster-btn');
    if (this.autoClusterHeaderBtn) {
      this.updateAutoClusterUI(this.isAutoCluster);
      this.autoClusterHeaderBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newState = this.options.onAutoClusterToggle();
        this.updateAutoCluster(newState);
      });
    }

    // Add expand button in header row (hidden when bar is open)
    const headerRow = hudPanel.querySelector('.hud-header-row');
    if (headerRow) {
      const expandBtn = document.createElement('button');
      expandBtn.id = 'hud-shortcut-expand-btn';
      expandBtn.className = `hud-shortcut-expand-btn ${this.isShortcutsCollapsed && !this.isTouch ? 'visible' : ''}`;
      expandBtn.title = 'Show keyboard shortcuts';
      expandBtn.setAttribute('aria-label', 'Show keyboard shortcuts');
      expandBtn.innerHTML = `<span>⌨</span> Shortcuts`;
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setShortcutsCollapsed(false);
      });
      headerRow.appendChild(expandBtn);
      this.expandBtnElement = expandBtn;
    }

    // 2. Replace static subtitle with collapsible shortcut bar
    const existingSubtitle = hudPanel.querySelector('.hud-subtitle');
    if (existingSubtitle) {
      const shortcutBar = document.createElement('div');
      shortcutBar.className = `hud-shortcut-bar ${this.isShortcutsCollapsed ? 'collapsed' : ''}`;
      shortcutBar.innerHTML = `
        <span class="hud-shortcut-text">Double-click or [N] to create • [Del] defrag • [F] frame • [S] cluster • [E] export • [?] shortcuts</span>
        <button class="hud-shortcut-close-btn" title="Hide shortcut bar" aria-label="Hide shortcut bar">✕</button>
      `;

      const closeBtn = shortcutBar.querySelector('.hud-shortcut-close-btn');
      closeBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setShortcutsCollapsed(true);
      });

      existingSubtitle.replaceWith(shortcutBar);
      this.shortcutBarElement = shortcutBar;
    }

    // 3. Populate Diagnostics / Stats bar
    let statsContainer = hudPanel.querySelector('.hud-stats') as HTMLElement;
    if (!statsContainer) {
      statsContainer = document.createElement('div');
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

    this.fpsDisplay = document.getElementById('fps-display');
    this.nodeCountDisplay = document.getElementById('node-count-display');
    this.linkCountDisplay = document.getElementById('link-count-display');
    this.zoomDisplay = document.getElementById('zoom-display');
  }

  /**
   * Set up desktop top-right controls (Audio mute toggle & Help cheat sheet)
   */
  private setupTopRightControls(): void {
    this.audioControlBtn = document.getElementById('audio-control-btn');
    const helpBtn = document.getElementById('help-btn');

    if (this.audioControlBtn) {
      this.renderAudioIcon(this.isMuted);
      this.audioControlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newState = this.options.onSoundToggle();
        this.updateSound(newState);
      });
    }

    if (helpBtn) {
      helpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.options.onHelpRequested();
      });
    }
  }

  /**
   * Mount Mobile Responsive Floating Action Dock at bottom center
   */
  private setupMobileDock(): void {
    let dock = document.getElementById('mobile-action-dock');
    if (!dock) {
      dock = document.createElement('nav');
      dock.id = 'mobile-action-dock';
      dock.className = 'mobile-action-dock';
      dock.setAttribute('aria-label', 'Canvas quick actions');
      dock.innerHTML = `
        <button id="dock-spawn-btn" class="dock-btn dock-btn-primary" aria-label="Create New Node" title="New Node">
          <i data-lucide="plus"></i>
          <span class="dock-tooltip">New Node</span>
        </button>
        <button id="dock-frame-btn" class="dock-btn" aria-label="Frame All Nodes" title="Frame All">
          <i data-lucide="maximize-2"></i>
          <span class="dock-tooltip">Frame All</span>
        </button>
        <button id="dock-cluster-btn" class="dock-btn ${this.isAutoCluster ? 'active' : ''}" aria-label="Toggle Auto-Clustering" title="Auto-Cluster">
          <i data-lucide="orbit"></i>
          <span class="dock-tooltip">Auto-Cluster</span>
        </button>
        <button id="dock-sound-btn" class="dock-btn ${this.isMuted ? 'muted' : ''}" aria-label="Toggle Sound Effects" title="Toggle Sound">
          <i data-lucide="${this.isMuted ? 'volume-x' : 'volume-2'}"></i>
          <span class="dock-tooltip">Sound</span>
        </button>
        <button id="dock-export-btn" class="dock-btn" aria-label="Export & Backup Canvas" title="Export">
          <i data-lucide="share-2"></i>
          <span class="dock-tooltip">Export</span>
        </button>
      `;

      document.body.appendChild(dock);
    }
    this.dockElement = dock;

    // Attach touch/click listeners to dock buttons
    const spawnBtn = dock.querySelector('#dock-spawn-btn');
    spawnBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.triggerHaptic();
      this.options.onSpawnRequested();
    });

    const frameBtn = dock.querySelector('#dock-frame-btn');
    frameBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.triggerHaptic();
      this.options.onFrameRequested();
    });

    const clusterBtn = dock.querySelector('#dock-cluster-btn');
    clusterBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.triggerHaptic();
      const newState = this.options.onAutoClusterToggle();
      this.updateAutoCluster(newState);
    });

    const soundBtn = dock.querySelector('#dock-sound-btn');
    soundBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.triggerHaptic();
      const newState = this.options.onSoundToggle();
      this.updateSound(newState);
    });

    const exportBtn = dock.querySelector('#dock-export-btn');
    exportBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.triggerHaptic();
      this.options.onExportRequested();
    });
  }

  /**
   * Subtle haptic feedback for touch dock interactions
   */
  private triggerHaptic(): void {
    if (typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(25);
      } catch {
        // Ignore haptic failures
      }
    }
  }

  /**
   * Toggle desktop shortcut instructions bar
   */
  public setShortcutsCollapsed(collapsed: boolean): void {
    this.isShortcutsCollapsed = collapsed;
    try {
      localStorage.setItem('mental_defrag_hud_shortcuts_collapsed', String(collapsed));
    } catch {
      // Ignore storage errors in private browsing or quota limits
    }

    if (this.shortcutBarElement) {
      if (collapsed) {
        this.shortcutBarElement.classList.add('collapsed');
      } else {
        this.shortcutBarElement.classList.remove('collapsed');
      }
    }

    if (this.expandBtnElement && !this.isTouch) {
      if (collapsed) {
        this.expandBtnElement.classList.add('visible');
      } else {
        this.expandBtnElement.classList.remove('visible');
      }
    }
  }

  /**
   * Update FPS counter
   */
  public updateFps(fps: number): void {
    if (this.fpsDisplay) {
      this.fpsDisplay.textContent = `${fps} FPS`;
    }
  }

  /**
   * Update node count display
   */
  public updateNodeCount(count: number): void {
    if (this.nodeCountDisplay) {
      this.nodeCountDisplay.textContent = `${count} Node${count === 1 ? '' : 's'}`;
    }
  }

  /**
   * Update spring constraints link count display
   */
  public updateLinkCount(count: number): void {
    if (this.linkCountDisplay) {
      this.linkCountDisplay.textContent = `${count} Link${count === 1 ? '' : 's'}`;
    }
  }

  /**
   * Update camera zoom level display
   */
  public updateZoom(zoom: number): void {
    if (this.zoomDisplay) {
      this.zoomDisplay.textContent = `${Math.round(zoom * 100)}%`;
    }
  }

  /**
   * Update auto-cluster state across header button and mobile dock
   */
  public updateAutoCluster(enabled: boolean): void {
    this.isAutoCluster = enabled;
    this.updateAutoClusterUI(enabled);

    const dockClusterBtn = this.dockElement?.querySelector('#dock-cluster-btn');
    if (dockClusterBtn) {
      if (enabled) {
        dockClusterBtn.classList.add('active');
      } else {
        dockClusterBtn.classList.remove('active');
      }
    }
  }

  private updateAutoClusterUI(enabled: boolean): void {
    if (!this.autoClusterHeaderBtn) return;
    if (enabled) {
      this.autoClusterHeaderBtn.classList.add('active');
    } else {
      this.autoClusterHeaderBtn.classList.remove('active');
    }
  }

  /**
   * Update audio mute icon across desktop control toolbar and mobile dock
   */
  public updateSound(isMuted: boolean): void {
    this.isMuted = isMuted;
    this.renderAudioIcon(isMuted);

    const dockSoundBtn = this.dockElement?.querySelector('#dock-sound-btn');
    if (dockSoundBtn) {
      dockSoundBtn.className = `dock-btn ${isMuted ? 'muted' : ''}`;
      dockSoundBtn.innerHTML = `
        <i data-lucide="${isMuted ? 'volume-x' : 'volume-2'}"></i>
        <span class="dock-tooltip">Sound</span>
      `;
      createIcons({
        icons: {
          Volume2,
          VolumeX,
        },
      });
    }
  }

  private renderAudioIcon(isMuted: boolean): void {
    if (!this.audioControlBtn) return;
    this.audioControlBtn.innerHTML = isMuted
      ? '<i data-lucide="volume-x"></i>'
      : '<i data-lucide="volume-2"></i>';
    createIcons({
      icons: {
        Volume2,
        VolumeX,
      },
    });
  }

  /**
   * Re-render all Lucide icons
   */
  public renderIcons(): void {
    createIcons({
      icons: {
        Plus,
        Maximize2,
        Orbit,
        Volume2,
        VolumeX,
        Share2,
        Activity,
        Layers,
        Disc,
        HelpCircle,
      },
    });
  }
}
