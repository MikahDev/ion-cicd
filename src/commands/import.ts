/**
 * Import Command
 * Imports ION components from GitHub repository
 */

import { IONClient } from '../clients/ion-client.js';
import { GitHubClient } from '../clients/github-client.js';
import { ComponentService, ImportOptions, ConflictResolution } from '../services/component-service.js';
import { IONApiConfig, ComponentType, COMPONENT_DISPLAY_NAMES, IMPORT_ORDER } from '../types/index.js';
import { CLIOutput, ImportResult, BatchResult } from '../types/result.js';
import { Logger } from '../utils/logger.js';
import {
  selectComponentTypes,
  selectComponents,
  confirmOperation,
  selectConflictResolution,
} from '../interactive/prompts.js';
import { ConfigLoader } from '../config/loader.js';

const logger = new Logger('ImportCommand');

/**
 * Import command options from CLI
 */
export interface ImportCommandOptions {
  /** Path to ionapi config file (optional if ion-cicd.config.json exists) */
  config?: string;
  /** Environment name (tst|trn|prd) */
  env?: string;
  /** Component type (optional) */
  type?: string;
  /** Comma-separated component names (optional) */
  items?: string;
  /** Import all components */
  all?: boolean;
  /** Use interactive selection */
  interactive?: boolean;
  /** Source GitHub repository (owner/repo format) */
  repo: string;
  /** Source branch */
  branch: string;
  /** Dry run - show what would be imported */
  dryRun?: boolean;
  /** Skip pre-import validation */
  skipValidation?: boolean;
  /** Conflict resolution strategy */
  onConflict: ConflictResolution;
  /** Output format */
  output: 'text' | 'json';
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
 * Loads ION API configuration from file
 * @param configPath - Path to .ionapi file
 * @returns IONApiConfig
 */
async function loadConfig(configPath?: string, env?: string): Promise<IONApiConfig> {
  const loader = new ConfigLoader();
  const resolved = await loader.resolve({
    configPath,
    env,
  });
  return resolved.ionApi;
}

/**
 * Formats the import result for text output
 * @param result - Batch result from import
 * @param dryRun - Whether this was a dry run
 * @returns Formatted string
 */
function formatTextOutput(result: BatchResult<ImportResult>, dryRun: boolean): string {
  const lines: string[] = [];

  if (dryRun) {
    lines.push('=== DRY RUN - No changes made ===\n');
  }

  lines.push(`Import Summary:`);
  lines.push(`  Total:   ${result.total}`);
  lines.push(`  Created: ${result.succeeded}`);
  lines.push(`  Skipped: ${result.skipped}`);
  lines.push(`  Failed:  ${result.failed}`);
  lines.push('');

  // Group results by type
  const byType = new Map<string, ImportResult[]>();
  for (const item of result.results) {
    if (item.result.data) {
      const type = item.result.data.type;
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push(item.result.data);
    }
  }

  // Output by type (in import order)
  const orderedTypes = IMPORT_ORDER.map((t) => COMPONENT_DISPLAY_NAMES[t]);
  for (const typeName of orderedTypes) {
    const items = byType.get(typeName);
    if (!items || items.length === 0) continue;

    lines.push(`${typeName}:`);
    for (const item of items) {
      let status: string;
      switch (item.status) {
        case 'created':
          status = '✓';
          break;
        case 'updated':
          status = '↑';
          break;
        case 'skipped':
          status = '○';
          break;
        case 'failed':
          status = '✗';
          break;
      }

      let name = item.originalName;
      if (item.finalName !== item.originalName) {
        name = `${item.originalName} → ${item.finalName}`;
      }

      const suffix = item.error ? ` (${item.error})` : '';
      lines.push(`  ${status} ${name}${suffix}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Formats the import result for JSON output
 * @param result - Batch result from import
 * @returns CLIOutput object
 */
function formatJsonOutput(result: BatchResult<ImportResult>): CLIOutput {
  const components = result.results
    .filter((r) => r.result.data)
    .map((r) => r.result.data!);

  const errors = result.results
    .filter((r) => r.result.error)
    .map((r) => r.result.error!.message);

  return {
    success: result.failed === 0,
    operation: 'import',
    timestamp: new Date().toISOString(),
    summary: {
      imported: result.succeeded,
      skipped: result.skipped,
      failed: result.failed,
    },
    components,
    errors,
  };
}

/**
 * Lists available components from GitHub repository
 * @param githubClient - GitHub client
 * @param repo - Repository name
 * @param branch - Branch name
 * @returns Map of component type display names to component names
 */
async function listAvailableComponents(
  githubClient: GitHubClient,
  repo: string,
  branch: string
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();

  const folders = await githubClient.getComponentFolders(repo, branch);

  for (const folder of folders) {
    const files = await githubClient.listComponentFiles(repo, branch, folder);
    if (files.length > 0) {
      result.set(folder, files);
    }
  }

  return result;
}

/**
 * Maps display names to component types for selection
 * @param displayNames - Array of display names
 * @returns Array of component types
 */
function mapDisplayNamesToTypes(displayNames: string[]): ComponentType[] {
  const displayToType: Record<string, ComponentType> = {};
  for (const [type, name] of Object.entries(COMPONENT_DISPLAY_NAMES)) {
    displayToType[name] = type as ComponentType;
  }

  return displayNames
    .map((name) => displayToType[name])
    .filter((t): t is ComponentType => t !== undefined);
}

/**
 * Executes the import command
 * @param options - Command options
 */
export async function executeImport(options: ImportCommandOptions): Promise<void> {
  logger.info('Starting import', {
    repo: options.repo,
    branch: options.branch,
    dryRun: options.dryRun ?? false,
    onConflict: options.onConflict,
  });

  // Load ION config
  let ionConfig: IONApiConfig;
  try {
    ionConfig = await loadConfig(options.config, options.env);
  } catch (error) {
    logger.error('Failed to load config', { path: options.config, error: String(error) });
    throw new Error(`Failed to load ION config from ${options.config}: ${error}`);
  }

  // Parse repository
  const [owner, repoName] = options.repo.split('/');
  if (!owner || !repoName) {
    throw new Error('Repository must be in "owner/repo" format');
  }

  // Create clients
  const ionClient = new IONClient(ionConfig);
  await ionClient.authenticate();

  const githubClient = new GitHubClient(ionClient, { owner, repo: repoName });

  // Create service
  const service = new ComponentService(ionClient, githubClient);

  // Determine which types and items to import
  let types: ComponentType[] | undefined;
  let items: string[] | undefined;
  let onConflict = options.onConflict;

  if (options.interactive) {
    // Interactive mode - let user select from available components in repo
    const availableComponents = await listAvailableComponents(githubClient, repoName, options.branch);

    if (availableComponents.size === 0) {
      logger.warn('No components found in repository');
      // eslint-disable-next-line no-console
      console.log('No ION components found in the repository.');
      return;
    }

    // Select types first (show only types with components)
    const availableTypeNames = Array.from(availableComponents.keys());
    const availableTypes = mapDisplayNamesToTypes(availableTypeNames);

    const selectedTypes = await selectComponentTypes(availableTypes);
    types = selectedTypes;

    // For each type, let user select specific components
    const selectedItems: string[] = [];
    for (const type of selectedTypes) {
      const displayName = COMPONENT_DISPLAY_NAMES[type];
      const components = availableComponents.get(displayName) ?? [];
      if (components.length > 0) {
        const selected = await selectComponents(displayName, components);
        selectedItems.push(...selected);
      }
    }

    if (selectedItems.length > 0) {
      items = selectedItems;
    }

    // Ask about conflict resolution
    onConflict = await selectConflictResolution();

    // Confirm operation
    const confirmed = await confirmOperation(
      `Import ${items?.length ?? 'all'} components from ${options.repo}?`,
      options.dryRun ?? false
    );

    if (!confirmed) {
      logger.info('Import cancelled by user');
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

  // Build import options
  const importOptions: ImportOptions = {
    types,
    items,
    repo: repoName,
    branch: options.branch,
    dryRun: options.dryRun,
    onConflict,
  };

  // Execute import
  const result = await service.importFromGitHub(importOptions);

  // Output results
  if (options.output === 'json') {
    const output = formatJsonOutput(result);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(output, null, 2));
  } else {
    const output = formatTextOutput(result, options.dryRun ?? false);
    // eslint-disable-next-line no-console
    console.log(output);
  }

  // Exit with error code if there were failures
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}
