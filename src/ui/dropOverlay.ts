import { PhysicsEngine } from '../physics/engine';
import { NodeManager } from '../physics/nodeManager';
import { parseDroppedFile, ParsedGraphData } from '../import/importer';
import { showHudToast } from './shortcuts';

export interface DropOverlayOptions {
  physics: PhysicsEngine;
  nodeManager: NodeManager;
}

export class DropOverlay {
  private physics: PhysicsEngine;
  private nodeManager: NodeManager;
  private overlayElement: HTMLElement | null = null;
  private promptElement: HTMLElement | null = null;
  private dragCounter: number = 0;

  constructor(options: DropOverlayOptions) {
    this.physics = options.physics;
    this.nodeManager = options.nodeManager;

    this.createOverlay();
    this.setupWindowListeners();
  }

  private createOverlay(): void {
    let overlay = document.getElementById('file-drop-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'file-drop-overlay';
      overlay.className = 'file-drop-overlay';
      overlay.innerHTML = `
        <div class="drop-overlay-frame">
          <div class="drop-overlay-content">
            <div class="drop-overlay-icon">📥</div>
            <h2 class="drop-overlay-title">Drop to Ingest into Physics Canvas</h2>
            <p class="drop-overlay-subtitle">Obsidian Canvas (.canvas) or Backup Snapshot (.json)</p>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    this.overlayElement = overlay;

    // Create container for Merge vs Replace Prompt
    let prompt = document.getElementById('import-mode-modal');
    if (!prompt) {
      prompt = document.createElement('div');
      prompt.id = 'import-mode-modal';
      prompt.className = 'import-modal-backdrop';
      document.body.appendChild(prompt);
    }
    this.promptElement = prompt;
  }

  private setupWindowListeners(): void {
    const isFileDrag = (e: DragEvent) => {
      if (!e.dataTransfer) return false;
      const types = Array.from(e.dataTransfer.types);
      return types.includes('Files');
    };

    window.addEventListener('dragenter', (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this.dragCounter++;
      if (this.dragCounter === 1 && this.overlayElement) {
        this.overlayElement.classList.add('visible');
      }
    });

    window.addEventListener('dragover', (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    window.addEventListener('dragleave', (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this.dragCounter--;
      if (this.dragCounter <= 0 && this.overlayElement) {
        this.dragCounter = 0;
        this.overlayElement.classList.remove('visible');
      }
    });

    window.addEventListener('drop', async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.dragCounter = 0;
      if (this.overlayElement) {
        this.overlayElement.classList.remove('visible');
      }

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      const name = file.name.toLowerCase();
      if (!name.endsWith('.canvas') && !name.endsWith('.json')) {
        showHudToast('Please drop an Obsidian .canvas or .json backup file');
        return;
      }

      const clientX = e.clientX;
      const clientY = e.clientY;
      const dropWorldPos = this.physics.screenToWorld(clientX, clientY);

      try {
        const parsed = await parseDroppedFile(file);
        if (parsed.nodes.length === 0) {
          showHudToast('No thought nodes found in dropped file');
          return;
        }

        // If canvas has existing nodes, prompt user to choose Merge vs. Replace
        if (this.physics.nodeBodies.length > 0) {
          this.promptImportMode(parsed, dropWorldPos);
        } else {
          // If empty, import directly in replace mode
          await this.nodeManager.importGraph(parsed, 'replace');
        }
      } catch (err) {
        showHudToast(err instanceof Error ? err.message : 'Error reading dropped file');
      }
    });
  }

  /**
   * Prompts user with a glassmorphic dialog to choose Merge or Replace
   */
  private promptImportMode(data: ParsedGraphData, dropWorldPos: { x: number; y: number }): void {
    if (!this.promptElement) return;

    const currentCount = this.physics.nodeBodies.length;
    const importedCount = data.nodes.length;
    const formatLabel = data.sourceType === 'obsidian' ? 'Obsidian Canvas' : 'JSON Backup';

    this.promptElement.innerHTML = `
      <div class="import-modal-card">
        <div class="import-modal-header">
          <div class="import-modal-badge">${formatLabel}</div>
          <h3 class="import-modal-title">Import "${data.fileName}"</h3>
          <p class="import-modal-desc">
            Canvas currently contains <strong>${currentCount}</strong> thought${currentCount === 1 ? '' : 's'}. 
            Incoming file has <strong>${importedCount}</strong> thought${importedCount === 1 ? '' : 's'} and <strong>${data.links.length}</strong> link${data.links.length === 1 ? '' : 's'}.
          </p>
        </div>

        <div class="import-modal-actions">
          <button class="import-choice-btn merge" id="btn-import-merge">
            <div class="choice-title">Merge at Cursor</div>
            <div class="choice-desc">Adds ${importedCount} thoughts around your drop position without clearing active thoughts</div>
          </button>
          
          <button class="import-choice-btn replace" id="btn-import-replace">
            <div class="choice-title">Replace Canvas</div>
            <div class="choice-desc">Clears current canvas and replaces everything with the incoming graph</div>
          </button>
        </div>

        <div class="import-modal-footer">
          <button class="import-cancel-btn" id="btn-import-cancel">Cancel</button>
        </div>
      </div>
    `;

    this.promptElement.classList.add('visible');

    const cleanup = () => {
      this.promptElement?.classList.remove('visible');
      window.removeEventListener('keydown', handleEsc);
    };

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
      }
    };
    window.addEventListener('keydown', handleEsc);

    const btnMerge = this.promptElement.querySelector('#btn-import-merge');
    btnMerge?.addEventListener('click', async () => {
      cleanup();
      await this.nodeManager.importGraph(data, 'merge', dropWorldPos);
    });

    const btnReplace = this.promptElement.querySelector('#btn-import-replace');
    btnReplace?.addEventListener('click', async () => {
      cleanup();
      await this.nodeManager.importGraph(data, 'replace');
    });

    const btnCancel = this.promptElement.querySelector('#btn-import-cancel');
    btnCancel?.addEventListener('click', () => {
      cleanup();
    });

    this.promptElement.addEventListener('click', (e) => {
      if (e.target === this.promptElement) {
        cleanup();
      }
    });
  }
}
