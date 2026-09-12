import Matter from 'matter-js';
import { NodeData, SpringData, BurstParticle } from '../physics/engine';
import { CameraController } from '../camera/camera';
import { SemanticFilament } from '../physics/semanticForces';

export class CanvasRenderer {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  private dpr: number = 1;
  public logicalWidth: number = window.innerWidth;
  public logicalHeight: number = window.innerHeight;

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas;
    this.ctx = ctx;
  }

  public getDpr(): number {
    return this.dpr;
  }

  /**
   * Update canvas viewport dimensions and devicePixelRatio scaling.
   * Handles window.visualViewport dynamically to avoid mobile address bar jumps.
   */
  public updateDimensions(customWidth?: number, customHeight?: number): number {
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    let width = customWidth;
    let height = customHeight;

    if (width === undefined || height === undefined) {
      if (window.visualViewport) {
        width = Math.round(window.visualViewport.width);
        height = Math.round(window.visualViewport.height);
      } else {
        width = window.innerWidth;
        height = window.innerHeight;
      }
    }

    this.logicalWidth = width;
    this.logicalHeight = height;

    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);

    return this.dpr;
  }

  /**
   * Render infinite background dot grid within camera frustum
   * with 32px pitch and interactive dynamic lens warping (140px influence, cosine falloff)
   */
  public renderBackground(
    width: number,
    height: number,
    camera: CameraController,
    cursorWorld: { x: number; y: number } | null
  ): void {
    const pitch = 32;
    const baseRadius = 1.2;
    const baseStyle = 'rgba(255, 255, 255, 0.07)';
    const influenceRadius = 140;

    // Calculate visible camera bounds in world coordinates
    const bounds = camera.getVisibleBounds(width, height);
    const startX = Math.floor(bounds.minX / pitch) * pitch;
    const endX = Math.ceil(bounds.maxX / pitch) * pitch;
    const startY = Math.floor(bounds.minY / pitch) * pitch;
    const endY = Math.ceil(bounds.maxY / pitch) * pitch;

    // Fast path: Cursor off-screen, batch all dots in camera frustum
    if (!cursorWorld) {
      this.ctx.fillStyle = baseStyle;
      this.ctx.beginPath();
      for (let gx = startX; gx <= endX; gx += pitch) {
        for (let gy = startY; gy <= endY; gy += pitch) {
          this.ctx.moveTo(gx + baseRadius, gy);
          this.ctx.arc(gx, gy, baseRadius, 0, Math.PI * 2);
        }
      }
      this.ctx.fill();
      return;
    }

    const mx = cursorWorld.x;
    const my = cursorWorld.y;

    // 1. Batch all resting dots (outside 140px lens influence radius)
    this.ctx.fillStyle = baseStyle;
    this.ctx.beginPath();

    for (let gx = startX; gx <= endX; gx += pitch) {
      for (let gy = startY; gy <= endY; gy += pitch) {
        const dx = gx - mx;
        const dy = gy - my;

        // Bounding box pre-check
        if (dx > 140 || dx < -140 || dy > 140 || dy < -140) {
          this.ctx.moveTo(gx + baseRadius, gy);
          this.ctx.arc(gx, gy, baseRadius, 0, Math.PI * 2);
          continue;
        }

        const d = Math.hypot(dx, dy);
        if (d >= influenceRadius || d === 0) {
          this.ctx.moveTo(gx + baseRadius, gy);
          this.ctx.arc(gx, gy, baseRadius, 0, Math.PI * 2);
        }
      }
    }
    this.ctx.fill();

    // 2. Draw displaced & highlighted lens dots within the 140px influence zone
    const minX = Math.max(startX, Math.floor((mx - influenceRadius) / pitch) * pitch);
    const maxX = Math.min(endX, Math.ceil((mx + influenceRadius) / pitch) * pitch);
    const minY = Math.max(startY, Math.floor((my - influenceRadius) / pitch) * pitch);
    const maxY = Math.min(endY, Math.ceil((my + influenceRadius) / pitch) * pitch);

    for (let gx = minX; gx <= maxX; gx += pitch) {
      for (let gy = minY; gy <= maxY; gy += pitch) {
        const dx = gx - mx;
        const dy = gy - my;
        const d = Math.hypot(dx, dy);

        if (d < influenceRadius && d > 0) {
          // Smooth cosine falloff factor in [0, 1]
          const factor = (1 + Math.cos((d / influenceRadius) * Math.PI)) / 2;

          // Outward radial displacement (max 18px shift)
          const nx = dx / d;
          const ny = dy / d;
          const renderX = gx + nx * 18 * factor;
          const renderY = gy + ny * 18 * factor;

          // Dynamic highlight: scale size up to 2.2px, opacity up to 0.32
          const dotRadius = 1.2 + factor * 1.0;
          const dotAlpha = 0.07 + factor * (0.32 - 0.07);

          this.ctx.fillStyle = `rgba(255, 255, 255, ${dotAlpha.toFixed(3)})`;
          this.ctx.beginPath();
          this.ctx.arc(renderX, renderY, dotRadius, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }
  }

  /**
   * Update velocity trails for all nodes
   */
  public updateNodeTrails(nodeBodies: Matter.Body[]): void {
    for (let i = 0; i < nodeBodies.length; i++) {
      const body = nodeBodies[i];
      const nodeData = (body as unknown as { nodeData?: NodeData }).nodeData;
      if (!nodeData) continue;

      if (!nodeData.trail) {
        nodeData.trail = [];
      }

      if (body.speed > 0.8) {
        nodeData.trail.push({ x: body.position.x, y: body.position.y });
        if (nodeData.trail.length > 10) {
          nodeData.trail.shift();
        }
      } else if (nodeData.trail.length > 0) {
        nodeData.trail.shift();
      }
    }
  }

  /**
   * Render velocity trails before the node bodies
   */
  private renderVelocityTrails(nodeBodies: Matter.Body[]): void {
    for (let n = 0; n < nodeBodies.length; n++) {
      const body = nodeBodies[n];
      const nodeData = (body as unknown as { nodeData?: NodeData }).nodeData;
      if (!nodeData || !nodeData.trail || nodeData.trail.length === 0) continue;

      const trail = nodeData.trail;
      const count = trail.length;
      const baseRadius = nodeData.radius;

      for (let i = 0; i < count; i++) {
        const pt = trail[i];
        const decay = (i + 1) / count;
        const radius = Math.max(8, baseRadius * (0.35 + decay * 0.55));
        const alpha = 0.03 + decay * 0.17;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(120, 170, 255, ${alpha.toFixed(3)})`;
        this.ctx.fill();
        this.ctx.restore();
      }
    }
  }

  /**
   * Render ambient breathing glow behind every node
   */
  private renderBreathingGlows(nodeBodies: Matter.Body[], time: number): void {
    const wave = (Math.sin(time * 0.003) + 1) / 2;
    const alpha = 0.10 + wave * (0.25 - 0.10);

    for (let i = 0; i < nodeBodies.length; i++) {
      const body = nodeBodies[i];
      const nodeData = (body as unknown as { nodeData?: NodeData }).nodeData;
      const radius = nodeData ? nodeData.radius : (body.circleRadius || 42);
      const { x, y } = body.position;

      const innerRadius = radius * 0.72;
      const outerRadius = radius + 8 + wave * 14;

      const rgb = nodeData?.clusterColor?.rgb || { r: 120, g: 170, b: 255 };

      this.ctx.save();
      const glowGrad = this.ctx.createRadialGradient(x, y, innerRadius, x, y, outerRadius);
      glowGrad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(3)})`);
      glowGrad.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${(alpha * 0.45).toFixed(3)})`);
      glowGrad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

      this.ctx.fillStyle = glowGrad;
      this.ctx.beginPath();
      this.ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }
  }

  /**
   * Break text into wrapped lines fitted to node diameter
   */
  private wrapText(text: string, maxWidth: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = this.ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [text];
  }

  /**
   * Render spring constraints with organic quadratic Bézier curves
   */
  private renderSpringConstraints(springConstraints: Matter.Constraint[]): void {
    for (let i = 0; i < springConstraints.length; i++) {
      const constraint = springConstraints[i];
      const bodyA = constraint.bodyA;
      const bodyB = constraint.bodyB;
      if (!bodyA || !bodyB) continue;

      const x1 = bodyA.position.x;
      const y1 = bodyA.position.y;
      const x2 = bodyB.position.x;
      const y2 = bodyB.position.y;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) continue;

      const springData = (constraint as unknown as { springData?: SpringData }).springData;
      const restLength = springData?.restLength || constraint.length || 140;

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;

      let nx = -dy / dist;
      let ny = dx / dist;
      if (ny < 0) {
        nx = -nx;
        ny = -ny;
      }

      const stretchRatio = dist / restLength;
      const opacity = Math.max(0.08, Math.min(0.7, 0.7 / Math.pow(Math.max(1, stretchRatio), 2)));

      const slack = Math.max(0, (restLength - dist) / restLength);
      const tensionFactor = Math.max(0, 1 - Math.max(0, stretchRatio - 1) * 3);
      const sag = (slack * 36 + 6) * tensionFactor;

      const cx = mx + nx * sag;
      const cy = my + ny * sag;

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.quadraticCurveTo(cx, cy, x2, y2);
      this.ctx.strokeStyle = `rgba(167, 139, 250, ${opacity.toFixed(3)})`;
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();

      if (stretchRatio > 1.25 && opacity > 0.18) {
        this.ctx.strokeStyle = `rgba(56, 189, 248, ${(opacity * 0.35).toFixed(3)})`;
        this.ctx.lineWidth = 2.5;
        this.ctx.stroke();
      }

      this.ctx.restore();
    }
  }

  /**
   * Render proximity guide lines when dragging near candidate nodes
   */
  private renderProximityGuides(
    draggedBody: Matter.Body | null,
    nodeBodies: Matter.Body[],
    hasConnection: (a: Matter.Body, b: Matter.Body) => boolean
  ): void {
    if (!draggedBody) return;
    const PROXIMITY_RADIUS = 140;

    for (let i = 0; i < nodeBodies.length; i++) {
      const other = nodeBodies[i];
      if (other === draggedBody) continue;

      const dx = other.position.x - draggedBody.position.x;
      const dy = other.position.y - draggedBody.position.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= PROXIMITY_RADIUS) {
        const isAlreadyLinked = hasConnection(draggedBody, other);

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.setLineDash([5, 5]);
        this.ctx.lineDashOffset = -(performance.now() / 25) % 10;
        this.ctx.strokeStyle = isAlreadyLinked
          ? 'rgba(148, 163, 184, 0.4)'
          : 'rgba(56, 189, 248, 0.7)';
        this.ctx.lineWidth = 1.5;
        this.ctx.moveTo(draggedBody.position.x, draggedBody.position.y);
        this.ctx.lineTo(other.position.x, other.position.y);
        this.ctx.stroke();

        if (!isAlreadyLinked) {
          const nodeData = (other as unknown as { nodeData?: NodeData }).nodeData;
          const targetRadius = nodeData ? nodeData.radius : (other.circleRadius || 42);

          this.ctx.beginPath();
          this.ctx.arc(other.position.x, other.position.y, targetRadius + 5, 0, Math.PI * 2);
          this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
          this.ctx.lineWidth = 1;
          this.ctx.setLineDash([3, 3]);
          this.ctx.stroke();
        }

        this.ctx.restore();
      }
    }
  }

  /**
   * Render mouse dragging tether
   */
  private renderMouseTether(mouseConstraint: Matter.MouseConstraint): void {
    if (!mouseConstraint.body) return;

    const body = mouseConstraint.body;
    const pointB = mouseConstraint.constraint.pointB;
    const bodyPoint = {
      x: body.position.x + (pointB ? pointB.x : 0),
      y: body.position.y + (pointB ? pointB.y : 0),
    };
    const mousePoint = mouseConstraint.mouse.position;

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.moveTo(mousePoint.x, mousePoint.y);
    this.ctx.lineTo(bodyPoint.x, bodyPoint.y);
    this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([3, 3]);
    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * Render glassmorphic circular nodes with drop shadow, 1px border, and centered monospace text
   */
  private renderNodeBodies(nodeBodies: Matter.Body[]): void {
    for (let i = 0; i < nodeBodies.length; i++) {
      const body = nodeBodies[i];
      const nodeData = (body as unknown as { nodeData?: NodeData }).nodeData;
      const { x, y } = body.position;
      const radius = nodeData ? nodeData.radius : (body.circleRadius || 42);
      const text = nodeData ? nodeData.text : '';

      this.ctx.save();

      // Soft Outer Drop Shadow
      this.ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      this.ctx.shadowBlur = 16;
      this.ctx.shadowOffsetX = 0;
      this.ctx.shadowOffsetY = 5;

      // Dark semi-transparent circular body (rgba(25, 25, 30, 0.75))
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fillStyle = 'rgba(25, 25, 30, 0.75)';
      this.ctx.fill();

      // Clear drop shadow for crisp border and inner text
      this.ctx.shadowColor = 'transparent';

      // Crisp border: tinted by semantic cluster hue if clustered, else subtle white
      if (nodeData?.clusterColor) {
        const rgb = nodeData.clusterColor.rgb;
        this.ctx.lineWidth = 1.4;
        this.ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.65)`;
      } else {
        this.ctx.lineWidth = 1;
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      }
      this.ctx.stroke();

      // Subtle specular glass gradient reflection on top half
      const glassGrad = this.ctx.createLinearGradient(x, y - radius, x, y + radius * 0.4);
      glassGrad.addColorStop(0, 'rgba(255, 255, 255, 0.07)');
      glassGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.02)');
      glassGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
      this.ctx.fillStyle = glassGrad;
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius - 0.5, 0, Math.PI * 2);
      this.ctx.fill();

      // Monospace Text Rendering
      if (text) {
        const fontSize = radius >= 68 ? 13 : 12;
        this.ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`;
        this.ctx.fillStyle = '#f8fafc';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        const maxTextWidth = radius * 1.42;
        const lines = this.wrapText(text, maxTextWidth);
        const lineHeight = fontSize * 1.35;
        const totalHeight = (lines.length - 1) * lineHeight;
        const startY = y - totalHeight / 2;

        for (let l = 0; l < lines.length; l++) {
          this.ctx.fillText(lines[l], x, startY + l * lineHeight);
        }
      }

      this.ctx.restore();
    }
  }

  /**
   * Render defrag burst particles and clean dead ones
   */
  public renderBurstParticles(particles: BurstParticle[]): BurstParticle[] {
    if (particles.length === 0) return particles;

    const now = performance.now();
    const active: BurstParticle[] = [];

    this.ctx.save();

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const elapsed = now - p.birthTime;

      if (elapsed >= p.lifetime) {
        continue;
      }

      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.95;
      p.vy *= 0.95;

      const progress = elapsed / p.lifetime;
      const alpha = Math.max(0, 1 - progress);
      const currentSize = Math.max(0.4, p.initialSize * (1 - progress * 0.75));

      this.ctx.save();
      this.ctx.shadowColor = p.glowColor;
      this.ctx.shadowBlur = 10 * alpha;
      this.ctx.globalAlpha = alpha;
      this.ctx.fillStyle = p.fillColor;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();

      active.push(p);
    }

    this.ctx.restore();
    return active;
  }

  /**
   * Master render pipeline executing strict visual hierarchy in world space:
   * 1. Screen Clear (#0a0a0c)
   * 2. Camera Transform Applied
   * 3. Infinite Dot Grid with 32px pitch & lens warping
   * 4. Spring Constraints & Proximity Guides
   * 5. Velocity Trails
   * 6. Ambient Breathing Glow
   * 7. Node Body & Monospace Text
   * 8. Defrag Burst Particles
   */
  /**
   * Render shimmering semantic tension filaments for pairs with S >= 0.70
   */
  private renderSemanticFilaments(filaments: SemanticFilament[], time: number): void {
    if (!filaments || filaments.length === 0) return;

    this.ctx.save();
    for (let i = 0; i < filaments.length; i++) {
      const { bodyA, bodyB, similarity } = filaments[i];
      const posA = bodyA.position;
      const posB = bodyB.position;

      const dx = posB.x - posA.x;
      const dy = posB.y - posA.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) continue;

      // Opacity proportional to similarity: (S - 0.6) * 0.8
      const baseAlpha = Math.max(0.04, Math.min(0.85, (similarity - 0.60) * 0.8));
      // Shimmering wave modulation
      const shimmer = 0.82 + Math.sin(time * 0.004 + (bodyA.id * 5 + bodyB.id * 11)) * 0.18;
      const alpha = baseAlpha * shimmer;

      // Faint organic curved sag
      const midX = (posA.x + posB.x) / 2;
      const midY = (posA.y + posB.y) / 2;
      const perpX = -dy / dist;
      const perpY = dx / dist;
      const sag = Math.sin(time * 0.0025 + similarity * 8) * 6;
      const cpX = midX + perpX * sag;
      const cpY = midY + perpY * sag;

      this.ctx.beginPath();
      this.ctx.moveTo(posA.x, posA.y);
      this.ctx.quadraticCurveTo(cpX, cpY, posB.x, posB.y);

      this.ctx.strokeStyle = `rgba(160, 200, 255, ${alpha.toFixed(3)})`;
      this.ctx.lineWidth = Math.max(1, 1.0 + (similarity - 0.70) * 2.2);
      this.ctx.setLineDash([5, 4]);
      this.ctx.lineDashOffset = -(time * 0.02) % 18;
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  /**
   * Master render pipeline executing strict visual hierarchy in world space:
   * 1. Screen Clear (#0a0a0c)
   * 2. Camera Transform Applied
   * 3. Infinite Dot Grid with 32px pitch & lens warping
   * 4. Spring Constraints & Semantic Filaments & Proximity Guides
   * 5. Velocity Trails
   * 6. Ambient Breathing Glow (Cluster Tinted)
   * 7. Node Body & Monospace Text (Cluster Tinted)
   * 8. Defrag Burst Particles
   */
  public renderFrame(
    nodeBodies: Matter.Body[],
    springConstraints: Matter.Constraint[],
    mouseConstraint: Matter.MouseConstraint,
    burstParticles: BurstParticle[],
    hasConnection: (a: Matter.Body, b: Matter.Body) => boolean,
    camera: CameraController,
    cursorScreen: { x: number; y: number } | null = null,
    semanticFilaments: SemanticFilament[] = []
  ): BurstParticle[] {
    const width = this.logicalWidth;
    const height = this.logicalHeight;
    const now = performance.now();

    // 0. Update velocity trails before drawing
    this.updateNodeTrails(nodeBodies);

    // 1. Clear background in screen space
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
    this.ctx.fillStyle = '#0a0a0c';
    this.ctx.fillRect(0, 0, width, height);

    // Compute cursor position in world space
    const cursorWorld = cursorScreen ? camera.screenToWorld(cursorScreen.x, cursorScreen.y) : null;

    // 2. Enter Camera World Transform
    this.ctx.save();
    this.ctx.translate(camera.x, camera.y);
    this.ctx.scale(camera.zoom, camera.zoom);

    // 3. Render Infinite Dot Grid
    this.renderBackground(width, height, camera, cursorWorld);

    // 4. Render Semantic Tension Filaments
    this.renderSemanticFilaments(semanticFilaments, now);

    // 5. Render Spring Constraints
    this.renderSpringConstraints(springConstraints);

    // 6. Render Proximity Guides
    this.renderProximityGuides(mouseConstraint.body, nodeBodies, hasConnection);

    // 7. Render Mouse Tether
    this.renderMouseTether(mouseConstraint);

    // 8. Visual Hierarchy: Trails -> Breathing Glow -> Node Body & Monospace Text
    this.renderVelocityTrails(nodeBodies);
    this.renderBreathingGlows(nodeBodies, now);
    this.renderNodeBodies(nodeBodies);

    // 9. Defrag Burst Particles
    const activeParticles = this.renderBurstParticles(burstParticles);

    // 10. Exit Camera World Transform
    this.ctx.restore();

    return activeParticles;
  }
}
