/**
 * State Service
 * Manages persistent state for sync operations including checksum storage
 */

import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { ComponentType } from '../types/ion.js';
import { Logger } from '../utils/logger.js';
import { computeHash } from '../utils/crypto.js';

const logger = new Logger('StateService');

/**
 * State for a single component
 */
export interface ComponentState {
  /** SHA256 hash of the ION component content */
  ionHash: string;
  /** GitHub blob SHA */
  gitSha: string;
  /** ISO timestamp of last sync */
  lastSynced: string;
}

/**
 * Full state file structure
 */
export interface StateFile {
  /** Schema version */
  version: '1.0';
  /** ISO timestamp of last sync operation */
  lastSync: string;
  /** Component states organised by type and name */
  components: {
    [type: string]: {
      [name: string]: ComponentState;
    };
  };
}

/**
 * Options for StateService
 */
export interface StateServiceOptions {
  /** Directory to store state files */
  stateDir?: string;
  /** State file name */
  fileName?: string;
}

/**
 * Default state directory
 */
const DEFAULT_STATE_DIR = '.infor-cicd';
const DEFAULT_STATE_FILE = 'state.json';

/**
 * State Service for managing sync state and checksums
 */
export class StateService {
  private stateDir: string;
  private statePath: string;
  private state: StateFile | null = null;

  /**
   * Creates a new StateService instance
   * @param options - Configuration options
   */
  constructor(options?: StateServiceOptions) {
    this.stateDir = options?.stateDir ?? DEFAULT_STATE_DIR;
    this.statePath = join(this.stateDir, options?.fileName ?? DEFAULT_STATE_FILE);
  }

  /**
   * Ensures the state directory exists
   */
  private async ensureStateDir(): Promise<void> {
    try {
      await access(this.stateDir);
    } catch {
      await mkdir(this.stateDir, { recursive: true });
      logger.debug('Created state directory', { path: this.stateDir });
    }
  }

  /**
   * Checks if a state file exists
   * @returns True if state file exists
   */
  public async exists(): Promise<boolean> {
    try {
      await access(this.statePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Loads the state file from disk
   * @returns The loaded state
   */
  public async load(): Promise<StateFile> {
    if (this.state) {
      return this.state;
    }

    try {
      const content = await readFile(this.statePath, 'utf-8');
      this.state = JSON.parse(content) as StateFile;
      logger.debug('Loaded state file', { path: this.statePath });
      return this.state;
    } catch {
      // Return empty state if file doesn't exist
      logger.debug('No existing state file, creating new state');
      this.state = this.createEmptyState();
      return this.state;
    }
  }

  /**
   * Saves the state file to disk
   */
  public async save(): Promise<void> {
    if (!this.state) {
      logger.warn('No state to save');
      return;
    }

    await this.ensureStateDir();

    this.state.lastSync = new Date().toISOString();

    const content = JSON.stringify(this.state, null, 2);
    await writeFile(this.statePath, content, 'utf-8');

    logger.debug('Saved state file', { path: this.statePath });
  }

  /**
   * Creates an empty state object
   * @returns Empty state
   */
  private createEmptyState(): StateFile {
    return {
      version: '1.0',
      lastSync: new Date().toISOString(),
      components: {},
    };
  }

  /**
   * Gets the state for a specific component
   * @param type - Component type
   * @param name - Component name
   * @returns Component state or undefined
   */
  public async getComponentState(
    type: ComponentType,
    name: string
  ): Promise<ComponentState | undefined> {
    const state = await this.load();
    return state.components[type]?.[name];
  }

  /**
   * Sets the state for a specific component
   * @param type - Component type
   * @param name - Component name
   * @param componentState - State to set
   */
  public async setComponentState(
    type: ComponentType,
    name: string,
    componentState: ComponentState
  ): Promise<void> {
    const state = await this.load();

    if (!state.components[type]) {
      state.components[type] = {};
    }

    state.components[type][name] = componentState;
  }

  /**
   * Updates component state after an export operation
   * @param type - Component type
   * @param name - Component name
   * @param content - Component JSON content
   * @param gitSha - GitHub blob SHA
   */
  public async recordExport(
    type: ComponentType,
    name: string,
    content: string,
    gitSha: string
  ): Promise<void> {
    await this.setComponentState(type, name, {
      ionHash: computeHash(content),
      gitSha,
      lastSynced: new Date().toISOString(),
    });
  }

  /**
   * Updates component state after an import operation
   * @param type - Component type
   * @param name - Component name
   * @param content - Component JSON content
   * @param gitSha - GitHub blob SHA (if known)
   */
  public async recordImport(
    type: ComponentType,
    name: string,
    content: string,
    gitSha?: string
  ): Promise<void> {
    await this.setComponentState(type, name, {
      ionHash: computeHash(content),
      gitSha: gitSha ?? '',
      lastSynced: new Date().toISOString(),
    });
  }

  /**
   * Removes a component from state
   * @param type - Component type
   * @param name - Component name
   */
  public async removeComponent(type: ComponentType, name: string): Promise<void> {
    const state = await this.load();

    if (state.components[type]) {
      delete state.components[type][name];

      // Clean up empty type objects
      if (Object.keys(state.components[type]).length === 0) {
        delete state.components[type];
      }
    }
  }

  /**
   * Checks if a component has changed since last sync
   * @param type - Component type
   * @param name - Component name
   * @param currentContent - Current component content
   * @returns True if changed or no previous state exists
   */
  public async hasChanged(
    type: ComponentType,
    name: string,
    currentContent: string
  ): Promise<boolean> {
    const componentState = await this.getComponentState(type, name);

    if (!componentState) {
      return true; // No previous state, treat as changed
    }

    const currentHash = computeHash(currentContent);
    return currentHash !== componentState.ionHash;
  }

  /**
   * Gets all component states for a specific type
   * @param type - Component type
   * @returns Map of component name to state
   */
  public async getTypeStates(
    type: ComponentType
  ): Promise<Map<string, ComponentState>> {
    const state = await this.load();
    const typeStates = state.components[type] ?? {};

    return new Map(Object.entries(typeStates));
  }

  /**
   * Gets all component states
   * @returns Map of type to map of name to state
   */
  public async getAllStates(): Promise<Map<ComponentType, Map<string, ComponentState>>> {
    const state = await this.load();
    const result = new Map<ComponentType, Map<string, ComponentState>>();

    for (const [type, components] of Object.entries(state.components)) {
      result.set(type as ComponentType, new Map(Object.entries(components)));
    }

    return result;
  }

  /**
   * Gets the last sync timestamp
   * @returns ISO timestamp of last sync, or undefined if never synced
   */
  public async getLastSync(): Promise<string | undefined> {
    if (!(await this.exists())) {
      return undefined;
    }

    const state = await this.load();
    return state.lastSync;
  }

  /**
   * Gets statistics about the current state
   * @returns State statistics
   */
  public async getStats(): Promise<{
    totalComponents: number;
    byType: Record<string, number>;
    lastSync: string | undefined;
  }> {
    if (!(await this.exists())) {
      return {
        totalComponents: 0,
        byType: {},
        lastSync: undefined,
      };
    }

    const state = await this.load();
    const byType: Record<string, number> = {};
    let total = 0;

    for (const [type, components] of Object.entries(state.components)) {
      const count = Object.keys(components).length;
      byType[type] = count;
      total += count;
    }

    return {
      totalComponents: total,
      byType,
      lastSync: state.lastSync,
    };
  }

  /**
   * Clears all state
   */
  public async clear(): Promise<void> {
    this.state = this.createEmptyState();
    await this.save();
    logger.info('Cleared state');
  }

  /**
   * Gets the path to the state file
   * @returns State file path
   */
  public getStatePath(): string {
    return this.statePath;
  }
}
