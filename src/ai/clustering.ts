/**
 * Automated Semantic Clustering & Embedding Pipeline
 * 
 * Provides a hybrid vector embedding system:
 * 1. Fast-Path / Fallback Engine: Zero-latency subword & character n-gram TF-IDF vectorizer (384-d).
 * 2. Neural Transformer Pipeline: Asynchronously loads @xenova/transformers (all-MiniLM-L6-v2 INT8) in the browser.
 */

export interface ClusterColor {
  name: string;
  hex: string;
  rgb: { r: number; g: number; b: number };
}

export const CLUSTER_PALETTE: ClusterColor[] = [
  { name: 'Deep Work', hex: '#a855f7', rgb: { r: 168, g: 85, b: 247 } },      // Violet
  { name: 'Creativity', hex: '#38bdf8', rgb: { r: 56, g: 189, b: 248 } },     // Cyan
  { name: 'Urgent', hex: '#f59e0b', rgb: { r: 245, g: 158, b: 11 } },         // Amber
  { name: 'Personal', hex: '#10b981', rgb: { r: 16, g: 185, b: 129 } },       // Emerald
  { name: 'Reflection', hex: '#f43f5e', rgb: { r: 244, g: 63, b: 94 } },     // Rose
  { name: 'Research', hex: '#6366f1', rgb: { r: 99, g: 102, b: 241 } },       // Indigo
  { name: 'Focus', hex: '#14b8a6', rgb: { r: 20, g: 184, b: 166 } },          // Teal
  { name: 'Strategy', hex: '#eab308', rgb: { r: 234, g: 179, b: 8 } },        // Yellow
];

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'did', 'do', 'does', 'doing', 'don', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself',
  'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves',
  'out', 'over', 'own', 'same', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs',
  'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under',
  'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
  'why', 'will', 'with', 'won', 'you', 'your', 'yours', 'yourself', 'yourselves'
]);

const EMBEDDING_DIM = 384;

/**
 * Deterministic 32-bit FNV-1a string hash
 */
function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Fast-path 384-dimensional n-gram & TF-IDF subword vectorizer (0ms latency)
 */
export function createFastPathEmbedding(text: string): Float32Array {
  const vec = new Float32Array(EMBEDDING_DIM);
  if (!text || !text.trim()) return vec;

  const normalized = text.toLowerCase().trim();
  const words = normalized.split(/[^a-z0-9_]+/).filter((w) => w.length > 0);

  // Term frequency accumulator
  const tfMap = new Map<string, number>();

  for (const word of words) {
    if (!STOP_WORDS.has(word)) {
      tfMap.set(word, (tfMap.get(word) || 0) + 1.8);
    } else {
      tfMap.set(word, (tfMap.get(word) || 0) + 0.3);
    }

    // Character 3-grams and 4-grams for subword / morphological similarity
    const padded = `^${word}$`;
    for (let len = 3; len <= 4; len++) {
      for (let i = 0; i <= padded.length - len; i++) {
        const shingle = padded.substring(i, i + len);
        tfMap.set(shingle, (tfMap.get(shingle) || 0) + 0.8);
      }
    }
  }

  // Project hashed features into EMBEDDING_DIM buckets with sign hashing
  for (const [feature, weight] of tfMap.entries()) {
    const h1 = fnv1a(feature);
    const bucket = h1 % EMBEDDING_DIM;
    // Sign hash for unbiased random projection
    const sign = (h1 & 0x80000000) ? -1 : 1;
    const sublinearWeight = Math.log(1 + weight);
    vec[bucket] += sign * sublinearWeight;
  }

  // L2 Normalization so ||vec|| = 1
  let sumSq = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    sumSq += vec[i] * vec[i];
  }

  if (sumSq > 0) {
    const invNorm = 1 / Math.sqrt(sumSq);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vec[i] *= invNorm;
    }
  }

  return vec;
}

/**
 * Cosine similarity between two vectors in [-1, 1]
 */
export function cosineSimilarity(
  vecA?: Float32Array | number[],
  vecB?: Float32Array | number[]
): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = vecA.length;

  for (let i = 0; i < len; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA <= 0 || normB <= 0) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(-1, Math.min(1, sim));
}

// -------------------------------------------------------------
// Neural Transformer Background Pipeline (@xenova/transformers)
// -------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transformerPipelinePromise: Promise<any> | null = null;
let isTransformerReady = false;

export function isNeuralTransformerReady(): boolean {
  return isTransformerReady;
}

async function loadTransformerPipeline() {
  try {
    const { pipeline, env } = await import('@xenova/transformers');
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    });
    isTransformerReady = true;
    return pipe;
  } catch (err) {
    console.info('Neural transformer background loading inactive; using fast-path n-gram engine:', err);
    return null;
  }
}

export function initTransformerPipeline(): void {
  if (!transformerPipelinePromise) {
    transformerPipelinePromise = loadTransformerPipeline();
  }
}

/**
 * Compute embedding vector for given text.
 * Uses fast-path immediately, or upgraded transformer if available.
 */
export async function computeEmbedding(text: string): Promise<Float32Array> {
  const fastVec = createFastPathEmbedding(text);

  // Trigger lazy loading of transformer pipeline in the background
  if (!transformerPipelinePromise) {
    initTransformerPipeline();
  }

  if (isTransformerReady && transformerPipelinePromise) {
    try {
      const pipe = await transformerPipelinePromise;
      if (pipe) {
        const output = await pipe(text, { pooling: 'mean', normalize: true });
        return new Float32Array(output.data);
      }
    } catch {
      // Return fastVec on failure
    }
  }

  return fastVec;
}

// -------------------------------------------------------------
// Graph Clustering & Harmonic Color Tint Assignment
// -------------------------------------------------------------
export interface ClusterableNode {
  id: string;
  embedding?: Float32Array | number[];
  clusterId?: number;
  clusterColor?: ClusterColor;
}

/**
 * Disjoint Set Union (Union-Find) for connected components
 */
class DisjointSet {
  private parent: Map<string, string> = new Map();
  private rank: Map<string, number> = new Map();

  constructor(ids: string[]) {
    for (const id of ids) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    const p = this.parent.get(id);
    if (!p) return id;
    if (p !== id) {
      const root = this.find(p);
      this.parent.set(id, root);
      return root;
    }
    return p;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;

    const rankA = this.rank.get(rootA) || 0;
    const rankB = this.rank.get(rootB) || 0;

    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }
  }
}

/**
 * Partitions nodes into semantic clusters based on similarity threshold (S >= 0.60)
 * and assigns consistent, deterministic cluster palette colors.
 */
export function updateNodeClusters(
  nodes: ClusterableNode[],
  similarityThreshold: number = 0.60
): Map<number, ClusterableNode[]> {
  const ids = nodes.map((n) => n.id);
  const dsu = new DisjointSet(ids);

  // 1. Union pairs where similarity >= threshold
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const nodeA = nodes[i];
      const nodeB = nodes[j];
      if (!nodeA.embedding || !nodeB.embedding) continue;

      const sim = cosineSimilarity(nodeA.embedding, nodeB.embedding);
      if (sim >= similarityThreshold) {
        dsu.union(nodeA.id, nodeB.id);
      }
    }
  }

  // 2. Group nodes by component root
  const rootGroups = new Map<string, ClusterableNode[]>();
  for (const node of nodes) {
    const root = dsu.find(node.id);
    const list = rootGroups.get(root) || [];
    list.push(node);
    rootGroups.set(root, list);
  }

  // 3. Filter clusters with size >= 2 and assign palette colors
  const clusters = new Map<number, ClusterableNode[]>();
  let clusterIndex = 0;

  for (const [, group] of rootGroups.entries()) {
    if (group.length >= 2) {
      const color = CLUSTER_PALETTE[clusterIndex % CLUSTER_PALETTE.length];
      for (const node of group) {
        node.clusterId = clusterIndex;
        node.clusterColor = color;
      }
      clusters.set(clusterIndex, group);
      clusterIndex++;
    } else {
      // Single isolated node has no cluster tint
      for (const node of group) {
        node.clusterId = undefined;
        node.clusterColor = undefined;
      }
    }
  }

  return clusters;
}
