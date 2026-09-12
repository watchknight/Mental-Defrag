export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  targetX: number;
  targetY: number;
  targetZoom: number;
}

export class CameraController {
  public x: number = 0;
  public y: number = 0;
  public zoom: number = 1.0;
  public targetX: number = 0;
  public targetY: number = 0;
  public targetZoom: number = 1.0;

  constructor(initialX: number = 0, initialY: number = 0, initialZoom: number = 1.0) {
    this.x = initialX;
    this.y = initialY;
    this.zoom = initialZoom;
    this.targetX = initialX;
    this.targetY = initialY;
    this.targetZoom = initialZoom;
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  public screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.x) / this.zoom,
      y: (sy - this.y) / this.zoom,
    };
  }

  /**
   * Convert world coordinates to screen coordinates
   */
  public worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: wx * this.zoom + this.x,
      y: wy * this.zoom + this.y,
    };
  }

  /**
   * Smoothly zoom anchored to the specified screen coordinate
   */
  public zoomAt(screenX: number, screenY: number, factor: number): void {
    const currentTargetZoom = this.targetZoom;
    const newTargetZoom = Math.max(0.25, Math.min(3.0, currentTargetZoom * factor));
    if (Math.abs(newTargetZoom - currentTargetZoom) < 0.0001) return;

    // Anchor world coordinate directly under the mouse cursor
    const wx = (screenX - this.targetX) / currentTargetZoom;
    const wy = (screenY - this.targetY) / currentTargetZoom;

    this.targetZoom = newTargetZoom;
    this.targetX = screenX - wx * newTargetZoom;
    this.targetY = screenY - wy * newTargetZoom;
  }

  /**
   * Pan the camera by screen pixel delta
   */
  public panBy(dx: number, dy: number, instant: boolean = false): void {
    this.targetX += dx;
    this.targetY += dy;
    if (instant) {
      this.x += dx;
      this.y += dy;
    }
  }

  /**
   * Smooth interpolation (lerp factor: 0.12) inside animation loop
   */
  public update(): void {
    const LERP = 0.12;
    this.x += (this.targetX - this.x) * LERP;
    this.y += (this.targetY - this.y) * LERP;
    this.zoom += (this.targetZoom - this.zoom) * LERP;
  }

  /**
   * Calculate visible world coordinates bounds from camera frustum
   */
  public getVisibleBounds(screenWidth: number, screenHeight: number): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(screenWidth, screenHeight);
    return {
      minX: Math.min(topLeft.x, bottomRight.x),
      minY: Math.min(topLeft.y, bottomRight.y),
      maxX: Math.max(topLeft.x, bottomRight.x),
      maxY: Math.max(topLeft.y, bottomRight.y),
    };
  }
}
