import Matter from 'matter-js';
import { PhysicsEngine } from './engine';
import { soundFX } from '../audio/soundFX';
import { showHudToast } from '../ui/shortcuts';
import { ParsedGraphData, ParsedImportNode } from '../import/importer';

const { Composite } = Matter;

export class NodeManager {
  private physics: PhysicsEngine;

  constructor(physics: PhysicsEngine) {
    this.physics = physics;
  }

  /**
   * Imports a parsed graph into the physics simulation
   */
  public async importGraph(
    data: ParsedGraphData,
    mode: 'replace' | 'merge',
    dropWorldPos?: { x: number; y: number }
  ): Promise<void> {
    const rawNodes = data.nodes;
    if (rawNodes.length === 0) {
      showHudToast('Import file contains no thought nodes');
      return;
    }

    // 1. In 'replace' mode, clear existing physics bodies and spring constraints
    if (mode === 'replace') {
      this.clearAll();
    }

    // 2. Compute coordinates offset and handle ID remapping safely
    const existingIds = new Set(
      this.physics.nodeBodies.map((b) => (b as unknown as { nodeData?: { id: string } }).nodeData?.id).filter(Boolean)
    );

    let offsetX = 0;
    let offsetY = 0;

    if (mode === 'merge' && dropWorldPos) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of rawNodes) {
        if (!n || typeof n !== 'object') continue;
        const nx = typeof n.x === 'number' && isFinite(n.x) ? n.x : 0;
        const ny = typeof n.y === 'number' && isFinite(n.y) ? n.y : 0;
        minX = Math.min(minX, nx);
        maxX = Math.max(maxX, nx);
        minY = Math.min(minY, ny);
        maxY = Math.max(maxY, ny);
      }
      if (isFinite(minX) && isFinite(maxX) && isFinite(minY) && isFinite(maxY)) {
        const centroidX = (minX + maxX) / 2;
        const centroidY = (minY + maxY) / 2;
        offsetX = dropWorldPos.x - centroidX;
        offsetY = dropWorldPos.y - centroidY;
      }
    }

    // ID remap table
    const idMap = new Map<string, string>();
    const preparedNodes: ParsedImportNode[] = [];

    for (const n of rawNodes) {
      if (!n || typeof n !== 'object') continue;
      let targetId = typeof n.id === 'string' && n.id.trim() ? n.id : `node-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      if (mode === 'merge' && existingIds.has(n.id)) {
        targetId = `${targetId}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
      }
      idMap.set(n.id, targetId);

      const rawX = typeof n.x === 'number' && isFinite(n.x) ? n.x : 0;
      const rawY = typeof n.y === 'number' && isFinite(n.y) ? n.y : 0;

      preparedNodes.push({
        id: targetId,
        text: typeof n.text === 'string' ? n.text : '',
        x: Math.round(rawX + offsetX),
        y: Math.round(rawY + offsetY),
        color: n.color,
      });
    }

    if (preparedNodes.length === 0) {
      showHudToast('No valid thought nodes could be parsed');
      return;
    }

    // Map links to new IDs
    const preparedLinks = (Array.isArray(data.links) ? data.links : [])
      .map((link) => ({
        from: idMap.get(link.from) || link.from,
        to: idMap.get(link.to) || link.to,
      }))
      .filter((link) => link.from && link.to && link.from !== link.to);

    // 3. Staggered Spawning over 200ms
    const totalBatches = Math.min(15, preparedNodes.length);
    const batchSize = Math.max(1, Math.ceil(preparedNodes.length / totalBatches));
    const intervalMs = Math.max(10, Math.floor(200 / totalBatches));

    const spawnedBodies = new Map<string, Matter.Body>();
    let currentIndex = 0;

    await new Promise<void>((resolve) => {
      const spawnNextBatch = () => {
        const batchEnd = Math.min(preparedNodes.length, currentIndex + batchSize);

        for (let i = currentIndex; i < batchEnd; i++) {
          try {
            const n = preparedNodes[i];
            const body = this.physics.createNode(n.x, n.y, n.text, n.id);

            // Apply temporary higher air friction damping to prevent collision repulsion shocks
            body.frictionAir = 0.08;
            window.setTimeout(() => {
              if (body) {
                body.frictionAir = 0.04;
              }
            }, 1000);

            spawnedBodies.set(n.id, body);
          } catch (err) {
            console.warn('[NodeManager] Failed to spawn imported node:', err);
          }
        }

        currentIndex = batchEnd;

        if (currentIndex < preparedNodes.length) {
          window.setTimeout(spawnNextBatch, intervalMs);
        } else {
          resolve();
        }
      };

      spawnNextBatch();
    });

    // 4. Reconnect spring constraints
    let createdLinksCount = 0;
    for (const link of preparedLinks) {
      try {
        const bodyA = spawnedBodies.get(link.from) || this.findBodyById(link.from);
        const bodyB = spawnedBodies.get(link.to) || this.findBodyById(link.to);

        if (bodyA && bodyB && bodyA !== bodyB) {
          if (!this.physics.hasConnection(bodyA, bodyB)) {
            const dist = Math.hypot(bodyB.position.x - bodyA.position.x, bodyB.position.y - bodyA.position.y);
            if (isFinite(dist) && !isNaN(dist) && dist > 0) {
              this.physics.createSpringConstraint(bodyA, bodyB, Math.max(80, Math.min(dist, 320)));
              createdLinksCount++;
            }
          }
        }
      } catch (err) {
        console.warn('[NodeManager] Failed to connect spring constraint:', err);
      }
    }

    // 5. Camera Reframing
    if (mode === 'replace' && data.camera && typeof data.camera.zoom === 'number') {
      const camX = typeof data.camera.x === 'number' && isFinite(data.camera.x) ? data.camera.x : 0;
      const camY = typeof data.camera.y === 'number' && isFinite(data.camera.y) ? data.camera.y : 0;
      const camZoom = typeof data.camera.zoom === 'number' && isFinite(data.camera.zoom) ? data.camera.zoom : 1.0;
      this.physics.camera.targetX = camX;
      this.physics.camera.targetY = camY;
      this.physics.camera.targetZoom = Math.max(0.25, Math.min(3.0, camZoom));
    } else {
      this.reframeCameraToNodes(Array.from(spawnedBodies.values()));
    }

    // 6. Refresh clusters, save state, and provide sensory feedback
    this.physics.refreshClusters();
    this.physics.requestSave();
    soundFX.playSpawn();

    const modeLabel = mode === 'merge' ? 'Merged' : 'Loaded';
    showHudToast(
      `${modeLabel} ${preparedNodes.length} thoughts & ${createdLinksCount} links from ${data.fileName}`
    );
  }

  private clearAll(): void {
    // Clear spring constraints
    for (const c of [...this.physics.springConstraints]) {
      Composite.remove(this.physics.engine.world, c);
    }
    this.physics.springConstraints = [];

    // Clear node bodies
    for (const b of [...this.physics.nodeBodies]) {
      Composite.remove(this.physics.engine.world, b);
    }
    this.physics.nodeBodies = [];

    // Clear semantic springs
    this.physics.semanticForces.clearSemanticSprings();
  }

  private findBodyById(id: string): Matter.Body | undefined {
    return this.physics.nodeBodies.find(
      (b) => (b as unknown as { nodeData?: { id: string } }).nodeData?.id === id
    );
  }

  /**
   * Reframes camera view smoothly to enclose target nodes with 15% margin padding
   */
  public reframeCameraToNodes(targetNodes: Matter.Body[]): void {
    const nodes = targetNodes.length > 0 ? targetNodes : this.physics.nodeBodies;
    if (nodes.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < nodes.length; i++) {
      const b = nodes[i];
      if (!b || !b.position || isNaN(b.position.x) || isNaN(b.position.y)) continue;
      const radius = (b as unknown as { nodeData?: { radius: number } }).nodeData?.radius || 50;
      minX = Math.min(minX, b.position.x - radius);
      maxX = Math.max(maxX, b.position.x + radius);
      minY = Math.min(minY, b.position.y - radius);
      maxY = Math.max(maxY, b.position.y + radius);
    }

    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
      this.physics.camera.targetZoom = 1.0;
      this.physics.camera.targetX = window.innerWidth / 2;
      this.physics.camera.targetY = window.innerHeight / 2;
      return;
    }

    const spanW = Math.max(140, maxX - minX);
    const spanH = Math.max(140, maxY - minY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const availW = window.innerWidth * 0.70;
    const availH = window.innerHeight * 0.70;

    const fitZoom = Math.min(availW / spanW, availH / spanH);
    const targetZoom = Math.max(0.25, Math.min(2.0, fitZoom));

    this.physics.camera.targetZoom = targetZoom;
    this.physics.camera.targetX = window.innerWidth / 2 - centerX * targetZoom;
    this.physics.camera.targetY = window.innerHeight / 2 - centerY * targetZoom;
  }
}
