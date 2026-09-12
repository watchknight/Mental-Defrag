import Matter from 'matter-js';
import { NodeData } from './engine';
import { cosineSimilarity } from '../ai/clustering';

const { Body, Constraint, Composite } = Matter;

export interface SemanticFilament {
  bodyA: Matter.Body;
  bodyB: Matter.Body;
  similarity: number;
}

export class SemanticForcesManager {
  private engine: Matter.Engine;
  public enabled: boolean = true;
  private semanticSprings: Matter.Constraint[] = [];
  private filaments: SemanticFilament[] = [];

  // Physics constants
  private readonly SIMILARITY_THRESHOLD = 0.60;
  private readonly SPRING_THRESHOLD = 0.82;
  private readonly FILAMENT_THRESHOLD = 0.70;
  private readonly TARGET_DISTANCE = 180;
  private readonly FORCE_CONSTANT = 0.00015;

  constructor(engine: Matter.Engine) {
    this.engine = engine;
  }

  public toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.clearSemanticSprings();
      this.filaments = [];
    }
    return this.enabled;
  }

  public setEnabled(val: boolean): void {
    if (this.enabled === val) return;
    this.enabled = val;
    if (!this.enabled) {
      this.clearSemanticSprings();
      this.filaments = [];
    }
  }

  public getFilaments(): SemanticFilament[] {
    return this.enabled ? this.filaments : [];
  }

  public getSemanticSprings(): Matter.Constraint[] {
    return this.semanticSprings;
  }

  /**
   * Evaluates pairwise semantic similarity, applies dynamic mutual attraction,
   * manages semantic springs, and collects tension filaments.
   */
  public updateForces(
    nodeBodies: Matter.Body[],
    mouseConstraint: Matter.MouseConstraint,
    hasManualConnection: (bodyA: Matter.Body, bodyB: Matter.Body) => boolean
  ): void {
    this.filaments = [];
    if (!this.enabled || nodeBodies.length < 2) {
      if (this.semanticSprings.length > 0) {
        this.clearSemanticSprings();
      }
      return;
    }

    const currentDragged = mouseConstraint.body;
    const activeSpringPairs = new Set<string>();

    // 1. Iterate over all unique node pairs
    for (let i = 0; i < nodeBodies.length; i++) {
      const bodyA = nodeBodies[i];
      const dataA = (bodyA as unknown as { nodeData?: NodeData }).nodeData;
      if (!dataA?.embedding) continue;

      for (let j = i + 1; j < nodeBodies.length; j++) {
        const bodyB = nodeBodies[j];
        const dataB = (bodyB as unknown as { nodeData?: NodeData }).nodeData;
        if (!dataB?.embedding) continue;

        const S = cosineSimilarity(dataA.embedding, dataB.embedding);
        if (S < this.SIMILARITY_THRESHOLD) continue;

        const dx = bodyB.position.x - bodyA.position.x;
        const dy = bodyB.position.y - bodyA.position.y;
        const d = Math.hypot(dx, dy);
        if (d < 1) continue;

        const pairKey = bodyA.id < bodyB.id ? `${bodyA.id}_${bodyB.id}` : `${bodyB.id}_${bodyA.id}`;

        // 2. Dynamic Mutual Attraction Field (d > 180px)
        if (d > this.TARGET_DISTANCE) {
          const isBeingDragged = currentDragged === bodyA || currentDragged === bodyB;
          if (!isBeingDragged) {
            const rawForce = this.FORCE_CONSTANT * (d - this.TARGET_DISTANCE) * (S * S);
            // Clamp maximum force to prevent erratic slingshots
            const forceMag = Math.min(0.012, Math.max(0, rawForce));

            const ux = dx / d;
            const uy = dy / d;

            const massA = bodyA.mass || 1;
            const massB = bodyB.mass || 1;
            const totalMass = massA + massB;

            // Scale by relative mass so larger thoughts exert greater gravitational influence
            const fAx = ux * forceMag * (massB / totalMass) * massA;
            const fAy = uy * forceMag * (massB / totalMass) * massA;

            const fBx = -ux * forceMag * (massA / totalMass) * massB;
            const fBy = -uy * forceMag * (massA / totalMass) * massB;

            Body.applyForce(bodyA, bodyA.position, { x: fAx, y: fAy });
            Body.applyForce(bodyB, bodyB.position, { x: fBx, y: fBy });
          }
        }

        // 3. Shimmering Tension Filaments (S >= 0.70)
        if (S >= this.FILAMENT_THRESHOLD) {
          this.filaments.push({ bodyA, bodyB, similarity: S });
        }

        // 4. Elastic Semantic Springs (S >= 0.82)
        if (S >= this.SPRING_THRESHOLD) {
          activeSpringPairs.add(pairKey);

          // If manual spring or existing semantic spring already present, skip creation
          if (!hasManualConnection(bodyA, bodyB) && !this.hasSemanticSpring(bodyA, bodyB)) {
            const constraint = Constraint.create({
              bodyA,
              bodyB,
              length: Math.max(this.TARGET_DISTANCE, Math.min(d, 280)),
              stiffness: 0.015,
              damping: 0.08,
              render: { visible: false },
              label: 'semantic-spring',
            });
            (constraint as unknown as { isSemantic?: boolean }).isSemantic = true;
            Composite.add(this.engine.world, constraint);
            this.semanticSprings.push(constraint);
          }
        }
      }
    }

    // 5. Clean up semantic springs that are no longer eligible
    if (this.semanticSprings.length > 0) {
      const remaining: Matter.Constraint[] = [];
      for (const c of this.semanticSprings) {
        if (!c.bodyA || !c.bodyB) {
          Composite.remove(this.engine.world, c);
          continue;
        }

        const bA = c.bodyA;
        const bB = c.bodyB;
        // Verify both bodies are still alive in the world
        const aliveA = nodeBodies.includes(bA);
        const aliveB = nodeBodies.includes(bB);

        if (!aliveA || !aliveB) {
          Composite.remove(this.engine.world, c);
          continue;
        }

        const pairKey = bA.id < bB.id ? `${bA.id}_${bB.id}` : `${bB.id}_${bA.id}`;
        const currentDist = Math.hypot(bB.position.x - bA.position.x, bB.position.y - bA.position.y);

        // Dissolve spring if similarity dropped below threshold or stretched too far (> 420px)
        if (activeSpringPairs.has(pairKey) && currentDist < 420) {
          remaining.push(c);
        } else {
          Composite.remove(this.engine.world, c);
        }
      }
      this.semanticSprings = remaining;
    }
  }

  private hasSemanticSpring(bodyA: Matter.Body, bodyB: Matter.Body): boolean {
    return this.semanticSprings.some(
      (c) =>
        (c.bodyA === bodyA && c.bodyB === bodyB) ||
        (c.bodyA === bodyB && c.bodyB === bodyA)
    );
  }

  public clearSemanticSprings(): void {
    for (const c of this.semanticSprings) {
      Composite.remove(this.engine.world, c);
    }
    this.semanticSprings = [];
  }

  public destroy(): void {
    this.clearSemanticSprings();
    this.filaments = [];
  }
}
