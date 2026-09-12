import Matter from 'matter-js';
import { CameraController } from '../camera/camera';

export interface MiniMapOptions {
  camera: CameraController;
  onExportClick?: () => void;
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export class MiniMap {
  public container: HTMLElement;
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  private camera: CameraController;
  private onExportClick?: () => void;
  private isNavigating: boolean = false;
  private dpr: number = 1;

  public readonly mapWidth: number = 180;
  public readonly mapHeight: number = 120;

  private currentWorldBounds: WorldBounds = {
    minX: -2000,
    maxX: 2000,
    minY: -1333,
    maxY: 1333,
    width: 4000,
    height: 2667,
  };

  constructor(options: MiniMapOptions) {
    this.camera = options.camera;
    this.onExportClick = options.onExportClick;

    // 1. Create or query container
    let container = document.getElementById('minimap-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'minimap-container';
      container.className = 'minimap-container';
      container.innerHTML = `
        <div class="minimap-header">
          <div class="minimap-brand">
            <span class="minimap-tag">RADAR</span>
            <span class="minimap-ping"></span>
          </div>
          <button class="minimap-export-btn" id="minimap-export-btn" title="Export & Backup Canvas (E)" aria-label="Export Canvas">
            <span>⇪</span>
          </button>
        </div>
        <canvas class="minimap-canvas"></canvas>
      `;
      document.body.appendChild(container);
    }
    this.container = container;

    const exportBtn = container.querySelector('#minimap-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.onExportClick?.();
      });
      exportBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    const canvas = container.querySelector('.minimap-canvas') as HTMLCanvasElement;
    if (!canvas) {
      throw new Error('Could not find .minimap-canvas element');
    }
    this.canvas = canvas;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get 2D context for minimap');
    }
    this.ctx = ctx;

    this.setupDpr();
    this.setupInteractions();

    window.addEventListener('resize', () => {
      this.setupDpr();
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        this.setupDpr();
      });
    }
  }

  private setupDpr(): void {
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.mapWidth * this.dpr);
    this.canvas.height = Math.round(this.mapHeight * this.dpr);
    this.canvas.style.width = `${this.mapWidth}px`;
    this.canvas.style.height = `${this.mapHeight}px`;
  }

  private setupInteractions(): void {
    const handleStart = (clientX: number, clientY: number, e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.isNavigating = true;
      this.container.classList.add('active');
      this.navigateToClientPos(clientX, clientY);
    };

    const handleMove = (clientX: number, clientY: number, e: Event) => {
      if (!this.isNavigating) return;
      e.preventDefault();
      e.stopPropagation();
      this.navigateToClientPos(clientX, clientY);
    };

    const handleEnd = (e: Event) => {
      if (this.isNavigating) {
        this.isNavigating = false;
        this.container.classList.remove('active');
        e.stopPropagation();
      }
    };

    // Mouse Events
    this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
      handleStart(e.clientX, e.clientY, e);
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY, e);
    });

    window.addEventListener('mouseup', (e: MouseEvent) => {
      handleEnd(e);
    });

    // Touch Events
    this.canvas.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        if (e.touches.length > 0) {
          handleStart(e.touches[0].clientX, e.touches[0].clientY, e);
        }
      },
      { passive: false }
    );

    window.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        if (this.isNavigating && e.touches.length > 0) {
          handleMove(e.touches[0].clientX, e.touches[0].clientY, e);
        }
      },
      { passive: false }
    );

    window.addEventListener('touchend', (e: TouchEvent) => {
      handleEnd(e);
    });
    window.addEventListener('touchcancel', (e: TouchEvent) => {
      handleEnd(e);
    });
  }

  private navigateToClientPos(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const mx = Math.max(0, Math.min(this.mapWidth, clientX - rect.left));
    const my = Math.max(0, Math.min(this.mapHeight, clientY - rect.top));

    // Convert minimap coordinates to world coordinates
    const wx = this.currentWorldBounds.minX + (mx / this.mapWidth) * this.currentWorldBounds.width;
    const wy = this.currentWorldBounds.minY + (my / this.mapHeight) * this.currentWorldBounds.height;

    // Smoothly pan camera to center on world coordinates (wx, wy)
    this.camera.targetX = window.innerWidth / 2 - wx * this.camera.targetZoom;
    this.camera.targetY = window.innerHeight / 2 - wy * this.camera.targetZoom;
  }

  /**
   * Render radar mini-map frame
   */
  public render(
    nodes: Matter.Body[],
    springConstraints: Matter.Constraint[],
    camera: CameraController
  ): void {
    const ctx = this.ctx;
    const width = this.mapWidth;
    const height = this.mapHeight;

    // Ensure DPR transform
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // 1. Calculate world bounds containing visible frustum and all active nodes
    const visible = camera.getVisibleBounds(window.innerWidth, window.innerHeight);
    let minX = visible.minX;
    let maxX = visible.maxX;
    let minY = visible.minY;
    let maxY = visible.maxY;

    for (let i = 0; i < nodes.length; i++) {
      const b = nodes[i];
      minX = Math.min(minX, b.position.x - 120);
      maxX = Math.max(maxX, b.position.x + 120);
      minY = Math.min(minY, b.position.y - 120);
      maxY = Math.max(maxY, b.position.y + 120);
    }

    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    // Minimum radar world coverage of 4000x2667 (1.5:1 aspect ratio)
    let spanW = Math.max(4000, (maxX - minX) * 1.15);
    let spanH = Math.max(2667, (maxY - minY) * 1.15);

    if (spanW / spanH > 1.5) {
      spanH = spanW / 1.5;
    } else {
      spanW = spanH * 1.5;
    }

    this.currentWorldBounds = {
      minX: midX - spanW / 2,
      maxX: midX + spanW / 2,
      minY: midY - spanH / 2,
      maxY: midY + spanH / 2,
      width: spanW,
      height: spanH,
    };

    const worldToMap = (wx: number, wy: number) => ({
      x: ((wx - this.currentWorldBounds.minX) / this.currentWorldBounds.width) * width,
      y: ((wy - this.currentWorldBounds.minY) / this.currentWorldBounds.height) * height,
    });

    // 2. Draw subtle origin crosshair (0,0)
    const origin = worldToMap(0, 0);
    if (origin.x >= 0 && origin.x <= width && origin.y >= 0 && origin.y <= height) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(origin.x - 4, origin.y);
      ctx.lineTo(origin.x + 4, origin.y);
      ctx.moveTo(origin.x, origin.y - 4);
      ctx.lineTo(origin.x, origin.y + 4);
      ctx.stroke();
    }

    // 3. Draw spring connections as ultra-faint lines
    if (springConstraints.length > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < springConstraints.length; i++) {
        const c = springConstraints[i];
        if (!c.bodyA || !c.bodyB) continue;
        const pA = worldToMap(c.bodyA.position.x, c.bodyA.position.y);
        const pB = worldToMap(c.bodyB.position.x, c.bodyB.position.y);
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
      }
      ctx.stroke();
    }

    // 4. Draw active nodes as glowing micro dots
    for (let i = 0; i < nodes.length; i++) {
      const b = nodes[i];
      const p = worldToMap(b.position.x, b.position.y);

      // Cyan accent dot
      ctx.fillStyle = '#38bdf8';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // 5. Draw dynamic rectangular wireframe frustum representing camera viewport
    const tl = worldToMap(visible.minX, visible.minY);
    const br = worldToMap(visible.maxX, visible.maxY);
    const fw = br.x - tl.x;
    const fh = br.y - tl.y;

    // Highlight area
    ctx.fillStyle = 'rgba(56, 189, 248, 0.06)';
    ctx.fillRect(tl.x, tl.y, fw, fh);

    // Wireframe rectangle
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(tl.x, tl.y, fw, fh);
  }
}
