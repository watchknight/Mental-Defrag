export interface SerializedNode {
  id: string;
  text: string;
  x: number;
  y: number;
  links: string[];
}

export interface CanvasStoragePayload {
  version: 2;
  updatedAt: number;
  nodes: SerializedNode[];
}

const STORAGE_KEY = 'mental_defrag_canvas_state';
const CURRENT_STORAGE_VERSION = 2;

/**
 * Validates that an object conforms to the SerializedNode contract
 */
export function isValidSerializedNode(node: unknown): node is SerializedNode {
  if (!node || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;

  if (typeof n.id !== 'string' || !n.id.trim()) return false;
  if (typeof n.text !== 'string') return false;
  if (typeof n.x !== 'number' || isNaN(n.x) || !isFinite(n.x)) return false;
  if (typeof n.y !== 'number' || isNaN(n.y) || !isFinite(n.y)) return false;
  if (n.links !== undefined && !Array.isArray(n.links)) return false;

  return true;
}

/**
 * Attempts to repair and salvage partially malformed node objects
 */
export function sanitizeSerializedNode(node: unknown): SerializedNode | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as Record<string, unknown>;

  const id =
    typeof n.id === 'string' && n.id.trim()
      ? n.id
      : `node-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  const text = typeof n.text === 'string' ? n.text : String(n.text || '');

  const x = typeof n.x === 'number' && isFinite(n.x) && !isNaN(n.x) ? Math.round(n.x) : 0;
  const y = typeof n.y === 'number' && isFinite(n.y) && !isNaN(n.y) ? Math.round(n.y) : 0;

  let links: string[] = [];
  if (Array.isArray(n.links)) {
    links = n.links.filter((l): l is string => typeof l === 'string' && Boolean(l.trim()));
  }

  return { id, text, x, y, links };
}

/**
 * Saves serialized nodes to localStorage with Schema v2 wrapper
 */
export function saveCanvasState(nodes: SerializedNode[]): void {
  try {
    const sanitizedNodes = nodes.filter(isValidSerializedNode);

    const payload: CanvasStoragePayload = {
      version: CURRENT_STORAGE_VERSION,
      updatedAt: Date.now(),
      nodes: sanitizedNodes,
    };

    const data = JSON.stringify(payload);
    localStorage.setItem(STORAGE_KEY, data);
  } catch (err) {
    console.warn('[Storage] Failed to save canvas state to localStorage (quota exceeded or private browsing):', err);
  }
}

/**
 * Loads and validates serialized nodes from localStorage.
 * Supports legacy v1 arrays and validates each node to prevent initialization crashes.
 */
export function loadCanvasState(): SerializedNode[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[Storage] Corrupted JSON in localStorage, ignoring state');
      return null;
    }

    if (!parsed) return null;

    let rawNodes: unknown[] = [];

    // Version Migration & Extraction
    if (Array.isArray(parsed)) {
      // Legacy Version 1 (Raw array of nodes) - seamlessly migrate
      console.info('[Storage] Migrating legacy v1 storage to v2 schema');
      rawNodes = parsed;
    } else if (typeof parsed === 'object' && parsed !== null) {
      const payload = parsed as { version?: number; nodes?: unknown[] };
      if (Array.isArray(payload.nodes)) {
        rawNodes = payload.nodes;
      }
    }

    if (rawNodes.length === 0) {
      return null;
    }

    // Validate and sanitize each node safely; drop malformed entries
    const validNodes: SerializedNode[] = [];
    for (let i = 0; i < rawNodes.length; i++) {
      const candidate = rawNodes[i];
      if (isValidSerializedNode(candidate)) {
        validNodes.push({
          id: candidate.id,
          text: candidate.text,
          x: candidate.x,
          y: candidate.y,
          links: Array.isArray(candidate.links)
            ? candidate.links.filter((l) => typeof l === 'string')
            : [],
        });
      } else {
        const sanitized = sanitizeSerializedNode(candidate);
        if (sanitized && (sanitized.text || sanitized.links.length > 0)) {
          console.warn('[Storage] Repaired partially malformed node at index', i, candidate);
          validNodes.push(sanitized);
        } else {
          console.warn('[Storage] Dropping corrupt/malformed node at index', i, candidate);
        }
      }
    }

    return validNodes.length > 0 ? validNodes : null;
  } catch (err) {
    console.warn('[Storage] Failed to load canvas state from localStorage:', err);
    return null;
  }
}

/**
 * Clears saved canvas state
 */
export function clearCanvasState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('[Storage] Failed to clear canvas state:', err);
  }
}
