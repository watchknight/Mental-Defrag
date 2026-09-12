export interface ParsedImportNode {
  id: string;
  text: string;
  x: number;
  y: number;
  color?: string;
}

export interface ParsedImportLink {
  from: string;
  to: string;
}

export interface ParsedGraphData {
  sourceType: 'obsidian' | 'json';
  fileName: string;
  nodes: ParsedImportNode[];
  links: ParsedImportLink[];
  camera?: {
    x: number;
    y: number;
    zoom: number;
  };
}

/**
 * Parses an Obsidian Canvas (.canvas) JSON structure into normalized graph data
 */
export function parseObsidianCanvas(content: string, fileName: string): ParsedGraphData {
  const data = JSON.parse(content);
  const nodes: ParsedImportNode[] = [];
  const links: ParsedImportLink[] = [];

  if (Array.isArray(data.nodes)) {
    for (const n of data.nodes) {
      if (!n || !n.id) continue;

      let text = '';
      if (n.type === 'text' && typeof n.text === 'string') {
        text = n.text.trim();
      } else if (n.type === 'file' && typeof n.file === 'string') {
        // Strip markdown extension from file name if present
        text = n.file.replace(/\.[^/.]+$/, '').trim();
      } else if (n.type === 'link' && typeof n.url === 'string') {
        text = (n.text || n.url).trim();
      } else if (typeof n.text === 'string') {
        text = n.text.trim();
      }

      if (!text) {
        text = 'Untitled Thought';
      }

      const width = typeof n.width === 'number' ? n.width : 160;
      const height = typeof n.height === 'number' ? n.height : 100;
      const rawX = typeof n.x === 'number' ? n.x : 0;
      const rawY = typeof n.y === 'number' ? n.y : 0;

      // Obsidian uses top-left coordinates; convert to center coordinates
      const centerX = Math.round(rawX + width / 2);
      const centerY = Math.round(rawY + height / 2);

      nodes.push({
        id: String(n.id),
        text,
        x: centerX,
        y: centerY,
        color: typeof n.color === 'string' ? n.color : undefined,
      });
    }
  }

  // Parse edges
  if (Array.isArray(data.edges)) {
    const edgeSet = new Set<string>();
    for (const e of data.edges) {
      if (!e || !e.fromNode || !e.toNode) continue;
      const from = String(e.fromNode);
      const to = String(e.toNode);
      if (from === to) continue;

      const key = from < to ? `${from}_${to}` : `${to}_${from}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);

      links.push({ from, to });
    }
  }

  return {
    sourceType: 'obsidian',
    fileName,
    nodes,
    links,
  };
}

/**
 * Parses native Mental Defrag JSON backup snapshots
 */
export function parseNativeJsonBackup(content: string, fileName: string): ParsedGraphData {
  const data = JSON.parse(content);
  const nodes: ParsedImportNode[] = [];
  const links: ParsedImportLink[] = [];
  let camera: { x: number; y: number; zoom: number } | undefined;

  let rawNodes: unknown[] = [];

  if (Array.isArray(data)) {
    // Legacy direct SerializedNode[] format
    rawNodes = data;
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.nodes)) {
      rawNodes = data.nodes;
    }
    if (data.camera && typeof data.camera.zoom === 'number') {
      camera = {
        x: Number(data.camera.x) || 0,
        y: Number(data.camera.y) || 0,
        zoom: Number(data.camera.zoom) || 1,
      };
    }
  }

  const edgeSet = new Set<string>();

  for (const item of rawNodes) {
    if (!item || typeof item !== 'object') continue;
    const n = item as { id?: unknown; text?: unknown; x?: unknown; y?: unknown; links?: unknown };
    if (!n.id || typeof n.text !== 'string') continue;

    const id = String(n.id);
    const text = n.text.trim();
    const x = Number(n.x) || 0;
    const y = Number(n.y) || 0;

    nodes.push({
      id,
      text,
      x,
      y,
    });

    if (Array.isArray(n.links)) {
      for (const targetId of n.links) {
        if (!targetId || targetId === id) continue;
        const to = String(targetId);
        const key = id < to ? `${id}_${to}` : `${to}_${id}`;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        links.push({ from: id, to });
      }
    }
  }

  return {
    sourceType: 'json',
    fileName,
    nodes,
    links,
    camera,
  };
}

/**
 * Reads and routes a dropped File to the appropriate parser
 */
export async function parseDroppedFile(file: File): Promise<ParsedGraphData> {
  const text = await file.text();
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.canvas')) {
    return parseObsidianCanvas(text, file.name);
  }

  if (lowerName.endsWith('.json')) {
    try {
      // First try to detect if it's an Obsidian Canvas saved as .json
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
        return parseObsidianCanvas(text, file.name);
      }
    } catch {
      // Ignore parse preview error and let parser handle it
    }
    return parseNativeJsonBackup(text, file.name);
  }

  throw new Error(`Unsupported file type: ${file.name}. Expected .canvas or .json`);
}
