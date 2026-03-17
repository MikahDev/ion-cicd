/**
 * Export Command
 * Exports ION components to GitHub repository or local folder
 */

import { mkdir, writeFile, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { IONClient } from '../clients/ion-client.js';
import { GitHubClient } from '../clients/github-client.js';
import { ComponentService, ExportOptions } from '../services/component-service.js';
import { ComponentType, COMPONENT_DISPLAY_NAMES, ScriptComponent, BODSchemaComponent, LibraryComponent } from '../types/index.js';
import { CLIOutput, ExportResult, BatchResult } from '../types/result.js';
import { Logger } from '../utils/logger.js';
import { selectComponentTypes, selectComponents, confirmOperation } from '../interactive/prompts.js';
import { ConfigLoader, ResolvedConfig } from '../config/loader.js';
import { htmlToMarkdown } from '../utils/markdown.js';

const logger = new Logger('ExportCommand');

/**
 * Exports a script in developer-friendly format:
 * - scriptName.py - The Python code (with proper line endings)
 * - scriptName.meta.json - Metadata (variables, libraries, etc.)
 *
 * @param script - Script component data
 * @param typeFolder - Folder to write files to
 * @param dryRun - Whether this is a dry run
 */
async function exportScriptFiles(
  script: ScriptComponent,
  typeFolder: string,
  dryRun: boolean
): Promise<void> {
  const pyFilePath = join(typeFolder, `${script.name}.py`);
  const metaFilePath = join(typeFolder, `${script.name}.meta.json`);
  const mdFilePath = join(typeFolder, `${script.name}.md`);

  // Extract Python code and normalize line endings
  const pythonCode = (script.scriptCode || '')
    .replace(/\r\n/g, '\n')  // Windows -> Unix
    .replace(/\r/g, '\n');   // Old Mac -> Unix

  // Create metadata without the scriptCode and documentation
  // Documentation is stored separately in .md file
  const metadata = {
    name: script.name,
    description: script.description || '',
    versionNumber: script.versionNumber,
    status: script.status,
    inputVariables: script.inputVariables || [],
    outputVariables: script.outputVariables || [],
    usedLibraries: script.usedLibraries || [],
  };

  // Convert HTML documentation to Markdown
  const documentation = script.documentation || '';
  const markdownDoc = htmlToMarkdown(documentation);

  if (!dryRun) {
    // Write Python file
    await writeFile(pyFilePath, pythonCode, 'utf-8');
    // Write metadata JSON (without documentation)
    await writeFile(metaFilePath, JSON.stringify(metadata, null, 2), 'utf-8');
    // Write Markdown documentation file if there is documentation
    if (markdownDoc) {
      await writeFile(mdFilePath, markdownDoc, 'utf-8');
    }
  }
}

/**
 * Exports a BOD schema in developer-friendly format:
 * - BODName.xsd - The XSD schema
 * - BODName.xml - The XML metadata
 *
 * @param bodSchema - BOD schema component data
 * @param typeFolder - Folder to write files to
 * @param dryRun - Whether this is a dry run
 */
async function exportBODSchemaFiles(
  bodSchema: BODSchemaComponent,
  typeFolder: string,
  dryRun: boolean
): Promise<void> {
  const xsdFilePath = join(typeFolder, `${bodSchema.name}.xsd`);
  const xmlFilePath = join(typeFolder, `${bodSchema.name}.xml`);

  if (!dryRun) {
    // Write XSD schema file
    if (bodSchema.nounSchemaXsd) {
      await writeFile(xsdFilePath, bodSchema.nounSchemaXsd, 'utf-8');
    }
    // Write XML metadata file
    if (bodSchema.nounMetadataXml) {
      await writeFile(xmlFilePath, bodSchema.nounMetadataXml, 'utf-8');
    }
  }
}

/**
 * Exports a library in developer-friendly format:
 * - libraryName.py - The extracted Python source code (editable)
 * - libraryName.meta.json - Metadata (name, version, description, etc.)
 *
 * The wheel is rebuilt from source on deploy, so we don't need to store it.
 *
 * @param library - Library component data
 * @param typeFolder - Folder to write files to
 * @param dryRun - Whether this is a dry run
 */
async function exportLibraryFiles(
  library: LibraryComponent,
  typeFolder: string,
  dryRun: boolean
): Promise<void> {
  const pyFilePath = join(typeFolder, `${library.name}.py`);
  const metaFilePath = join(typeFolder, `${library.name}.meta.json`);

  // Decode base64 to binary wheel
  const whlBinary = library.file ? Buffer.from(library.file, 'base64') : Buffer.alloc(0);

  // Extract Python source code from the wheel (which is a ZIP file)
  let pythonSource = '';
  if (whlBinary.length > 0) {
    try {
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(whlBinary);
      const entries = zip.getEntries();

      // Look for the main .py file (same name as library)
      const mainPyFile = entries.find(e =>
        e.entryName === `${library.name}.py` ||
        e.entryName.endsWith(`/${library.name}.py`)
      );

      if (mainPyFile) {
        pythonSource = mainPyFile.getData().toString('utf-8');
      } else {
        // Fall back to any .py file that's not in dist-info
        const anyPyFile = entries.find(e =>
          e.entryName.endsWith('.py') && !e.entryName.includes('dist-info')
        );
        if (anyPyFile) {
          pythonSource = anyPyFile.getData().toString('utf-8');
        }
      }
    } catch {
      logger.warn('Could not extract Python source from wheel', { name: library.name });
    }
  }

  // Create metadata without the file content
  const metadata = {
    name: library.name,
    description: library.description || '',
    version: library.version || '',
    fileName: library.fileName || `${library.name}.whl`,
    libraryInformation: (library as Record<string, unknown>).libraryInformation || {},
  };

  if (!dryRun) {
    // Write extracted Python source (editable)
    if (pythonSource) {
      await writeFile(pyFilePath, pythonSource, 'utf-8');
    }
    // Write metadata JSON
    await writeFile(metaFilePath, JSON.stringify(metadata, null, 2), 'utf-8');
  }
}

/**
 * Export command options from CLI
 */
export interface ExportCommandOptions {
  /** Path to ionapi config file (optional if ion-cicd.config.json exists) */
  config?: string;
  /** Environment name (tst|trn|prd) */
  env?: string;
  /** Component type (optional) */
  type?: string;
  /** Comma-separated component names (optional) */
  items?: string;
  /** Export all components */
  all?: boolean;
  /** Use interactive selection */
  interactive?: boolean;
  /** Target GitHub repository (owner/repo format) */
  repo: string;
  /** Target branch */
  branch: string;
  /** Dry run - show what would be exported */
  dryRun?: boolean;
  /** Force export even if unchanged */
  force?: boolean;
  /** Output format */
  output: 'text' | 'json';
  /** Export to local ion-components folder instead of GitHub */
  local?: boolean;
  /** Prune local files that no longer exist in ION (only with --local) */
  prune?: boolean;
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
 * Result from local export including exported component names
 */
interface LocalExportResult {
  batchResult: BatchResult<ExportResult>;
  exportedComponents: Map<ComponentType, Set<string>>;
}

/**
 * Prunes orphaned files from local ion-components folder
 * Removes files that no longer exist in ION
 *
 * @param componentsPath - Path to ion-components folder
 * @param exportedComponents - Map of component types to exported component names
 * @param dryRun - Whether this is a dry run
 * @returns Array of deleted file paths
 */
async function pruneOrphanedFiles(
  componentsPath: string,
  exportedComponents: Map<ComponentType, Set<string>>,
  dryRun: boolean
): Promise<string[]> {
  const prunedFiles: string[] = [];

  // Iterate through each type folder
  for (const [displayName, type] of Object.entries(DISPLAY_NAME_TO_TYPE)) {
    const typeFolder = join(componentsPath, displayName);

    if (!existsSync(typeFolder)) {
      continue;
    }

    const files = await readdir(typeFolder);
    const exportedNames = exportedComponents.get(type) || new Set<string>();

    for (const file of files) {
      // Skip .gitkeep
      if (file === '.gitkeep') {
        continue;
      }

      let componentName: string;
      let filesToDelete: string[] = [];

      if (type === ComponentType.SCRIPTS) {
        // Scripts: check .py files
        if (file.endsWith('.py')) {
          componentName = basename(file, '.py');
          const metaFile = `${componentName}.meta.json`;
          const mdFile = `${componentName}.md`;

          if (!exportedNames.has(componentName)) {
            filesToDelete = [file];
            // Also delete the meta file if it exists
            if (files.includes(metaFile)) {
              filesToDelete.push(metaFile);
            }
            // Also delete the .md documentation file if it exists
            if (files.includes(mdFile)) {
              filesToDelete.push(mdFile);
            }
          }
        } else if (file.endsWith('.meta.json') || file.endsWith('.md')) {
          // Skip .meta.json and .md files - they're handled with .py files
          continue;
        } else {
          continue;
        }
      } else if (type === ComponentType.BOD_SCHEMAS) {
        // BOD Schemas: check .xsd files (primary), also delete .xml
        if (file.endsWith('.xsd')) {
          componentName = basename(file, '.xsd');
          const xmlFile = `${componentName}.xml`;

          if (!exportedNames.has(componentName)) {
            filesToDelete = [file];
            // Also delete the XML metadata file if it exists
            if (files.includes(xmlFile)) {
              filesToDelete.push(xmlFile);
            }
          }
        } else if (file.endsWith('.xml')) {
          // Skip .xml files - they're handled with .xsd files
          continue;
        } else {
          continue;
        }
      } else if (type === ComponentType.LIBRARIES) {
        // Libraries: check .py files (primary), also delete .meta.json
        // Also handle legacy .json and .whl files
        if (file.endsWith('.py')) {
          componentName = basename(file, '.py');
          const metaFile = `${componentName}.meta.json`;
          const legacyJsonFile = `${componentName}.json`;
          const legacyWhlFile = `${componentName}.whl`;

          if (!exportedNames.has(componentName)) {
            filesToDelete = [file];
            // Also delete the meta file if it exists
            if (files.includes(metaFile)) {
              filesToDelete.push(metaFile);
            }
            // Also delete legacy files if they exist
            if (files.includes(legacyJsonFile)) {
              filesToDelete.push(legacyJsonFile);
            }
            if (files.includes(legacyWhlFile)) {
              filesToDelete.push(legacyWhlFile);
            }
          }
        } else if (file.endsWith('.meta.json')) {
          // Skip .meta.json files - they're handled with .py files
          continue;
        } else if (file.endsWith('.json') || file.endsWith('.whl')) {
          // Legacy formats: standalone .json or .whl files
          const ext = file.endsWith('.json') ? '.json' : '.whl';
          componentName = basename(file, ext);
          // Only delete if not already handled by .py file
          if (!exportedNames.has(componentName) && !files.includes(`${componentName}.py`)) {
            filesToDelete = [file];
          }
        } else {
          continue;
        }
      } else {
        // Other components: check .json files
        if (!file.endsWith('.json')) {
          continue;
        }
        componentName = basename(file, '.json');

        if (!exportedNames.has(componentName)) {
          filesToDelete = [file];
        }
      }

      // Delete orphaned files
      for (const fileToDelete of filesToDelete) {
        const filePath = join(typeFolder, fileToDelete);
        const relativePath = `${displayName}/${fileToDelete}`;

        if (dryRun) {
          logger.info(`[DRY RUN] Would prune: ${relativePath}`);
        } else {
          await unlink(filePath);
          logger.info(`Pruned: ${relativePath}`);
        }
        prunedFiles.push(relativePath);
      }
    }
  }

  return prunedFiles;
}

/**
 * Parses component type from string
 * @param typeStr - Component type string
 * @returns ComponentType or undefined
 */
function parseComponentType(typeStr: string): ComponentType | undefined {
  const normalised = typeStr.toLowerCase();
  return Object.values(ComponentType).find((t) => t === normalised);
}

/**
 * Loads configuration using ConfigLoader
 * @param configPath - Optional path to config file
 * @returns ResolvedConfig
 */
async function loadConfig(configPath?: string, env?: string): Promise<ResolvedConfig> {
  const loader = new ConfigLoader();
  return loader.resolve({
    configPath,
    env,
  });
}

/**
 * Exports components to local ion-components folder
 * @param ionClient - Authenticated ION client
 * @param componentsPath - Path to ion-components folder
 * @param types - Component types to export
 * @param items - Specific items to export
 * @param dryRun - Whether this is a dry run
 * @returns Local export result with batch result and exported component names
 */
async function exportToLocal(
  ionClient: IONClient,
  componentsPath: string,
  types: ComponentType[] | undefined,
  items: string[] | undefined,
  dryRun: boolean
): Promise<LocalExportResult> {
  const exportTypes = types ?? Object.values(ComponentType);
  const results: {
    item: string;
    result: {
      success: boolean;
      data?: ExportResult;
      error?: { code: number; message: string; retryable: boolean };
    };
  }[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  // Track exported component names for pruning
  const exportedComponents = new Map<ComponentType, Set<string>>();

  for (const type of exportTypes) {
    // Initialize set for this type
    if (!exportedComponents.has(type)) {
      exportedComponents.set(type, new Set());
    }
    const displayName = COMPONENT_DISPLAY_NAMES[type];
    logger.info(`Processing ${displayName}...`);

    // Get components of this type
    let components;
    try {
      components = await ionClient.listComponents(type);
    } catch (error) {
      logger.error(`Failed to list ${displayName}`, { error: String(error) });
      continue;
    }

    // Filter by specific items if provided
    if (items && items.length > 0) {
      const itemSet = new Set(items.map((i) => i.toLowerCase()));
      components = components.filter((c) => itemSet.has(c.name.toLowerCase()));
    }

    // Create type folder if needed
    const typeFolder = join(componentsPath, displayName);
    if (!dryRun && !existsSync(typeFolder)) {
      await mkdir(typeFolder, { recursive: true });
    }

    for (const component of components) {
      const itemKey = `${displayName}/${component.name}`;
      const filePath = join(typeFolder, `${component.name}.json`);

      try {
        // Get full component details (approved version for scripts)
        let detail;
        if (type === ComponentType.SCRIPTS) {
          try {
            detail = await ionClient.getApprovedScript(component.name);
          } catch {
            // Fall back to draft if no approved version
            logger.warn('No approved version for script, using draft', { name: component.name });
            detail = await ionClient.getComponent(type, component.name);
          }
        } else {
          detail = await ionClient.getComponent(type, component.name);
        }

        if (dryRun) {
          logger.info(`[DRY RUN] Would export: ${itemKey}`);
          // Track component name even during dry run
          exportedComponents.get(type)!.add(component.name);
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

        // Scripts get special treatment: .py + .meta.json files
        if (type === ComponentType.SCRIPTS) {
          await exportScriptFiles(detail as ScriptComponent, typeFolder, dryRun);
          logger.info(`Exported: ${itemKey} (.py + .meta.json)`);
        } else if (type === ComponentType.BOD_SCHEMAS) {
          // BOD Schemas: .xsd + .xml files
          await exportBODSchemaFiles(detail as BODSchemaComponent, typeFolder, dryRun);
          logger.info(`Exported: ${itemKey} (.xsd + .xml)`);
        } else if (type === ComponentType.LIBRARIES) {
          // Libraries: .py (binary) + .meta.json files
          await exportLibraryFiles(detail as LibraryComponent, typeFolder, dryRun);
          logger.info(`Exported: ${itemKey} (.py + .meta.json)`);
        } else {
          // Write standard JSON for other component types
          const json = JSON.stringify(detail, null, 2);
          await writeFile(filePath, json, 'utf-8');
          logger.info(`Exported: ${itemKey}`);
        }

        // Track successfully exported component name
        exportedComponents.get(type)!.add(component.name);

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
        logger.error(`Failed to export: ${itemKey}`, { error: errorMessage });
      }
    }
  }

  return {
    batchResult: {
      total: results.length,
      succeeded,
      failed,
      skipped,
      results,
    },
    exportedComponents,
  };
}

/**
 * Formats the export result for text output
 * @param result - Batch result from export
 * @param dryRun - Whether this was a dry run
 * @returns Formatted string
 */
function formatTextOutput(result: BatchResult<ExportResult>, dryRun: boolean): string {
  const lines: string[] = [];

  if (dryRun) {
    lines.push('=== DRY RUN - No changes made ===\n');
  }

  lines.push(`Export Summary:`);
  lines.push(`  Total:    ${result.total}`);
  lines.push(`  Exported: ${result.succeeded}`);
  lines.push(`  Skipped:  ${result.skipped}`);
  lines.push(`  Failed:   ${result.failed}`);
  lines.push('');

  // Group results by type
  const byType = new Map<string, ExportResult[]>();
  for (const item of result.results) {
    if (item.result.data) {
      const type = item.result.data.type;
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push(item.result.data);
    }
  }

  // Output by type
  for (const [type, items] of byType) {
    lines.push(`${type}:`);
    for (const item of items) {
      const status = item.status === 'exported' ? '✓' : item.status === 'skipped' ? '○' : '✗';
      const suffix = item.error ? ` (${item.error})` : '';
      lines.push(`  ${status} ${item.name}${suffix}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Formats the export result for JSON output
 * @param result - Batch result from export
 * @returns CLIOutput object
 */
function formatJsonOutput(result: BatchResult<ExportResult>): CLIOutput {
  const components = result.results
    .filter((r) => r.result.data)
    .map((r) => r.result.data!);

  const errors = result.results
    .filter((r) => r.result.error)
    .map((r) => r.result.error!.message);

  return {
    success: result.failed === 0,
    operation: 'export',
    timestamp: new Date().toISOString(),
    summary: {
      exported: result.succeeded,
      skipped: result.skipped,
      failed: result.failed,
    },
    components,
    errors,
  };
}

/**
 * Executes the export command
 * @param options - Command options
 */
export async function executeExport(options: ExportCommandOptions): Promise<void> {
  logger.info('Starting export', {
    repo: options.repo,
    branch: options.branch,
    local: options.local ?? false,
    dryRun: options.dryRun ?? false,
  });

  // Load configuration
  let resolved: ResolvedConfig;
  try {
    resolved = await loadConfig(options.config, options.env);
  } catch (error) {
    logger.error('Failed to load config', { path: options.config, error: String(error) });
    throw new Error(`Failed to load config from ${options.config}: ${error}`);
  }

  // Create ION client
  const ionClient = new IONClient(resolved.ionApi);
  await ionClient.authenticate();

  // For local export, we don't need GitHub client
  let service: ComponentService | null = null;
  if (!options.local) {
    // Parse repository
    const [owner, repoName] = options.repo.split('/');
    if (!owner || !repoName) {
      throw new Error('Repository must be in "owner/repo" format');
    }

    const githubClient = new GitHubClient(ionClient, { owner, repo: repoName });
    service = new ComponentService(ionClient, githubClient);
  }

  // Determine which types to export
  let types: ComponentType[] | undefined;
  let items: string[] | undefined;

  if (options.interactive && service) {
    // Interactive mode - let user select types and components (only for GitHub export)
    const allComponents = await service.listAllComponents();

    // Select types first
    const availableTypes = Array.from(allComponents.keys()).filter(
      (type) => allComponents.get(type)!.length > 0
    );

    const selectedTypes = await selectComponentTypes(availableTypes);
    types = selectedTypes;

    // For each type, let user select specific components
    const selectedItems: string[] = [];
    for (const type of selectedTypes) {
      const components = allComponents.get(type) ?? [];
      if (components.length > 0) {
        const selected = await selectComponents(
          COMPONENT_DISPLAY_NAMES[type],
          components.map((c) => c.name)
        );
        selectedItems.push(...selected);
      }
    }

    if (selectedItems.length > 0) {
      items = selectedItems;
    }

    // Confirm operation
    const confirmed = await confirmOperation(
      `Export ${items?.length ?? 'all'} components to ${options.repo}?`,
      options.dryRun ?? false
    );

    if (!confirmed) {
      logger.info('Export cancelled by user');
      return;
    }
  } else if (options.type) {
    // Single type specified
    const parsedType = parseComponentType(options.type);
    if (!parsedType) {
      throw new Error(
        `Invalid component type: ${options.type}. Valid types: ${Object.values(ComponentType).join(', ')}`
      );
    }
    types = [parsedType];
  } else if (!options.all) {
    throw new Error('Specify --all, --type, or --interactive');
  }

  // Parse items if provided
  if (options.items) {
    items = options.items.split(',').map((i) => i.trim());
  }

  let result: BatchResult<ExportResult>;
  let prunedFiles: string[] = [];

  if (options.local) {
    // Export to local ion-components folder
    const componentsPath = resolved.componentsPath;
    // eslint-disable-next-line no-console
    console.log(`\nExporting to: ${componentsPath}\n`);
    const localResult = await exportToLocal(
      ionClient,
      componentsPath,
      types,
      items,
      options.dryRun ?? false
    );
    result = localResult.batchResult;

    // Prune orphaned files if requested
    if (options.prune) {
      // eslint-disable-next-line no-console
      console.log(`\nPruning orphaned files...\n`);
      prunedFiles = await pruneOrphanedFiles(
        componentsPath,
        localResult.exportedComponents,
        options.dryRun ?? false
      );
    }
  } else {
    // Export to GitHub
    if (!service) {
      throw new Error('Service not initialized for GitHub export');
    }

    const [, repoName] = options.repo.split('/');
    const exportOptions: ExportOptions = {
      types,
      items,
      repo: repoName,
      branch: options.branch,
      dryRun: options.dryRun,
      force: options.force,
    };

    result = await service.exportToGitHub(exportOptions);
  }

  // Output results
  if (options.output === 'json') {
    const output = formatJsonOutput(result);
    if (prunedFiles.length > 0) {
      output.pruned = prunedFiles;
      output.summary = { ...output.summary, pruned: prunedFiles.length };
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(output, null, 2));
  } else {
    let output = formatTextOutput(result, options.dryRun ?? false);
    if (prunedFiles.length > 0) {
      output += `\nPruned: ${prunedFiles.length} orphaned file(s)\n`;
      for (const file of prunedFiles) {
        output += `  ✗ ${file}\n`;
      }
    } else if (options.prune) {
      output += `\nNo orphaned files to prune.\n`;
    }
    // eslint-disable-next-line no-console
    console.log(output);
  }

  // Exit with error code if there were failures
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}
