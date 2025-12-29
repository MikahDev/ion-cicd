/**
 * Component Service
 * Centralises component operations with special handling for different types
 */

import { IONClient } from '../clients/ion-client.js';
import { GitHubClient } from '../clients/github-client.js';
import {
  ComponentType,
  IONComponent,
  IONComponentDetail,
  MappingComponent,
  ScriptComponent,
  COMPONENT_DISPLAY_NAMES,
  COMPONENT_CONFIG,
  IMPORT_ORDER,
} from '../types/ion.js';
import { ExportResult, ImportResult, BatchResult } from '../types/result.js';
import { Logger } from '../utils/logger.js';
import { computeHash } from '../utils/crypto.js';

const logger = new Logger('ComponentService');

/**
 * Conflict resolution strategy for import operations
 */
export type ConflictResolution = 'rename' | 'skip' | 'fail' | 'update';

/**
 * Options for export operations
 */
export interface ExportOptions {
  /** Specific component types to export */
  types?: ComponentType[];
  /** Specific component names to export (within a type) */
  items?: string[];
  /** Target GitHub repository name */
  repo: string;
  /** Target branch */
  branch: string;
  /** Skip uploading, just return what would be exported */
  dryRun?: boolean;
  /** Force export even if unchanged */
  force?: boolean;
}

/**
 * Options for import operations
 */
export interface ImportOptions {
  /** Specific component types to import */
  types?: ComponentType[];
  /** Specific component names to import (within a type) */
  items?: string[];
  /** Source GitHub repository name */
  repo: string;
  /** Source branch */
  branch: string;
  /** Skip creating, just return what would be imported */
  dryRun?: boolean;
  /** How to handle naming conflicts */
  onConflict: ConflictResolution;
}

/**
 * Maps display names back to component types
 */
const DISPLAY_NAME_TO_TYPE: Record<string, ComponentType> = Object.entries(
  COMPONENT_DISPLAY_NAMES
).reduce(
  (acc, [type, displayName]) => {
    acc[displayName] = type as ComponentType;
    return acc;
  },
  {} as Record<string, ComponentType>
);

/**
 * Component Service for managing ION component operations
 */
export class ComponentService {
  private ionClient: IONClient;
  private githubClient: GitHubClient;

  /**
   * Creates a new ComponentService instance
   * @param ionClient - Authenticated ION client
   * @param githubClient - Authenticated GitHub client
   */
  constructor(ionClient: IONClient, githubClient: GitHubClient) {
    this.ionClient = ionClient;
    this.githubClient = githubClient;
  }

  /**
   * Gets the display name for a component type (used as folder name)
   * @param type - Component type
   * @returns Display name
   */
  public getDisplayName(type: ComponentType): string {
    return COMPONENT_DISPLAY_NAMES[type];
  }

  /**
   * Gets the component type from a display name (folder name)
   * @param displayName - Display name / folder name
   * @returns Component type or undefined if not found
   */
  public getTypeFromDisplayName(displayName: string): ComponentType | undefined {
    return DISPLAY_NAME_TO_TYPE[displayName];
  }

  /**
   * Gets the GitHub file path for a component
   * @param type - Component type
   * @param name - Component name
   * @returns File path (e.g., "Document flow/MyFlow.json")
   */
  public getComponentPath(type: ComponentType, name: string): string {
    const displayName = this.getDisplayName(type);
    return `${displayName}/${name}.json`;
  }

  /**
   * Lists all components of a specific type from ION
   * @param type - Component type
   * @returns Array of components
   */
  public async listComponents(type: ComponentType): Promise<IONComponent[]> {
    return this.ionClient.listComponents(type);
  }

  /**
   * Lists all components across all types from ION
   * @returns Map of component type to components
   */
  public async listAllComponents(): Promise<Map<ComponentType, IONComponent[]>> {
    const result = new Map<ComponentType, IONComponent[]>();

    for (const type of Object.values(ComponentType)) {
      const components = await this.ionClient.listComponents(type);
      result.set(type, components);
    }

    return result;
  }

  /**
   * Fetches the full details of a component
   * @param type - Component type
   * @param name - Component name
   * @returns Component details
   */
  public async getComponent(type: ComponentType, name: string): Promise<IONComponentDetail> {
    return this.ionClient.getComponent(type, name);
  }

  /**
   * Exports a single component to JSON string
   * Uses approved version for scripts
   * @param type - Component type
   * @param name - Component name
   * @returns JSON string of the component
   */
  public async exportComponent(type: ComponentType, name: string): Promise<string> {
    const component = await this.getComponentForExport(type, name);
    return JSON.stringify(component, null, 2);
  }

  /**
   * Prepares a mapping component for import by updating mapperName references
   * @param mapping - Original mapping data
   * @param newName - New name for the mapping
   * @returns Prepared mapping data
   */
  private prepareMappingForImport(
    mapping: MappingComponent,
    newName: string
  ): MappingComponent {
    const prepared = { ...mapping, name: newName };

    if (prepared.mappingModels && Array.isArray(prepared.mappingModels)) {
      prepared.mappingModels = prepared.mappingModels.map((model) => ({
        ...model,
        mapperName: newName,
      }));
    }

    return prepared;
  }

  /**
   * Prepares an enterprise connector for import
   * Preserves all configuration fields, only removing system-managed fields
   * @param connector - Original connector data
   * @param newName - Optional new name for the connector
   * @returns Prepared connector data with all configuration preserved
   */
  private prepareEnterpriseConnectorForImport(
    connector: IONComponentDetail,
    newName?: string
  ): IONComponentDetail {
    // Clone the connector to avoid modifying the original
    const prepared = { ...connector };

    // Update name if provided
    if (newName) {
      prepared.name = newName;
    }

    // Remove system-managed fields that shouldn't be set on import
    // These are typically auto-generated by ION
    const systemFields = ['createdBy', 'createdDate', 'modifiedBy', 'modifiedDate', 'id', 'version'];
    for (const field of systemFields) {
      if (field in prepared) {
        delete (prepared as Record<string, unknown>)[field];
      }
    }

    return prepared;
  }

  /**
   * Prepares a script for import
   * Removes version-specific fields that shouldn't be set on create
   * @param script - Original script data
   * @param newName - New name for the script
   * @returns Prepared script data
   */
  private prepareScriptForImport(script: ScriptComponent, newName: string): ScriptComponent {
    const prepared = { ...script, name: newName };

    // Remove fields that are managed by ION
    delete prepared.versionNumber;
    delete prepared.status;

    return prepared;
  }

  /**
   * Prepares a library for import
   * @param library - Original library data
   * @param newName - New name for the library
   * @returns Prepared library data
   */
  private prepareLibraryForImport(
    library: IONComponentDetail,
    newName: string
  ): IONComponentDetail {
    return { ...library, name: newName };
  }

  /**
   * Prepares component data for import, applying type-specific transformations
   * @param type - Component type
   * @param data - Original component data
   * @param newName - Optional new name (if renaming)
   * @returns Prepared component data
   */
  public prepareForImport(
    type: ComponentType,
    data: IONComponentDetail,
    newName?: string
  ): IONComponentDetail | Partial<IONComponentDetail> {
    const config = COMPONENT_CONFIG[type];
    const finalName = newName ?? data.name;

    if (config.specialHandling === 'mapping') {
      return this.prepareMappingForImport(data as MappingComponent, finalName);
    }

    if (config.specialHandling === 'enterprise-connector') {
      return this.prepareEnterpriseConnectorForImport(data, finalName);
    }

    if (config.specialHandling === 'script') {
      return this.prepareScriptForImport(data as ScriptComponent, finalName);
    }

    if (config.specialHandling === 'library') {
      return this.prepareLibraryForImport(data, finalName);
    }

    // Default handling: just update the name
    return { ...data, name: finalName };
  }

  /**
   * Checks if a component with the given name already exists
   * @param type - Component type
   * @param name - Component name
   * @returns True if exists
   */
  public async componentExists(type: ComponentType, name: string): Promise<boolean> {
    return this.ionClient.componentExists(type, name);
  }

  /**
   * Generates a unique name by appending a suffix
   * @param type - Component type
   * @param baseName - Original name
   * @returns Unique name
   */
  public async generateUniqueName(type: ComponentType, baseName: string): Promise<string> {
    let suffix = 1;
    let candidateName = `${baseName}_${suffix}`;

    while (await this.componentExists(type, candidateName)) {
      suffix++;
      candidateName = `${baseName}_${suffix}`;
    }

    return candidateName;
  }

  /**
   * Imports a single component into ION
   * @param type - Component type
   * @param data - Component data
   * @param onConflict - How to handle naming conflicts
   * @returns Import result
   */
  public async importComponent(
    type: ComponentType,
    data: IONComponentDetail,
    onConflict: ConflictResolution
  ): Promise<ImportResult> {
    const originalName = data.name;
    let finalName = originalName;
    let status: ImportResult['status'] = 'created';

    // Check for existing component
    const exists = await this.componentExists(type, originalName);

    if (exists) {
      switch (onConflict) {
        case 'skip':
          logger.info('Skipping existing component', { type, name: originalName });
          return {
            originalName,
            finalName: originalName,
            type: this.getDisplayName(type),
            status: 'skipped',
          };

        case 'fail':
          logger.error('Component already exists', { type, name: originalName });
          return {
            originalName,
            finalName: originalName,
            type: this.getDisplayName(type),
            status: 'failed',
            error: `Component "${originalName}" already exists`,
          };

        case 'rename':
          finalName = await this.generateUniqueName(type, originalName);
          logger.info('Renaming component to avoid conflict', {
            type,
            originalName,
            newName: finalName,
          });
          break;

        case 'update':
          // Will update the existing component
          status = 'updated';
          logger.info('Updating existing component', { type, name: originalName });
          break;
      }
    }

    // Prepare component for import
    const preparedData = this.prepareForImport(type, data, finalName);

    try {
      if (exists && onConflict === 'update') {
        // Update existing component
        await this.ionClient.updateComponent(type, finalName, preparedData as IONComponentDetail);
        logger.info('Successfully updated component', { type, name: finalName });
      } else {
        // Create new component
        await this.ionClient.createComponent(type, preparedData as IONComponentDetail);
        logger.info('Successfully created component', { type, name: finalName });
      }

      return {
        originalName,
        finalName,
        type: this.getDisplayName(type),
        status,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to import component', { type, name: finalName, error: errorMessage });

      return {
        originalName,
        finalName,
        type: this.getDisplayName(type),
        status: 'failed',
        error: errorMessage,
      };
    }
  }

  /**
   * Exports components to GitHub
   * @param options - Export options
   * @returns Batch result with export details
   */
  public async exportToGitHub(options: ExportOptions): Promise<BatchResult<ExportResult>> {
    const { repo, branch, dryRun = false, force = false } = options;
    const types = options.types ?? Object.values(ComponentType);

    const results: { item: string; result: { success: boolean; data?: ExportResult; error?: { code: number; message: string; retryable: boolean } } }[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    // Pre-fetch the tree for SHA lookups (if not dry run)
    if (!dryRun) {
      try {
        await this.githubClient.getTree(repo, branch);
      } catch {
        // Tree might not exist yet (empty repo), that's ok
        logger.debug('Could not fetch tree, repository may be empty');
      }
    }

    for (const type of types) {
      const displayName = this.getDisplayName(type);
      logger.info(`Processing ${displayName}...`);

      // Get components of this type
      let components: IONComponent[];
      try {
        components = await this.listComponents(type);
      } catch (error) {
        logger.error(`Failed to list ${displayName}`, { error: String(error) });
        continue;
      }

      // Filter by specific items if provided
      if (options.items && options.items.length > 0) {
        const itemSet = new Set(options.items.map((i) => i.toLowerCase()));
        components = components.filter((c) => itemSet.has(c.name.toLowerCase()));
      }

      for (const component of components) {
        const path = this.getComponentPath(type, component.name);
        const itemKey = `${displayName}/${component.name}`;

        try {
          // Get full component details
          const json = await this.exportComponent(type, component.name);

          if (dryRun) {
            logger.info(`[DRY RUN] Would export: ${path}`);
            results.push({
              item: itemKey,
              result: {
                success: true,
                data: {
                  name: component.name,
                  type: displayName,
                  status: 'exported',
                },
              },
            });
            succeeded++;
            continue;
          }

          // Check if content has changed (unless force)
          if (!force) {
            try {
              const existingContent = await this.githubClient.getFileContent(repo, path, branch);
              const existingHash = computeHash(existingContent);
              const newHash = computeHash(json);

              if (existingHash === newHash) {
                logger.debug(`Skipping unchanged: ${path}`);
                results.push({
                  item: itemKey,
                  result: {
                    success: true,
                    data: {
                      name: component.name,
                      type: displayName,
                      status: 'skipped',
                    },
                  },
                });
                skipped++;
                continue;
              }
            } catch {
              // File doesn't exist yet, proceed with creation
            }
          }

          // Upload to GitHub
          const result = await this.githubClient.createOrUpdateFile(
            repo,
            path,
            json,
            `Export ${displayName}: ${component.name}`,
            branch
          );

          results.push({
            item: itemKey,
            result: {
              success: true,
              data: {
                name: component.name,
                type: displayName,
                status: 'exported',
                sha: result.content.sha,
              },
            },
          });
          succeeded++;
          logger.info(`Exported: ${path}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          results.push({
            item: itemKey,
            result: {
              success: false,
              data: {
                name: component.name,
                type: displayName,
                status: 'failed',
                error: errorMessage,
              },
              error: {
                code: 400,
                message: errorMessage,
                retryable: false,
              },
            },
          });
          failed++;
          logger.error(`Failed to export: ${path}`, { error: errorMessage });
        }
      }
    }

    return {
      total: results.length,
      succeeded,
      failed,
      skipped,
      results,
    };
  }

  /**
   * Imports components from GitHub to ION
   * @param options - Import options
   * @returns Batch result with import details
   */
  public async importFromGitHub(options: ImportOptions): Promise<BatchResult<ImportResult>> {
    const { repo, branch, dryRun = false, onConflict } = options;
    const types = options.types ?? IMPORT_ORDER;

    const results: { item: string; result: { success: boolean; data?: ImportResult; error?: { code: number; message: string; retryable: boolean } } }[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    // Fetch the tree to get available files
    let tree;
    try {
      tree = await this.githubClient.getTree(repo, branch);
    } catch (error) {
      logger.error('Failed to fetch repository tree', { error: String(error) });
      throw new Error(`Failed to fetch repository tree: ${error}`);
    }

    // Process in dependency order
    for (const type of types) {
      // Skip if not in requested types
      if (options.types && !options.types.includes(type)) {
        continue;
      }

      const displayName = this.getDisplayName(type);
      const folderPrefix = `${displayName}/`;

      logger.info(`Processing ${displayName}...`);

      // Find all JSON files in this component folder
      const componentFiles = tree.tree.filter(
        (entry) =>
          entry.type === 'blob' &&
          entry.path.startsWith(folderPrefix) &&
          entry.path.endsWith('.json')
      );

      for (const file of componentFiles) {
        // Extract component name from path
        const fileName = file.path.substring(folderPrefix.length);
        const componentName = fileName.substring(0, fileName.length - 5); // Remove .json
        const itemKey = `${displayName}/${componentName}`;

        // Filter by specific items if provided
        if (options.items && options.items.length > 0) {
          const itemSet = new Set(options.items.map((i) => i.toLowerCase()));
          if (!itemSet.has(componentName.toLowerCase())) {
            continue;
          }
        }

        try {
          // Fetch file content from GitHub
          const content = await this.githubClient.getFileContent(repo, file.path, branch);
          const data = JSON.parse(content) as IONComponentDetail;

          if (dryRun) {
            const exists = await this.componentExists(type, data.name);
            let previewStatus: ImportResult['status'] = 'created';

            if (exists) {
              switch (onConflict) {
                case 'skip':
                  previewStatus = 'skipped';
                  break;
                case 'fail':
                  previewStatus = 'failed';
                  break;
                case 'rename':
                  // Would be renamed
                  previewStatus = 'created';
                  break;
              }
            }

            logger.info(`[DRY RUN] Would import: ${file.path}`, {
              status: previewStatus,
              exists,
            });

            results.push({
              item: itemKey,
              result: {
                success: previewStatus !== 'failed',
                data: {
                  originalName: data.name,
                  finalName: data.name,
                  type: displayName,
                  status: previewStatus,
                },
              },
            });

            if (previewStatus === 'skipped') {
              skipped++;
            } else if (previewStatus === 'failed') {
              failed++;
            } else {
              succeeded++;
            }
            continue;
          }

          // Actually import the component
          const importResult = await this.importComponent(type, data, onConflict);

          results.push({
            item: itemKey,
            result: {
              success: importResult.status !== 'failed',
              data: importResult,
            },
          });

          switch (importResult.status) {
            case 'created':
            case 'updated':
              succeeded++;
              break;
            case 'skipped':
              skipped++;
              break;
            case 'failed':
              failed++;
              break;
          }

          logger.info(`Imported: ${file.path}`, { status: importResult.status });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          results.push({
            item: itemKey,
            result: {
              success: false,
              data: {
                originalName: componentName,
                finalName: componentName,
                type: displayName,
                status: 'failed',
                error: errorMessage,
              },
              error: {
                code: 401,
                message: errorMessage,
                retryable: false,
              },
            },
          });
          failed++;
          logger.error(`Failed to import: ${file.path}`, { error: errorMessage });
        }
      }
    }

    return {
      total: results.length,
      succeeded,
      failed,
      skipped,
      results,
    };
  }

  /**
   * Gets import order for component types
   * @returns Array of component types in dependency order
   */
  public getImportOrder(): ComponentType[] {
    return [...IMPORT_ORDER];
  }

  /**
   * Gets the approved version of a script
   * For export, we always want the approved version
   * @param name - Script name
   * @returns Approved script details
   */
  public async getApprovedScript(name: string): Promise<IONComponentDetail> {
    return this.ionClient.getApprovedScript(name);
  }

  /**
   * Approves a script after import
   * @param name - Script name to approve
   */
  public async approveScript(name: string): Promise<void> {
    await this.ionClient.approveScript(name);
    logger.info('Approved script', { name });
  }

  /**
   * Approves multiple scripts at once
   * @param names - Script names to approve
   */
  public async approveScripts(names: string[]): Promise<void> {
    if (names.length === 0) return;

    await this.ionClient.approveScripts(names);
    logger.info('Approved scripts', { count: names.length, names });
  }

  /**
   * Fetches component details, using approved version for scripts
   * @param type - Component type
   * @param name - Component name
   * @returns Component details
   */
  public async getComponentForExport(
    type: ComponentType,
    name: string
  ): Promise<IONComponentDetail> {
    // For scripts, get the approved version for export
    if (type === ComponentType.SCRIPTS) {
      try {
        return await this.getApprovedScript(name);
      } catch {
        // If no approved version exists, fall back to draft
        logger.warn('No approved version found for script, using draft', { name });
        return this.ionClient.getComponent(type, name);
      }
    }

    return this.ionClient.getComponent(type, name);
  }
}
