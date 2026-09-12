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
  wrappedLines?: string[];
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
  active: boolean;
}

/**
 * Pre-allocated pool of reusable burst particles (capacity 150)
 * Eliminates garbage collector churn during defrag explosions.
 */
export class ParticlePool {
  public particles: BurstParticle[];
  public readonly capacity: number = 150;

  constructor(capacity: number = 150) {
    this.capacity = capacity;
    this.particles = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.particles[i] = {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        initialSize: 2.5,
        glowColor: 'rgba(56, 189, 248, 0.85)',
        fillColor: '#38bdf8',
        birthTime: 0,
        lifetime: 600,
        active: false,
      };
    }
  }

  public spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    initialSize: number,
    glowColor: string,
    fillColor: string,
    birthTime: number,
    lifetime: number = 600
  ): BurstParticle | null {
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.x = x;
        p.y = y;
        p.vx = vx;
        p.vy = vy;
        p.initialSize = initialSize;
        p.glowColor = glowColor;
        p.fillColor = fillColor;
        p.birthTime = birthTime;
        p.lifetime = lifetime;
        p.active = true;
        return p;
      }
    }
    return null;
  }

  public reset(): void {
    for (let i = 0; i < this.capacity; i++) {
      this.particles[i].active = false;
    }
  }
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
  public semanticForces: SemanticForcesManager;

  public nodeBodies: Matter.Body[] = [];
  public springConstraints: Matter.Constraint[] = [];
  public particlePool: ParticlePool = new ParticlePool(150);
  public get burstParticles(): BurstParticle[] {
    return this.particlePool.particles;
  }

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

  private handlePointerMove: (e: PointerEvent) => void;
  private handlePointerLeave: () => void;
  private handleWindowPointerOut: (e: PointerEvent) => void;

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

    // 2. Setup canvas dimensions, touchAction, and DPR
    this.canvas.style.touchAction = 'none';
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

    // Window & VisualViewport resize handlers
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.handleResize);
      window.visualViewport.addEventListener('scroll', this.handleResize);
    }

    // 5. Track cursor position via unified Pointer Events
    this.handlePointerMove = (e: PointerEvent) => {
      this.cursorPosition = { x: e.clientX, y: e.clientY };
    };
    this.handlePointerLeave = () => {
      this.cursorPosition = null;
    };
    this.handleWindowPointerOut = (e: PointerEvent) => {
      if (!e.relatedTarget) {
        this.cursorPosition = null;
      }
    };

    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.addEventListener('pointercancel', this.handlePointerLeave);
    window.addEventListener('pointerout', this.handleWindowPointerOut);

    // 6. Physics Lifecycle Hooks: Mouse Sync, Repulsion Field, Soft Orbital Gravity, & Guardrails
    Events.on(this.engine, 'beforeUpdate', () => {
      // 0. Pre-tick NaN & Tunneling Guardrails
      this.applyPhysicsGuardrails();

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

    Events.on(this.engine, 'afterUpdate', () => {
      // Post-tick NaN & Tunneling Guardrails
      this.applyPhysicsGuardrails();
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
   * NaN and Physics Tunneling Guardrails:
   * - In beforeUpdate and afterUpdate ticks:
   *   - Check for invalid coordinates (isNaN(x), isNaN(y), !isFinite(speed)). If a body receives NaN, reset its velocity to {x: 0, y: 0} and restore it to origin.
   *   - Cap maximum body velocity (clamp(velocity, -25, 25)) to prevent high-speed tunneling through boundary constraints during extreme collisions.
   */
  public applyPhysicsGuardrails(): void {
    const MAX_VELOCITY = 25;
    const bodies = this.nodeBodies;

    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      const pos = body.position;
      const vel = body.velocity;

      // 1. Guard against NaN or non-finite position / velocity / speed
      if (
        isNaN(pos.x) ||
        isNaN(pos.y) ||
        !isFinite(pos.x) ||
        !isFinite(pos.y) ||
        isNaN(vel.x) ||
        isNaN(vel.y) ||
        !isFinite(vel.x) ||
        !isFinite(vel.y) ||
        isNaN(body.speed) ||
        !isFinite(body.speed)
      ) {
        Body.setPosition(body, { x: 0, y: 0 });
        Body.setVelocity(body, { x: 0, y: 0 });
        Body.setAngularVelocity(body, 0);
        continue;
      }

      // 2. Velocity clamping to prevent physics tunneling
      const clampedVx = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, vel.x));
      const clampedVy = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, vel.y));

      if (clampedVx !== vel.x || clampedVy !== vel.y) {
        Body.setVelocity(body, { x: clampedVx, y: clampedVy });
      }
    }
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
   * Dynamic resize handler using visualViewport when available
   */
  private handleResize(): void {
    let width: number;
    let height: number;
    if (window.visualViewport) {
      width = Math.round(window.visualViewport.width);
      height = Math.round(window.visualViewport.height);
    } else {
      width = window.innerWidth;
      height = window.innerHeight;
    }

    this.dpr = this.renderer.updateDimensions(width, height);
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

    // 1. Spawn 18 glowing radial micro-particles from pre-allocated pool
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

      this.particlePool.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        2.5 + Math.random() * 2.2,
        palette.glow,
        palette.fill,
        now,
        600
      );
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

    // 1. Recreate all circular bodies in world coordinates with defensive validation
    for (const data of serializedNodes) {
      try {
        if (!data || typeof data !== 'object') continue;
        const text = typeof data.text === 'string' ? data.text : '';
        const x = typeof data.x === 'number' && isFinite(data.x) && !isNaN(data.x) ? data.x : 0;
        const y = typeof data.y === 'number' && isFinite(data.y) && !isNaN(data.y) ? data.y : 0;

        const radius = calculateNodeRadius(text);

        const body = Bodies.circle(x, y, radius, {
          restitution: 0.8,
          frictionAir: 0.04,
          friction: 0.05,
          label: 'thought-node',
        });

        const fastEmbedding = createFastPathEmbedding(text);

        const nodeData: NodeData = {
          id: data.id || `node-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          text,
          radius,
          createdAt: Date.now(),
          trail: [],
          embedding: fastEmbedding,
        };

        (body as unknown as { nodeData: NodeData }).nodeData = nodeData;

        computeEmbedding(text)
          .then((denseVec) => {
            nodeData.embedding = denseVec;
            this.refreshClusters();
          })
          .catch(() => {});

        Composite.add(this.engine.world, body);
        this.nodeBodies.push(body);
        nodeMap.set(nodeData.id, body);
      } catch (err) {
        console.warn('[Engine] Skipped corrupt node during restore:', data, err);
      }
    }

    // 2. Recreate all constraints without duplicates
    for (const data of serializedNodes) {
      if (!data || !data.id || !Array.isArray(data.links)) continue;
      const bodyA = nodeMap.get(data.id);
      if (!bodyA) continue;

      for (const targetId of data.links) {
        try {
          if (!targetId || typeof targetId !== 'string') continue;
          const bodyB = nodeMap.get(targetId);
          if (!bodyB || bodyA === bodyB) continue;

          if (this.hasConnection(bodyA, bodyB)) continue;

          const restLength = Math.hypot(
            bodyB.position.x - bodyA.position.x,
            bodyB.position.y - bodyA.position.y
          );

          if (!isFinite(restLength) || isNaN(restLength) || restLength <= 0) continue;

          this.createSpringConstraint(bodyA, bodyB, restLength);
        } catch (err) {
          console.warn('[Engine] Failed to reconnect spring constraint:', err);
        }
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
    this.renderer.renderFrame(
      this.nodeBodies,
      this.springConstraints,
      this.mouseConstraint,
      this.particlePool.particles,
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
   * Start deterministic fixed timestep physics loop and animation frame loop
   */
  public start(): void {
    const FIXED_DELTA = 1000 / 60; // 16.66667ms
    const MAX_FRAME_DELTA = 100; // clamp to 100ms to prevent spiral of death
    let accumulator = 0;
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      let elapsed = currentTime - lastTime;
      lastTime = currentTime;

      // Clamp max frame delta to prevent spiral of death if tab was unfocused or lagged
      if (elapsed > MAX_FRAME_DELTA) {
        elapsed = MAX_FRAME_DELTA;
      }
      if (elapsed < 0) {
        elapsed = 0;
      }

      accumulator += elapsed;

      // Substep deterministic physics at exact 60Hz intervals
      while (accumulator >= FIXED_DELTA) {
        Engine.update(this.engine, FIXED_DELTA);
        accumulator -= FIXED_DELTA;
      }

      // Display refresh FPS tracking
      this.frameCount++;
      const fpsDelta = currentTime - this.lastFpsCalcTime;
      if (fpsDelta >= 500) {
        const fps = Math.round((this.frameCount * 1000) / fpsDelta);
        this.frameCount = 0;
        this.lastFpsCalcTime = currentTime;
        if (this.onFpsUpdate) {
          this.onFpsUpdate(fps);
        }
      }

      if (this.mouseConstraint.body) {
        this.requestSave();
      }

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
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.removeEventListener('pointercancel', this.handlePointerLeave);
    window.removeEventListener('pointerout', this.handleWindowPointerOut);
    window.removeEventListener('resize', this.handleResize);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.handleResize);
      window.visualViewport.removeEventListener('scroll', this.handleResize);
    }
    Runner.stop(this.runner);
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
  }
}
