/**
 * Sync Command
 * Bidirectional synchronisation between ION and GitHub
 */

import { IONClient } from '../clients/ion-client.js';
import { GitHubClient } from '../clients/github-client.js';
import { ComponentService, ConflictResolution } from '../services/component-service.js';
import { IONApiConfig, ComponentType, IMPORT_ORDER } from '../types/index.js';
import { CLIOutput, ExportResult, ImportResult, BatchResult } from '../types/result.js';
import { Logger } from '../utils/logger.js';
import { computeHash } from '../utils/crypto.js';
import { confirmOperation } from '../interactive/prompts.js';
import { ConfigLoader } from '../config/loader.js';

const logger = new Logger('SyncCommand');

/**
 * Sync direction options
 */
export type SyncDirection = 'export' | 'import' | 'both';

/**
 * Sync command options from CLI
 */
export interface SyncCommandOptions {
  /** Path to ionapi config file (optional if ion-cicd.config.json exists) */
  config?: string;
  /** Environment name (tst|trn|prd) */
  env?: string;
  /** Sync direction */
  direction: SyncDirection;
  /** GitHub repository (owner/repo format) */
  repo: string;
  /** Branch name */
  branch: string;
  /** Dry run - show what would change */
  dryRun?: boolean;
  /** Force sync - skip change detection */
  force?: boolean;
  /** How to handle import conflicts */
  onConflict?: ConflictResolution;
  /** Output format */
  output: 'text' | 'json';
  /** Interactive mode */
  interactive?: boolean;
}

/**
 * Represents a component's sync status
 */
interface ComponentSyncStatus {
  name: string;
  type: ComponentType;
  displayType: string;
  /** Where the component exists */
  location: 'ion-only' | 'github-only' | 'both';
  /** If both, whether content matches */
  synced?: boolean;
  /** ION content hash */
  ionHash?: string;
  /** GitHub content hash */
  githubHash?: string;
}

/**
 * Sync operation result
 */
interface SyncResult {
  exported: BatchResult<ExportResult>;
  imported: BatchResult<ImportResult>;
}

/**
 * Summary of sync analysis
 */
interface SyncAnalysis {
  /** Components only in ION (export candidates) */
  ionOnly: ComponentSyncStatus[];
  /** Components only in GitHub (import candidates) */
  githubOnly: ComponentSyncStatus[];
  /** Components in both but different (update candidates) */
  modified: ComponentSyncStatus[];
  /** Components in both and identical */
  synced: ComponentSyncStatus[];
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
 * Analyses the sync status of all components
 * @param service - Component service
 * @param githubClient - GitHub client
 * @param repo - Repository name
 * @param branch - Branch name
 * @returns Sync analysis
 */
async function analyseSyncStatus(
  service: ComponentService,
  githubClient: GitHubClient,
  repo: string,
  branch: string
): Promise<SyncAnalysis> {
  const analysis: SyncAnalysis = {
    ionOnly: [],
    githubOnly: [],
    modified: [],
    synced: [],
  };

  // Get tree from GitHub (may be empty for new repos)
  let tree;
  try {
    tree = await githubClient.getTree(repo, branch);
  } catch {
    // Repository might be empty
    logger.debug('Could not fetch tree, repository may be empty');
    tree = { tree: [], sha: '', url: '', truncated: false };
  }

  // Build a map of GitHub components
  const githubComponents = new Map<string, { path: string; sha: string }>();
  for (const entry of tree.tree) {
    if (entry.type === 'blob' && entry.path.endsWith('.json')) {
      // Extract type and name from path (e.g., "Document flow/MyFlow.json")
      const parts = entry.path.split('/');
      if (parts.length === 2) {
        const folderName = parts[0];
        const fileName = parts[1].replace('.json', '');
        const type = service.getTypeFromDisplayName(folderName);
        if (type) {
          const key = `${type}:${fileName}`;
          githubComponents.set(key, { path: entry.path, sha: entry.sha });
        }
      }
    }
  }

  // Compare with ION components
  for (const type of Object.values(ComponentType)) {
    const displayName = service.getDisplayName(type);
    logger.debug(`Analysing ${displayName}...`);

    let ionComponents;
    try {
      ionComponents = await service.listComponents(type);
    } catch (error) {
      logger.warn(`Failed to list ${displayName}`, { error: String(error) });
      continue;
    }

    for (const ionComponent of ionComponents) {
      const key = `${type}:${ionComponent.name}`;
      const githubEntry = githubComponents.get(key);

      if (!githubEntry) {
        // Only in ION
        analysis.ionOnly.push({
          name: ionComponent.name,
          type,
          displayType: displayName,
          location: 'ion-only',
        });
      } else {
        // In both - compare content
        try {
          const ionJson = await service.exportComponent(type, ionComponent.name);
          const ionHash = computeHash(ionJson);

          const githubContent = await githubClient.getFileContent(repo, githubEntry.path, branch);
          const githubHash = computeHash(githubContent);

          const status: ComponentSyncStatus = {
            name: ionComponent.name,
            type,
            displayType: displayName,
            location: 'both',
            synced: ionHash === githubHash,
            ionHash,
            githubHash,
          };

          if (status.synced) {
            analysis.synced.push(status);
          } else {
            analysis.modified.push(status);
          }
        } catch (error) {
          logger.warn(`Failed to compare ${ionComponent.name}`, { error: String(error) });
        }

        // Remove from GitHub map to track what's only in GitHub
        githubComponents.delete(key);
      }
    }
  }

  // Remaining GitHub components are only in GitHub
  for (const [key] of githubComponents) {
    const [typeStr, name] = key.split(':');
    const type = typeStr as ComponentType;
    const displayName = service.getDisplayName(type);

    analysis.githubOnly.push({
      name,
      type,
      displayType: displayName,
      location: 'github-only',
    });
  }

  return analysis;
}

/**
 * Formats the sync analysis for text output
 * @param analysis - Sync analysis
 * @param direction - Sync direction
 * @returns Formatted string
 */
function formatAnalysisText(analysis: SyncAnalysis, direction: SyncDirection): string {
  const lines: string[] = [];

  lines.push('=== Sync Analysis ===\n');

  // Show what will be exported
  if (direction === 'export' || direction === 'both') {
    lines.push(`Components to export (ION → GitHub):`);
    if (analysis.ionOnly.length === 0 && (direction === 'export' ? true : analysis.modified.length === 0)) {
      lines.push('  (none)');
    } else {
      for (const item of analysis.ionOnly) {
        lines.push(`  + ${item.displayType}/${item.name} (new)`);
      }
      if (direction === 'both') {
        for (const item of analysis.modified) {
          lines.push(`  ~ ${item.displayType}/${item.name} (modified)`);
        }
      }
    }
    lines.push('');
  }

  // Show what will be imported
  if (direction === 'import' || direction === 'both') {
    lines.push(`Components to import (GitHub → ION):`);
    if (analysis.githubOnly.length === 0) {
      lines.push('  (none)');
    } else {
      for (const item of analysis.githubOnly) {
        lines.push(`  + ${item.displayType}/${item.name} (new)`);
      }
    }
    lines.push('');
  }

  // Summary
  lines.push(`Summary:`);
  lines.push(`  In sync:       ${analysis.synced.length}`);
  lines.push(`  ION only:      ${analysis.ionOnly.length}`);
  lines.push(`  GitHub only:   ${analysis.githubOnly.length}`);
  lines.push(`  Modified:      ${analysis.modified.length}`);

  return lines.join('\n');
}

/**
 * Formats the sync result for text output
 * @param result - Sync result
 * @param dryRun - Whether this was a dry run
 * @returns Formatted string
 */
function formatResultText(result: SyncResult, dryRun: boolean): string {
  const lines: string[] = [];

  if (dryRun) {
    lines.push('=== DRY RUN - No changes made ===\n');
  }

  lines.push('=== Sync Complete ===\n');

  // Export summary
  if (result.exported.total > 0) {
    lines.push(`Export Results:`);
    lines.push(`  Exported: ${result.exported.succeeded}`);
    lines.push(`  Skipped:  ${result.exported.skipped}`);
    lines.push(`  Failed:   ${result.exported.failed}`);
    lines.push('');
  }

  // Import summary
  if (result.imported.total > 0) {
    lines.push(`Import Results:`);
    lines.push(`  Imported: ${result.imported.succeeded}`);
    lines.push(`  Skipped:  ${result.imported.skipped}`);
    lines.push(`  Failed:   ${result.imported.failed}`);
    lines.push('');
  }

  // Total
  const totalSuccess = result.exported.succeeded + result.imported.succeeded;
  const totalFailed = result.exported.failed + result.imported.failed;
  lines.push(`Total: ${totalSuccess} succeeded, ${totalFailed} failed`);

  return lines.join('\n');
}

/**
 * Formats the sync result for JSON output
 * @param result - Sync result
 * @returns CLIOutput object
 */
function formatJsonOutput(result: SyncResult): CLIOutput {
  const exportComponents = result.exported.results
    .filter((r) => r.result.data)
    .map((r) => r.result.data!);

  const importComponents = result.imported.results
    .filter((r) => r.result.data)
    .map((r) => r.result.data!);

  const allErrors = [
    ...result.exported.results.filter((r) => r.result.error).map((r) => r.result.error!.message),
    ...result.imported.results.filter((r) => r.result.error).map((r) => r.result.error!.message),
  ];

  return {
    success: result.exported.failed === 0 && result.imported.failed === 0,
    operation: 'sync',
    timestamp: new Date().toISOString(),
    summary: {
      exported: result.exported.succeeded,
      imported: result.imported.succeeded,
      skipped: result.exported.skipped + result.imported.skipped,
      failed: result.exported.failed + result.imported.failed,
    },
    components: [...exportComponents, ...importComponents],
    errors: allErrors,
  };
}

/**
 * Executes the sync command
 * @param options - Command options
 */
export async function executeSync(options: SyncCommandOptions): Promise<void> {
  logger.info('Starting sync', {
    repo: options.repo,
    branch: options.branch,
    direction: options.direction,
    dryRun: options.dryRun ?? false,
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

  // Analyse sync status
  logger.info('Analysing sync status...');
  const analysis = await analyseSyncStatus(service, githubClient, repoName, options.branch);

  // Show analysis
  if (options.output !== 'json') {
    const analysisText = formatAnalysisText(analysis, options.direction);
    // eslint-disable-next-line no-console
    console.log(analysisText);
    // eslint-disable-next-line no-console
    console.log('');
  }

  // Interactive confirmation
  if (options.interactive && !options.dryRun) {
    const toExport =
      options.direction === 'export' || options.direction === 'both'
        ? analysis.ionOnly.length + (options.direction === 'both' ? analysis.modified.length : 0)
        : 0;
    const toImport =
      options.direction === 'import' || options.direction === 'both' ? analysis.githubOnly.length : 0;

    const confirmed = await confirmOperation(
      `Sync ${toExport} to GitHub and ${toImport} from GitHub?`,
      false
    );

    if (!confirmed) {
      logger.info('Sync cancelled by user');
      return;
    }
  }

  // Initialise result
  const result: SyncResult = {
    exported: { total: 0, succeeded: 0, failed: 0, skipped: 0, results: [] },
    imported: { total: 0, succeeded: 0, failed: 0, skipped: 0, results: [] },
  };

  // Execute export if needed
  if (options.direction === 'export' || options.direction === 'both') {
    const exportItems = [...analysis.ionOnly];
    if (options.direction === 'both') {
      exportItems.push(...analysis.modified);
    }

    if (exportItems.length > 0) {
      logger.info(`Exporting ${exportItems.length} components...`);

      // Group by type for export
      const byType = new Map<ComponentType, string[]>();
      for (const item of exportItems) {
        if (!byType.has(item.type)) {
          byType.set(item.type, []);
        }
        byType.get(item.type)!.push(item.name);
      }

      // Export each type
      for (const [type, names] of byType) {
        const exportResult = await service.exportToGitHub({
          types: [type],
          items: names,
          repo: repoName,
          branch: options.branch,
          dryRun: options.dryRun,
          force: options.force,
        });

        result.exported.total += exportResult.total;
        result.exported.succeeded += exportResult.succeeded;
        result.exported.failed += exportResult.failed;
        result.exported.skipped += exportResult.skipped;
        result.exported.results.push(...exportResult.results);
      }
    }
  }

  // Execute import if needed (in dependency order)
  if (options.direction === 'import' || options.direction === 'both') {
    const importItems = analysis.githubOnly;

    if (importItems.length > 0) {
      logger.info(`Importing ${importItems.length} components...`);

      // Group by type
      const byType = new Map<ComponentType, string[]>();
      for (const item of importItems) {
        if (!byType.has(item.type)) {
          byType.set(item.type, []);
        }
        byType.get(item.type)!.push(item.name);
      }

      // Import in dependency order
      for (const type of IMPORT_ORDER) {
        const names = byType.get(type);
        if (!names || names.length === 0) continue;

        const importResult = await service.importFromGitHub({
          types: [type],
          items: names,
          repo: repoName,
          branch: options.branch,
          dryRun: options.dryRun,
          onConflict: options.onConflict ?? 'rename',
        });

        result.imported.total += importResult.total;
        result.imported.succeeded += importResult.succeeded;
        result.imported.failed += importResult.failed;
        result.imported.skipped += importResult.skipped;
        result.imported.results.push(...importResult.results);
      }
    }
  }

  // Output results
  if (options.output === 'json') {
    const output = formatJsonOutput(result);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(output, null, 2));
  } else {
    const output = formatResultText(result, options.dryRun ?? false);
    // eslint-disable-next-line no-console
    console.log(output);
  }

  // Exit with error code if there were failures
  if (result.exported.failed > 0 || result.imported.failed > 0) {
    process.exitCode = 1;
  }
}
