import { PhysicsEngine } from '../physics/engine';
import { NodeManager } from '../physics/nodeManager';
import { soundFX } from '../audio/soundFX';
import { showHudToast } from './shortcuts';
import {
  exportToObsidianCanvas,
  exportToMarkdown,
  exportToJson,
  importFromJson,
  downloadFile,
  getExportTimestamp,
} from '../export/exporter';
import { parseDroppedFile } from '../import/importer';

export interface ExportModalOptions {
  physics: PhysicsEngine;
  nodeManager?: NodeManager;
}

export class ExportModal {
  private physics: PhysicsEngine;
  private nodeManager?: NodeManager;
  private modalElement: HTMLElement | null = null;
  private isOpen: boolean = false;

  constructor(options: ExportModalOptions) {
    this.physics = options.physics;
    this.nodeManager = options.nodeManager;
    this.createModal();
  }

  private createModal(): void {
    let modal = document.getElementById('export-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'export-modal';
      modal.className = 'export-modal-backdrop';
      modal.innerHTML = `
        <div class="export-modal-card">
          <div class="export-modal-header">
            <div class="export-modal-title">
              <span class="export-title-icon">⇪</span>
              <span>Export & Backup Canvas</span>
            </div>
            <button class="export-modal-close" aria-label="Close export dialog">✕</button>
          </div>

          <div class="export-modal-body">
            <div class="export-grid">
              <!-- Card 1: Obsidian Canvas -->
              <div class="export-card">
                <div class="export-card-header">
                  <span class="export-card-badge canvas">OBSIDIAN</span>
                  <h3 class="export-card-title">Obsidian Canvas (.canvas)</h3>
                </div>
                <p class="export-card-desc">
                  Native Obsidian infinite canvas format. Exports all thought nodes with coordinates, dimensions, cluster colors, and directional links.
                </p>
                <div class="export-card-actions">
                  <button class="export-btn primary" id="btn-export-canvas">
                    Download .canvas
                  </button>
                </div>
              </div>

              <!-- Card 2: Structured Notes -->
              <div class="export-card">
                <div class="export-card-header">
                  <span class="export-card-badge md">MARKDOWN</span>
                  <h3 class="export-card-title">Structured Notes (.md)</h3>
                </div>
                <p class="export-card-desc">
                  Hierarchical outline grouped into semantic clusters with bidirectional wikilinks (<code>[[Topic]]</code>) and loose thoughts.
                </p>
                <div class="export-card-actions">
                  <button class="export-btn primary" id="btn-export-md">
                    Download .md
                  </button>
                  <button class="export-btn secondary" id="btn-copy-md">
                    Copy to Clipboard
                  </button>
                </div>
              </div>

              <!-- Card 3: Full State Backup & Restore -->
              <div class="export-card full-width">
                <div class="export-card-header">
                  <span class="export-card-badge json">JSON STATE</span>
                  <h3 class="export-card-title">Backup & Restore Snapshot (.json)</h3>
                </div>
                <p class="export-card-desc">
                  Complete snapshot including node bodies, text, spring links, and camera viewport.
                </p>
                <div class="export-card-actions">
                  <button class="export-btn primary" id="btn-export-json">
                    Download Backup .json
                  </button>
                </div>

                <!-- Dropzone for Canvas and JSON import -->
                <div class="json-dropzone" id="json-dropzone">
                  <span class="dropzone-icon">📥</span>
                  <span class="dropzone-text">Drag & drop <code>.canvas</code> or <code>.json</code> here, or click to restore</span>
                  <input type="file" id="json-file-input" accept=".json,.canvas" style="display: none;" />
                </div>
              </div>
            </div>
          </div>

          <div class="export-modal-footer">
            <span>Press <kbd>Esc</kbd> or click outside to dismiss • Hotkey: <kbd>E</kbd></span>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    this.modalElement = modal;

    this.setupListeners();
  }

  private setupListeners(): void {
    if (!this.modalElement) return;

    // Close button & backdrop click
    const closeBtn = this.modalElement.querySelector('.export-modal-close');
    closeBtn?.addEventListener('click', () => this.close());

    this.modalElement.addEventListener('click', (e) => {
      if (e.target === this.modalElement) {
        this.close();
      }
    });

    // 1. Export Obsidian Canvas
    const canvasBtn = this.modalElement.querySelector('#btn-export-canvas');
    canvasBtn?.addEventListener('click', () => {
      const data = exportToObsidianCanvas(this.physics);
      const filename = `mental-defrag-${getExportTimestamp()}.canvas`;
      downloadFile(filename, data, 'application/json');
      soundFX.playClick();
      showHudToast(`Downloaded ${filename}`);
    });

    // 2. Export Markdown
    const mdBtn = this.modalElement.querySelector('#btn-export-md');
    mdBtn?.addEventListener('click', () => {
      const data = exportToMarkdown(this.physics);
      const filename = `mental-defrag-${getExportTimestamp()}.md`;
      downloadFile(filename, data, 'text/markdown;charset=utf-8');
      soundFX.playClick();
      showHudToast(`Downloaded ${filename}`);
    });

    const copyBtn = this.modalElement.querySelector('#btn-copy-md') as HTMLButtonElement;
    copyBtn?.addEventListener('click', async () => {
      const data = exportToMarkdown(this.physics);
      try {
        await navigator.clipboard.writeText(data);
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        soundFX.playClick();
        showHudToast('Copied Markdown notes to clipboard');
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 1800);
      } catch {
        showHudToast('Could not access clipboard');
      }
    });

    // 3. Export JSON Snapshot
    const jsonBtn = this.modalElement.querySelector('#btn-export-json');
    jsonBtn?.addEventListener('click', () => {
      const data = exportToJson(this.physics);
      const filename = `mental-defrag-backup-${getExportTimestamp()}.json`;
      downloadFile(filename, data, 'application/json');
      soundFX.playClick();
      showHudToast(`Saved backup: ${filename}`);
    });

    // 4. JSON Import Dropzone & File Input
    const dropzone = this.modalElement.querySelector('#json-dropzone') as HTMLElement;
    const fileInput = this.modalElement.querySelector('#json-file-input') as HTMLInputElement;

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => {
        fileInput.click();
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
          const file = fileInput.files[0];
          this.processImportFile(file);
          fileInput.value = '';
        }
      });

      // Drag and Drop
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-active');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('drag-active');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-active');
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
          const file = e.dataTransfer.files[0];
          this.processImportFile(file);
        }
      });
    }

    // Escape listener
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    });
  }

  private async processImportFile(file: File): Promise<void> {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.json') && !name.endsWith('.canvas')) {
      showHudToast('Only .canvas and .json files are supported');
      return;
    }

    try {
      const parsed = await parseDroppedFile(file);
      if (parsed.nodes.length === 0) {
        showHudToast('No thoughts found in file');
        return;
      }

      if (this.nodeManager) {
        await this.nodeManager.importGraph(parsed, 'replace');
      } else {
        const text = await file.text();
        const res = importFromJson(text, this.physics);
        if (res.success) {
          soundFX.playSpawn();
          showHudToast(`Restored canvas (${res.nodeCount} thoughts)`);
        } else {
          showHudToast(`Import error: ${res.error || 'Invalid file'}`);
          return;
        }
      }
      this.close();
    } catch (err) {
      showHudToast(err instanceof Error ? err.message : 'Error reading file');
    }
  }

  public open(): void {
    if (!this.modalElement) return;
    this.isOpen = true;
    this.modalElement.classList.add('visible');
  }

  public close(): void {
    if (!this.modalElement) return;
    this.isOpen = false;
    this.modalElement.classList.remove('visible');
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
}
