export interface SerializedNode {
  id: string;
  text: string;
  x: number;
  y: number;
  links: string[];
}

const STORAGE_KEY = 'mental_defrag_canvas_state';

/**
 * Saves serialized nodes to localStorage
 */
export function saveCanvasState(nodes: SerializedNode[]): void {
  try {
    const data = JSON.stringify(nodes);
    localStorage.setItem(STORAGE_KEY, data);
  } catch (err) {
    console.warn('[Storage] Failed to save canvas state to localStorage:', err);
  }
}

/**
 * Loads serialized nodes from localStorage
 */
export function loadCanvasState(): SerializedNode[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as SerializedNode[];
    }
  } catch (err) {
    console.warn('[Storage] Failed to load canvas state from localStorage:', err);
  }
  return null;
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
