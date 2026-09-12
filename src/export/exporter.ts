import Matter from 'matter-js';
import { PhysicsEngine, NodeData } from '../physics/engine';
import { SerializedNode } from '../storage/storage';

export interface ObsidianCanvasNode {
  id: string;
  type: 'text';
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

export interface ObsidianCanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide: 'right' | 'left' | 'top' | 'bottom';
  toSide: 'right' | 'left' | 'top' | 'bottom';
}

export interface ObsidianCanvasData {
  nodes: ObsidianCanvasNode[];
  edges: ObsidianCanvasEdge[];
}

export interface MentalDefragSnapshot {
  version: 1;
  exportedAt: string;
  camera: {
    x: number;
    y: number;
    zoom: number;
  };
  nodes: SerializedNode[];
}

/**
 * Format current timestamp for filenames (e.g., 2026-09-12-1035)
 */
export function getExportTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}-${hours}${minutes}`;
}

/**
 * Download arbitrary file using programmatic blob URL
 */
export function downloadFile(filename: string, content: string, mimeType: string = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 200);
}

/**
 * Export canvas to Obsidian Canvas format (.canvas JSON)
 */
export function exportToObsidianCanvas(physics: PhysicsEngine): string {
  const nodes: ObsidianCanvasNode[] = [];
  const edges: ObsidianCanvasEdge[] = [];
  const edgeSet = new Set<string>();

  for (let i = 0; i < physics.nodeBodies.length; i++) {
    const body = physics.nodeBodies[i];
    const nodeData = (body as unknown as { nodeData?: NodeData }).nodeData;
    if (!nodeData) continue;

    const radius = nodeData.radius || 50;
    const width = Math.round(radius * 2.2);
    const height = Math.round(radius * 1.6);
    // Align top-left corner relative to body center
    const x = Math.round(body.position.x - width / 2);
    const y = Math.round(body.position.y - height / 2);

    const canvasNode: ObsidianCanvasNode = {
      id: nodeData.id,
      type: 'text',
      text: nodeData.text,
      x,
      y,
      width,
      height,
    };

    if (nodeData.clusterColor?.hex) {
      canvasNode.color = nodeData.clusterColor.hex;
    }

    nodes.push(canvasNode);
  }

  // Generate edges from spring constraints
  for (let i = 0; i < physics.springConstraints.length; i++) {
    const c = physics.springConstraints[i];
    if (!c.bodyA || !c.bodyB) continue;

    const dataA = (c.bodyA as unknown as { nodeData?: NodeData }).nodeData;
    const dataB = (c.bodyB as unknown as { nodeData?: NodeData }).nodeData;
    if (!dataA || !dataB || dataA.id === dataB.id) continue;

    const key = dataA.id < dataB.id ? `${dataA.id}_${dataB.id}` : `${dataB.id}_${dataA.id}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);

    // Determine sides based on relative position
    const dx = c.bodyB.position.x - c.bodyA.position.x;
    const fromSide = dx >= 0 ? 'right' : 'left';
    const toSide = dx >= 0 ? 'left' : 'right';

    edges.push({
      id: `edge-${dataA.id}-${dataB.id}`,
      fromNode: dataA.id,
      toNode: dataB.id,
      fromSide,
      toSide,
    });
  }

  const canvasData: ObsidianCanvasData = {
    nodes,
    edges,
  };

  return JSON.stringify(canvasData, null, 2);
}

/**
 * Export canvas to Structured Markdown with graph analysis and wikilinks
 */
export function exportToMarkdown(physics: PhysicsEngine): string {
  const nodes = physics.nodeBodies;
  const constraints = physics.springConstraints;

  // Build adjacency list
  const adj = new Map<string, Set<string>>();
  const nodeMap = new Map<string, { body: Matter.Body; data: NodeData }>();

  for (const b of nodes) {
    const d = (b as unknown as { nodeData?: NodeData }).nodeData;
    if (d) {
      nodeMap.set(d.id, { body: b, data: d });
      adj.set(d.id, new Set());
    }
  }

  for (const c of constraints) {
    if (!c.bodyA || !c.bodyB) continue;
    const dA = (c.bodyA as unknown as { nodeData?: NodeData }).nodeData;
    const dB = (c.bodyB as unknown as { nodeData?: NodeData }).nodeData;
    if (dA && dB && dA.id !== dB.id) {
      adj.get(dA.id)?.add(dB.id);
      adj.get(dB.id)?.add(dA.id);
    }
  }

  // Find connected components
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const [id] of nodeMap.entries()) {
    if (!visited.has(id)) {
      const comp: string[] = [];
      const queue = [id];
      visited.add(id);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        comp.push(curr);

        const neighbors = adj.get(curr);
        if (neighbors) {
          for (const n of neighbors) {
            if (!visited.has(n)) {
              visited.add(n);
              queue.push(n);
            }
          }
        }
      }
      components.push(comp);
    }
  }

  // Sort components: largest clusters first, loose thoughts last
  const clusters = components.filter((c) => c.length > 1);
  clusters.sort((a, b) => b.length - a.length);
  const loose = components.filter((c) => c.length === 1).map((c) => c[0]);

  // Format Markdown output
  const lines: string[] = [];
  const exportDate = new Date().toLocaleString();

  lines.push(`# Mental Defrag Canvas Export`);
  lines.push(`_Exported on ${exportDate} • ${nodes.length} Thoughts • ${constraints.length} Connections_`);
  lines.push(``);

  // Export Clusters
  if (clusters.length > 0) {
    for (let i = 0; i < clusters.length; i++) {
      const comp = clusters[i];
      // Pick hub with highest degree
      let hubId = comp[0];
      let maxDeg = -1;
      for (const id of comp) {
        const deg = adj.get(id)?.size || 0;
        if (deg > maxDeg) {
          maxDeg = deg;
          hubId = id;
        }
      }

      const hubNode = nodeMap.get(hubId)?.data;
      const hubTitle = hubNode?.text ? hubNode.text.slice(0, 30) : `Cluster ${i + 1}`;
      lines.push(`## Cluster: ${hubTitle}${hubNode?.text && hubNode.text.length > 30 ? '...' : ''}`);

      if (hubNode?.clusterColor) {
        lines.push(`> **Theme**: ${hubNode.clusterColor.name} (\`${hubNode.clusterColor.hex}\`)`);
      }

      for (const id of comp) {
        const item = nodeMap.get(id);
        if (!item) continue;
        const text = item.data.text;
        const neighbors = adj.get(id);

        if (neighbors && neighbors.size > 0) {
          const links = Array.from(neighbors)
            .map((nId) => `[[${nodeMap.get(nId)?.data.text || nId}]]`)
            .join(', ');
          lines.push(`- [[${text}]] ➔ ${links}`);
        } else {
          lines.push(`- [[${text}]]`);
        }
      }
      lines.push(``);
    }
  }

  // Export Loose Thoughts
  if (loose.length > 0) {
    lines.push(`## Loose Thoughts`);
    for (const id of loose) {
      const item = nodeMap.get(id);
      if (item) {
        lines.push(`- [[${item.data.text}]]`);
      }
    }
    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * Export full canvas snapshot to JSON
 */
export function exportToJson(physics: PhysicsEngine): string {
  const snapshot: MentalDefragSnapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    camera: {
      x: Math.round(physics.camera.x),
      y: Math.round(physics.camera.y),
      zoom: Number(physics.camera.zoom.toFixed(3)),
    },
    nodes: physics.exportState(),
  };

  return JSON.stringify(snapshot, null, 2);
}

/**
 * Import full state snapshot and rehydrate canvas
 */
export function importFromJson(
  jsonString: string,
  physics: PhysicsEngine
): { success: boolean; nodeCount: number; error?: string } {
  try {
    const data = JSON.parse(jsonString) as Partial<MentalDefragSnapshot>;
    if (!data || !Array.isArray(data.nodes)) {
      return { success: false, nodeCount: 0, error: 'Invalid backup file: missing "nodes" array' };
    }

    // Rehydrate nodes & constraints
    const restored = physics.restoreState(data.nodes);
    if (!restored) {
      return { success: false, nodeCount: 0, error: 'Failed to restore physics bodies' };
    }

    // Restore camera position if present
    if (data.camera && typeof data.camera.zoom === 'number') {
      physics.camera.targetX = data.camera.x;
      physics.camera.targetY = data.camera.y;
      physics.camera.targetZoom = Math.max(0.25, Math.min(3.0, data.camera.zoom));
    }

    return { success: true, nodeCount: data.nodes.length };
  } catch (err) {
    return {
      success: false,
      nodeCount: 0,
      error: err instanceof Error ? err.message : 'Unknown JSON parse error',
    };
  }
}
