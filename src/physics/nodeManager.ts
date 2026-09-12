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

    // 2. Compute coordinates offset and handle ID remapping
    const existingIds = new Set(
      this.physics.nodeBodies.map((b) => (b as unknown as { nodeData?: { id: string } }).nodeData?.id).filter(Boolean)
    );

    let offsetX = 0;
    let offsetY = 0;

    if (mode === 'merge' && dropWorldPos) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of rawNodes) {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
      }
      const centroidX = (minX + maxX) / 2;
      const centroidY = (minY + maxY) / 2;

      offsetX = dropWorldPos.x - centroidX;
      offsetY = dropWorldPos.y - centroidY;
    }

    // ID remap table
    const idMap = new Map<string, string>();
    const preparedNodes: ParsedImportNode[] = [];

    for (const n of rawNodes) {
      let targetId = n.id;
      if (mode === 'merge' && existingIds.has(n.id)) {
        targetId = `${n.id}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
      }
      idMap.set(n.id, targetId);

      preparedNodes.push({
        id: targetId,
        text: n.text,
        x: Math.round(n.x + offsetX),
        y: Math.round(n.y + offsetY),
        color: n.color,
      });
    }

    // Map links to new IDs
    const preparedLinks = data.links
      .map((link) => ({
        from: idMap.get(link.from) || link.from,
        to: idMap.get(link.to) || link.to,
      }))
      .filter((link) => link.from !== link.to);

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
      const bodyA = spawnedBodies.get(link.from) || this.findBodyById(link.from);
      const bodyB = spawnedBodies.get(link.to) || this.findBodyById(link.to);

      if (bodyA && bodyB && bodyA !== bodyB) {
        if (!this.physics.hasConnection(bodyA, bodyB)) {
          const dist = Math.hypot(bodyB.position.x - bodyA.position.x, bodyB.position.y - bodyA.position.y);
          this.physics.createSpringConstraint(bodyA, bodyB, Math.max(80, Math.min(dist, 320)));
          createdLinksCount++;
        }
      }
    }

    // 5. Camera Reframing
    if (mode === 'replace' && data.camera && typeof data.camera.zoom === 'number') {
      this.physics.camera.targetX = data.camera.x;
      this.physics.camera.targetY = data.camera.y;
      this.physics.camera.targetZoom = Math.max(0.25, Math.min(3.0, data.camera.zoom));
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
      const radius = (b as unknown as { nodeData?: { radius: number } }).nodeData?.radius || 50;
      minX = Math.min(minX, b.position.x - radius);
      maxX = Math.max(maxX, b.position.x + radius);
      minY = Math.min(minY, b.position.y - radius);
      maxY = Math.max(maxY, b.position.y + radius);
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
