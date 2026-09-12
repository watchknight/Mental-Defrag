import Matter from 'matter-js';
import { SerializedNode, saveCanvasState } from '../storage/storage';
import { CanvasRenderer } from '../renderer/canvasRenderer';
import { CameraController } from '../camera/camera';
import { ClusterColor, createFastPathEmbedding, computeEmbedding, updateNodeClusters } from '../ai/clustering';
import { SemanticForcesManager } from './semanticForces';

const { Engine, Runner, Bodies, Composite, Mouse, MouseConstraint, Body, Query, Events, Constraint } = Matter;

export interface TrailPoint {
  x: number;
  y: number;
}

export interface NodeData {
  id: string;
  text: string;
  radius: number;
  createdAt: number;
  trail?: TrailPoint[];
  embedding?: Float32Array;
  clusterId?: number;
  clusterColor?: ClusterColor;
}

export interface SpringData {
  id: string;
  bodyA: Matter.Body;
  bodyB: Matter.Body;
  restLength: number;
  createdAt: number;
}

export interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  initialSize: number;
  glowColor: string;
  fillColor: string;
  birthTime: number;
  lifetime: number; // 600ms
}

export interface PhysicsEngineOptions {
  canvas: HTMLCanvasElement;
  onFpsUpdate?: (fps: number) => void;
  onNodeCountUpdate?: (count: number) => void;
  onLinkCountUpdate?: (count: number) => void;
  onCollision?: () => void;
  onDragStart?: () => void;
  onLinkCreated?: () => void;
  onAfterRender?: () => void;
}

/**
 * Calculates dynamic radius based on text length clamped between 42px and 85px.
 */
export function calculateNodeRadius(text: string): number {
  const len = text.trim().length;
  const normalized = Math.max(0, Math.min(1, (len - 3) / 72));
  const radius = 42 + normalized * (85 - 42);
  return Math.round(Math.min(85, Math.max(42, radius)));
}

export class PhysicsEngine {
  public engine: Matter.Engine;
  public runner: Matter.Runner;
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  public renderer: CanvasRenderer;
  public camera: CameraController;
  public mouseConstraint: Matter.MouseConstraint;
  public mouse: Matter.Mouse;
  public isPanning: boolean = false;

  public nodeBodies: Matter.Body[] = [];
  public springConstraints: Matter.Constraint[] = [];
  public semanticForces: SemanticForcesManager;
  private burstParticles: BurstParticle[] = [];

  private animFrameId: number | null = null;
  private dpr: number = 1;

  private onFpsUpdate?: (fps: number) => void;
  private onNodeCountUpdate?: (count: number) => void;
  private onLinkCountUpdate?: (count: number) => void;
  private onCollision?: () => void;
  private onDragStart?: () => void;
  private onLinkCreated?: () => void;
  public onAfterRender?: () => void;

  private lastFpsCalcTime: number = performance.now();
  private frameCount: number = 0;
  private lastDraggedBody: Matter.Body | null = null;
  private lastCollisionSoundTime: number = 0;
  private saveTimeout: number | null = null;
  private cursorPosition: { x: number; y: number } | null = null;

  public getCursorPosition(): { x: number; y: number } | null {
    return this.cursorPosition ? { ...this.cursorPosition } : null;
  }

  private handleMouseMove: (e: MouseEvent) => void;
  private handleMouseLeave: () => void;
  private handleWindowMouseOut: (e: MouseEvent) => void;
  private handleTouchMove: (e: TouchEvent) => void;
  private handleTouchEnd: () => void;

  constructor(options: PhysicsEngineOptions) {
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not obtain 2D canvas rendering context');
    }
    this.ctx = ctx;
    this.renderer = new CanvasRenderer(this.canvas, this.ctx);
    this.camera = new CameraController();

    this.onFpsUpdate = options.onFpsUpdate;
    this.onNodeCountUpdate = options.onNodeCountUpdate;
    this.onLinkCountUpdate = options.onLinkCountUpdate;
    this.onCollision = options.onCollision;
    this.onDragStart = options.onDragStart;
    this.onLinkCreated = options.onLinkCreated;
    this.onAfterRender = options.onAfterRender;

    // 1. Matter Engine with strictly ZERO gravity
    this.engine = Engine.create({
      gravity: {
        x: 0,
        y: 0,
        scale: 0,
      },
    });
    this.engine.gravity.x = 0;
    this.engine.gravity.y = 0;
    this.engine.gravity.scale = 0;

    this.semanticForces = new SemanticForcesManager(this.engine);

    // 2. Setup canvas dimensions and DPR
    this.dpr = this.renderer.updateDimensions();

    // 3. Setup Mouse & MouseConstraint
    this.mouse = Mouse.create(this.canvas);
    this.mouse.pixelRatio = this.dpr;

    this.mouseConstraint = MouseConstraint.create(this.engine, {
      mouse: this.mouse,
      constraint: {
        stiffness: 0.2,
        damping: 0.1,
        render: {
          visible: false,
        },
      },
    });
    Composite.add(this.engine.world, this.mouseConstraint);

    // 4. 60 FPS runner
    this.runner = Runner.create({
      isFixed: false,
    });

    // Window resize handler
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);

    // 5. Track cursor position and reset when leaving window
    this.handleMouseMove = (e: MouseEvent) => {
      this.cursorPosition = { x: e.clientX, y: e.clientY };
    };
    this.handleMouseLeave = () => {
      this.cursorPosition = null;
    };
    this.handleWindowMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget) {
        this.cursorPosition = null;
      }
    };
    this.handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        this.cursorPosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };
    this.handleTouchEnd = () => {
      this.cursorPosition = null;
    };

    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
    window.addEventListener('mouseout', this.handleWindowMouseOut);
    this.canvas.addEventListener('touchmove', this.handleTouchMove, { passive: true });
    this.canvas.addEventListener('touchend', this.handleTouchEnd, { passive: true });
    this.canvas.addEventListener('touchcancel', this.handleTouchEnd, { passive: true });

    // 6. Physics Lifecycle Hooks: Mouse Sync, Repulsion Field & Soft Orbital Gravity
    Events.on(this.engine, 'beforeUpdate', () => {
      // Synchronize Matter.Mouse with Camera transform
      Matter.Mouse.setOffset(this.mouse, {
        x: -this.camera.x / this.camera.zoom,
        y: -this.camera.y / this.camera.zoom,
      });
      Matter.Mouse.setScale(this.mouse, {
        x: 1 / this.camera.zoom,
        y: 1 / this.camera.zoom,
      });

      // If camera is actively panning, prevent MouseConstraint from grabbing bodies
      if (this.isPanning && this.mouseConstraint.body) {
        (this.mouseConstraint as unknown as { body: Matter.Body | null }).body = null;
        this.mouseConstraint.constraint.bodyB = null;
      }

      // Cursor Magnetic Repulsion Field (in world coordinates)
      if (this.cursorPosition && !this.isPanning) {
        const cursorWorld = this.screenToWorld(this.cursorPosition.x, this.cursorPosition.y);
        const REPULSION_RADIUS = 140;
        const FORCE_CONSTANT = 0.0025;
        const draggedBody = this.mouseConstraint.body;

        for (let i = 0; i < this.nodeBodies.length; i++) {
          const node = this.nodeBodies[i];
          if (draggedBody && node === draggedBody) continue;

          const dx = node.position.x - cursorWorld.x;
          const dy = node.position.y - cursorWorld.y;
          const dist = Math.hypot(dx, dy);

          if (dist < REPULSION_RADIUS && dist > 0.001) {
            const normalX = dx / dist;
            const normalY = dy / dist;
            const factor = Math.pow(1 - dist / REPULSION_RADIUS, 2);
            const forceMagnitude = FORCE_CONSTANT * factor;

            Body.applyForce(node, node.position, {
              x: normalX * forceMagnitude,
              y: normalY * forceMagnitude,
            });
          }
        }
      }

      // Soft Orbital Gravity: pull nodes gently towards origin (0, 0) if drifting > 2500px
      const DRIFT_LIMIT = 2500;
      const PULL_STRENGTH = 0.00035;

      for (let i = 0; i < this.nodeBodies.length; i++) {
        const node = this.nodeBodies[i];
        const dist = Math.hypot(node.position.x, node.position.y);

        if (dist > DRIFT_LIMIT) {
          const excess = dist - DRIFT_LIMIT;
          const dirX = -node.position.x / dist;
          const dirY = -node.position.y / dist;
          const forceMag = PULL_STRENGTH * Math.min(excess / 400, 2.5);

          Body.applyForce(node, node.position, {
            x: dirX * forceMag,
            y: dirY * forceMag,
          });
        }
      }

      // Automated Semantic Clustering Attraction Forces
      this.semanticForces.updateForces(
        this.nodeBodies,
        this.mouseConstraint,
        this.hasConnection.bind(this)
      );
    });

    // Setup FPS runner tracking
    Events.on(this.runner, 'afterTick', () => {
      this.frameCount++;
      const now = performance.now();
      const delta = now - this.lastFpsCalcTime;
      if (delta >= 500) {
        const fps = Math.round((this.frameCount * 1000) / delta);
        this.frameCount = 0;
        this.lastFpsCalcTime = now;
        if (this.onFpsUpdate) {
          this.onFpsUpdate(fps);
        }
      }

      if (this.mouseConstraint.body) {
        this.requestSave();
      }
    });

    // Drag events
    Events.on(this.mouseConstraint, 'startdrag', () => {
      if (this.onDragStart && !this.isPanning) {
        this.onDragStart();
      }
    });

    Events.on(this.mouseConstraint, 'enddrag', (event: unknown) => {
      const evt = event as { body?: Matter.Body };
      if (evt.body) {
        this.handleNodeRelease(evt.body);
      }
      this.requestSave();
    });

    // Collision sound events with 80ms throttle
    Events.on(this.engine, 'collisionStart', () => {
      const now = performance.now();
      if (now - this.lastCollisionSoundTime > 80) {
        this.lastCollisionSoundTime = now;
        if (this.onCollision) {
          this.onCollision();
        }
      }
    });
  }

  /**
   * Helper: Screen to World coordinates
   */
  public screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return this.camera.screenToWorld(sx, sy);
  }

  /**
   * Helper: World to Screen coordinates
   */
  public worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return this.camera.worldToScreen(wx, wy);
  }

  /**
   * Window resize handler
   */
  private handleResize(): void {
    this.dpr = this.renderer.updateDimensions();
    if (this.mouse) {
      this.mouse.pixelRatio = this.dpr;
    }
    this.requestSave();
  }

  /**
   * Hit-test at world coordinate (x, y) to check if a node exists
   */
  public getNodeAt(worldX: number, worldY: number): Matter.Body | null {
    const hits = Query.point(this.nodeBodies, { x: worldX, y: worldY });
    return hits.length > 0 ? hits[0] : null;
  }

  /**
   * Check if a constraint already links bodyA and bodyB
   */
  public hasConnection(bodyA: Matter.Body, bodyB: Matter.Body): boolean {
    return this.springConstraints.some(
      (c) =>
        (c.bodyA === bodyA && c.bodyB === bodyB) ||
        (c.bodyA === bodyB && c.bodyB === bodyA)
    );
  }

  /**
   * Handle node release to form spring constraints within 140px proximity
   */
  public handleNodeRelease(releasedBody: Matter.Body): void {
    const PROXIMITY_RADIUS = 140;

    for (let i = 0; i < this.nodeBodies.length; i++) {
      const other = this.nodeBodies[i];
      if (other === releasedBody) continue;

      if (this.hasConnection(releasedBody, other)) continue;

      const dx = other.position.x - releasedBody.position.x;
      const dy = other.position.y - releasedBody.position.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= PROXIMITY_RADIUS) {
        this.createSpringConstraint(releasedBody, other, dist);
      }
    }
  }

  /**
   * Create a spring constraint between two nodes
   */
  public createSpringConstraint(
    bodyA: Matter.Body,
    bodyB: Matter.Body,
    restLength: number
  ): Matter.Constraint | null {
    if (this.hasConnection(bodyA, bodyB)) {
      return null;
    }

    const constraint = Constraint.create({
      bodyA,
      bodyB,
      stiffness: 0.035,
      damping: 0.08,
      length: restLength,
      render: {
        visible: false,
      },
    });

    const springData: SpringData = {
      id: `spring-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      bodyA,
      bodyB,
      restLength,
      createdAt: performance.now(),
    };

    (constraint as unknown as { springData: SpringData }).springData = springData;

    Composite.add(this.engine.world, constraint);
    this.springConstraints.push(constraint);

    if (this.onLinkCreated) {
      this.onLinkCreated();
    }
    if (this.onLinkCountUpdate) {
      this.onLinkCountUpdate(this.springConstraints.length);
    }

    this.requestSave();
    return constraint;
  }

  /**
   * Spawn a new glassmorphic node with text and dynamic radius
   */
  public createNode(x: number, y: number, text: string, customId?: string): Matter.Body {
    const radius = calculateNodeRadius(text);

    const body = Bodies.circle(x, y, radius, {
      restitution: 0.8,
      frictionAir: 0.04,
      friction: 0.05,
      label: 'thought-node',
    });

    const fastEmbedding = createFastPathEmbedding(text);

    const nodeData: NodeData = {
      id: customId || `node-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      text,
      radius,
      createdAt: Date.now(),
      trail: [],
      embedding: fastEmbedding,
    };

    (body as unknown as { nodeData: NodeData }).nodeData = nodeData;

    // Asynchronous transformer upgrade in background
    computeEmbedding(text)
      .then((denseVec) => {
        nodeData.embedding = denseVec;
        this.refreshClusters();
      })
      .catch(() => {
        // Fallback to fast-path already present
      });

    // Apply gentle random zero-g impulse
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.8 + Math.random() * 1.2;
    Body.setVelocity(body, {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    });

    Composite.add(this.engine.world, body);
    this.nodeBodies.push(body);
    this.refreshClusters();

    if (this.onNodeCountUpdate) {
      this.onNodeCountUpdate(this.nodeBodies.length);
    }

    this.requestSave();
    return body;
  }

  /**
   * Recalculates semantic cluster partitions and assigns harmonic colors
   */
  public refreshClusters(): void {
    const clusterable = this.nodeBodies
      .map((b) => (b as unknown as { nodeData?: NodeData }).nodeData)
      .filter((d): d is NodeData => Boolean(d));
    updateNodeClusters(clusterable, 0.60);
  }

  /**
   * The "Defrag" Burst:
   * Destroys the node, spawns 18 radial micro-particles decaying over 600ms,
   * and immediately removes the body and all attached constraints from the Matter.js World.
   */
  public defragNode(body: Matter.Body): void {
    const { x, y } = body.position;

    // 1. Spawn 18 glowing radial micro-particles
    const particleCount = 18;
    const now = performance.now();
    const colorPalette = [
      { fill: '#38bdf8', glow: 'rgba(56, 189, 248, 0.85)' },
      { fill: '#a78bfa', glow: 'rgba(167, 139, 250, 0.85)' },
      { fill: '#f43f5e', glow: 'rgba(244, 63, 94, 0.85)' },
      { fill: '#ffffff', glow: 'rgba(255, 255, 255, 0.9)' },
    ];

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const speed = 2.4 + Math.random() * 4.2;
      const palette = colorPalette[Math.floor(Math.random() * colorPalette.length)];

      this.burstParticles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        initialSize: 2.5 + Math.random() * 2.2,
        glowColor: palette.glow,
        fillColor: palette.fill,
        birthTime: now,
        lifetime: 600,
      });
    }

    // 2. Release MouseConstraint if this body was being dragged
    if (this.mouseConstraint.body === body) {
      this.mouseConstraint.constraint.bodyB = null;
      (this.mouseConstraint as unknown as { body: Matter.Body | null }).body = null;
    }
    if (this.lastDraggedBody === body) {
      this.lastDraggedBody = null;
    }

    // 3. Immediately remove all attached constraints from the Matter.js World
    const toRemove = this.springConstraints.filter(
      (c) => c.bodyA === body || c.bodyB === body
    );
    for (const c of toRemove) {
      Composite.remove(this.engine.world, c);
    }
    this.springConstraints = this.springConstraints.filter(
      (c) => c.bodyA !== body && c.bodyB !== body
    );

    // 4. Immediately remove node body from Matter.js World
    Composite.remove(this.engine.world, body);
    this.nodeBodies = this.nodeBodies.filter((b) => b !== body);

    // 5. Emit updated stats
    if (this.onNodeCountUpdate) {
      this.onNodeCountUpdate(this.nodeBodies.length);
    }
    if (this.onLinkCountUpdate) {
      this.onLinkCountUpdate(this.springConstraints.length);
    }

    this.refreshClusters();
    this.requestSave();
  }

  /**
   * Removes a node body without defrag particle explosion
   */
  public removeNode(body: Matter.Body): void {
    const toRemove = this.springConstraints.filter(
      (c) => c.bodyA === body || c.bodyB === body
    );
    for (const c of toRemove) {
      Composite.remove(this.engine.world, c);
    }
    this.springConstraints = this.springConstraints.filter(
      (c) => c.bodyA !== body && c.bodyB !== body
    );

    Composite.remove(this.engine.world, body);
    this.nodeBodies = this.nodeBodies.filter((b) => b !== body);

    if (this.onNodeCountUpdate) {
      this.onNodeCountUpdate(this.nodeBodies.length);
    }
    if (this.onLinkCountUpdate) {
      this.onLinkCountUpdate(this.springConstraints.length);
    }

    this.refreshClusters();
    this.requestSave();
  }

  /**
   * Exports current nodes and constraints to SerializedNode schema
   */
  public exportState(): SerializedNode[] {
    const result: SerializedNode[] = [];

    for (let i = 0; i < this.nodeBodies.length; i++) {
      const body = this.nodeBodies[i];
      const nodeData = (body as unknown as { nodeData?: NodeData }).nodeData;
      if (!nodeData) continue;

      const links: string[] = [];
      for (let j = 0; j < this.springConstraints.length; j++) {
        const c = this.springConstraints[j];
        if (c.bodyA === body && c.bodyB) {
          const otherData = (c.bodyB as unknown as { nodeData?: NodeData }).nodeData;
          if (otherData?.id) {
            links.push(otherData.id);
          }
        } else if (c.bodyB === body && c.bodyA) {
          const otherData = (c.bodyA as unknown as { nodeData?: NodeData }).nodeData;
          if (otherData?.id) {
            links.push(otherData.id);
          }
        }
      }

      result.push({
        id: nodeData.id,
        text: nodeData.text,
        x: Math.round(body.position.x),
        y: Math.round(body.position.y),
        links: Array.from(new Set(links)),
      });
    }

    return result;
  }

  /**
   * Debounced 500ms auto-save to localStorage
   */
  public requestSave(): void {
    if (this.saveTimeout !== null) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = window.setTimeout(() => {
      const state = this.exportState();
      saveCanvasState(state);
      this.saveTimeout = null;
    }, 500);
  }

  /**
   * Session Restore: Re-instantiate circular bodies and reconnect their constraints seamlessly
   */
  public restoreState(serializedNodes: SerializedNode[]): boolean {
    if (!serializedNodes || serializedNodes.length === 0) {
      return false;
    }

    // Clean current state
    for (const c of [...this.springConstraints]) {
      Composite.remove(this.engine.world, c);
    }
    this.springConstraints = [];

    for (const b of [...this.nodeBodies]) {
      Composite.remove(this.engine.world, b);
    }
    this.nodeBodies = [];

    const nodeMap = new Map<string, Matter.Body>();

    // 1. Recreate all circular bodies in world coordinates
    for (const data of serializedNodes) {
      const radius = calculateNodeRadius(data.text);

      const body = Bodies.circle(data.x, data.y, radius, {
        restitution: 0.8,
        frictionAir: 0.04,
        friction: 0.05,
        label: 'thought-node',
      });

      const fastEmbedding = createFastPathEmbedding(data.text);

      const nodeData: NodeData = {
        id: data.id,
        text: data.text,
        radius,
        createdAt: Date.now(),
        trail: [],
        embedding: fastEmbedding,
      };

      (body as unknown as { nodeData: NodeData }).nodeData = nodeData;

      computeEmbedding(data.text)
        .then((denseVec) => {
          nodeData.embedding = denseVec;
          this.refreshClusters();
        })
        .catch(() => {});

      Composite.add(this.engine.world, body);
      this.nodeBodies.push(body);
      nodeMap.set(data.id, body);
    }

    // 2. Recreate all constraints without duplicates
    for (const data of serializedNodes) {
      const bodyA = nodeMap.get(data.id);
      if (!bodyA || !data.links) continue;

      for (const targetId of data.links) {
        const bodyB = nodeMap.get(targetId);
        if (!bodyB || bodyA === bodyB) continue;

        if (this.hasConnection(bodyA, bodyB)) continue;

        const restLength = Math.hypot(
          bodyB.position.x - bodyA.position.x,
          bodyB.position.y - bodyA.position.y
        );

        this.createSpringConstraint(bodyA, bodyB, restLength);
      }
    }

    if (this.onNodeCountUpdate) {
      this.onNodeCountUpdate(this.nodeBodies.length);
    }
    if (this.onLinkCountUpdate) {
      this.onLinkCountUpdate(this.springConstraints.length);
    }

    this.refreshClusters();
    return true;
  }

  /**
   * Toggle automated semantic clustering on/off
   */
  public toggleAutoClustering(): boolean {
    return this.semanticForces.toggle();
  }

  /**
   * Render custom frame: interpolates camera and delegates to CanvasRenderer
   */
  public renderFrame(): void {
    // 1. Update camera lerp interpolation (0.12 factor)
    this.camera.update();

    // 2. Detect drag release safety transition
    const currentDragged = this.mouseConstraint.body;
    if (this.lastDraggedBody && !currentDragged) {
      this.handleNodeRelease(this.lastDraggedBody);
      this.lastDraggedBody = null;
      this.requestSave();
    } else if (currentDragged) {
      this.lastDraggedBody = currentDragged;
    }

    // 3. Delegate execution to CanvasRenderer with camera transform & semantic filaments
    this.burstParticles = this.renderer.renderFrame(
      this.nodeBodies,
      this.springConstraints,
      this.mouseConstraint,
      this.burstParticles,
      this.hasConnection.bind(this),
      this.camera,
      this.cursorPosition,
      this.semanticForces.getFilaments()
    );

    if (this.onAfterRender) {
      this.onAfterRender();
    }
  }

  /**
   * Start physics runner and animation frame loop
   */
  public start(): void {
    Runner.run(this.runner, this.engine);

    const loop = () => {
      this.renderFrame();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  /**
   * Teardown engine, listeners, and loops
   */
  public destroy(): void {
    if (this.saveTimeout !== null) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.semanticForces.destroy();
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    window.removeEventListener('mouseout', this.handleWindowMouseOut);
    this.canvas.removeEventListener('touchmove', this.handleTouchMove);
    this.canvas.removeEventListener('touchend', this.handleTouchEnd);
    this.canvas.removeEventListener('touchcancel', this.handleTouchEnd);
    window.removeEventListener('resize', this.handleResize);
    Runner.stop(this.runner);
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
  }
}
