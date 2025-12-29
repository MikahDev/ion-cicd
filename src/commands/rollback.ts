/**
 * Rollback Command
 * Restores ION components from a previous Git commit
 */

import { IONClient } from '../clients/ion-client.js';
import { GitHubClient } from '../clients/github-client.js';
import { ComponentService, ConflictResolution } from '../services/component-service.js';
import { IONApiConfig, ComponentType, IMPORT_ORDER } from '../types/index.js';
import { IONComponentDetail } from '../types/ion.js';
import { CLIOutput, ImportResult, BatchResult } from '../types/result.js';
import { Logger } from '../utils/logger.js';
import { confirmOperation, selectFromList } from '../interactive/prompts.js';
import { ConfigLoader } from '../config/loader.js';

const logger = new Logger('RollbackCommand');

/**
 * Rollback command options from CLI
 */
export interface RollbackCommandOptions {
  /** Path to ionapi config file (optional if ion-cicd.config.json exists) */
  config?: string;
  /** Environment name (tst|trn|prd) */
  env?: string;
  /** Git commit SHA to rollback to */
  commit?: string;
  /** Rollback to state at date (YYYY-MM-DD) */
  date?: string;
  /** Component type to rollback (optional, defaults to all) */
  type?: string;
  /** Specific component names to rollback */
  items?: string;
  /** GitHub repository (owner/repo format) */
  repo: string;
  /** Branch name */
  branch: string;
  /** Dry run - show what would be restored */
  dryRun?: boolean;
  /** How to handle conflicts */
  onConflict?: ConflictResolution;
  /** Output format */
  output: 'text' | 'json';
  /** Interactive mode */
  interactive?: boolean;
}

/**
 * Represents a component to be restored
 */
interface RollbackItem {
  name: string;
  type: ComponentType;
  displayType: string;
  path: string;
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
 * Parses component type from string
 * @param typeStr - Component type string
 * @returns ComponentType or undefined
 */
function parseComponentType(typeStr: string): ComponentType | undefined {
  const normalised = typeStr.toLowerCase();
  return Object.values(ComponentType).find((t) => t === normalised);
}

/**
 * Formats the rollback result for text output
 * @param result - Batch result from rollback
 * @param commitSha - The commit that was restored from
 * @param dryRun - Whether this was a dry run
 * @returns Formatted string
 */
function formatResultText(
  result: BatchResult<ImportResult>,
  commitSha: string,
  dryRun: boolean
): string {
  const lines: string[] = [];

  if (dryRun) {
    lines.push('=== DRY RUN - No changes made ===\n');
  }

  lines.push(`=== Rollback from ${commitSha.substring(0, 7)} ===\n`);

  lines.push(`Rollback Summary:`);
  lines.push(`  Total:    ${result.total}`);
  lines.push(`  Restored: ${result.succeeded}`);
  lines.push(`  Skipped:  ${result.skipped}`);
  lines.push(`  Failed:   ${result.failed}`);
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

  // Output by type
  for (const [type, items] of byType) {
    lines.push(`${type}:`);
    for (const item of items) {
      const status =
        item.status === 'created' || item.status === 'updated'
          ? '✓'
          : item.status === 'skipped'
            ? '○'
            : '✗';
      const suffix = item.error ? ` (${item.error})` : '';
      lines.push(`  ${status} ${item.originalName}${suffix}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Formats the rollback result for JSON output
 * @param result - Batch result from rollback
 * @returns CLIOutput object
 */
function formatJsonOutput(result: BatchResult<ImportResult>): CLIOutput {
  const components = result.results.filter((r) => r.result.data).map((r) => r.result.data!);

  const errors = result.results
    .filter((r) => r.result.error)
    .map((r) => r.result.error!.message);

  return {
    success: result.failed === 0,
    operation: 'rollback',
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
 * Executes the rollback command
 * @param options - Command options
 */
export async function executeRollback(options: RollbackCommandOptions): Promise<void> {
  logger.info('Starting rollback', {
    repo: options.repo,
    branch: options.branch,
    commit: options.commit,
    date: options.date,
    dryRun: options.dryRun ?? false,
  });

  // Validate that either commit or date is provided
  if (!options.commit && !options.date) {
    throw new Error('Either --commit or --date must be provided');
  }

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

  // Determine the target commit
  let targetCommit = options.commit;

  if (options.date) {
    logger.info(`Finding commit at date: ${options.date}`);
    targetCommit = await githubClient.findCommitAtDate(repoName, options.date, options.branch);
    if (!targetCommit) {
      throw new Error(`No commit found at or before ${options.date}`);
    }
    logger.info(`Found commit: ${targetCommit.substring(0, 7)}`);
  }

  if (!targetCommit) {
    throw new Error('Could not determine target commit');
  }

  // Get tree at the target commit
  logger.info(`Fetching state at commit ${targetCommit.substring(0, 7)}...`);
  const tree = await githubClient.getTreeAtCommit(repoName, targetCommit);

  // Build list of components to restore
  const rollbackItems: RollbackItem[] = [];

  // Filter by type if specified
  let targetTypes = Object.values(ComponentType);
  if (options.type) {
    const parsedType = parseComponentType(options.type);
    if (!parsedType) {
      throw new Error(
        `Invalid component type: ${options.type}. Valid types: ${Object.values(ComponentType).join(', ')}`
      );
    }
    targetTypes = [parsedType];
  }

  // Parse items if provided
  let targetItems: string[] | undefined;
  if (options.items) {
    targetItems = options.items.split(',').map((i) => i.trim());
  }

  // Find matching files in the tree
  for (const entry of tree.tree) {
    if (entry.type !== 'blob' || !entry.path.endsWith('.json')) continue;

    const parts = entry.path.split('/');
    if (parts.length !== 2) continue;

    const folderName = parts[0];
    const fileName = parts[1].replace('.json', '');

    const type = service.getTypeFromDisplayName(folderName);
    if (!type) continue;

    // Check if this type is in our target list
    if (!targetTypes.includes(type)) continue;

    // Check if this item is in our target list
    if (targetItems && !targetItems.map((i) => i.toLowerCase()).includes(fileName.toLowerCase())) {
      continue;
    }

    rollbackItems.push({
      name: fileName,
      type,
      displayType: folderName,
      path: entry.path,
    });
  }

  if (rollbackItems.length === 0) {
    logger.info('No components found to rollback');
    // eslint-disable-next-line no-console
    console.log('No components found at the specified commit.');
    return;
  }

  // Interactive mode - let user select which to restore
  if (options.interactive && !options.dryRun) {
    // Show commits for context
    const commits = await githubClient.listCommits(repoName, { sha: options.branch });
    const commitChoices = commits.slice(0, 10).map((c) => ({
      name: `${c.sha.substring(0, 7)} - ${c.commit.message.split('\n')[0]} (${new Date(c.commit.committer.date).toLocaleDateString()})`,
      value: c.sha,
    }));

    // If no commit specified, let user select one
    if (!options.commit && !options.date) {
      targetCommit = await selectFromList('Select commit to restore from:', commitChoices);
    }

    // Confirm operation
    const confirmed = await confirmOperation(
      `Restore ${rollbackItems.length} components from commit ${targetCommit.substring(0, 7)}?`,
      false
    );

    if (!confirmed) {
      logger.info('Rollback cancelled by user');
      return;
    }
  }

  // Show preview
  if (options.output !== 'json') {
    // eslint-disable-next-line no-console
    console.log(`\nRestoring from commit: ${targetCommit.substring(0, 7)}`);
    // eslint-disable-next-line no-console
    console.log(`Components to restore: ${rollbackItems.length}\n`);

    for (const item of rollbackItems) {
      // eslint-disable-next-line no-console
      console.log(`  ${item.displayType}/${item.name}`);
    }
    // eslint-disable-next-line no-console
    console.log('');
  }

  // Execute rollback
  const results: {
    item: string;
    result: {
      success: boolean;
      data?: ImportResult;
      error?: { code: number; message: string; retryable: boolean };
    };
  }[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  // Group by type for dependency-ordered import
  const byType = new Map<ComponentType, RollbackItem[]>();
  for (const item of rollbackItems) {
    if (!byType.has(item.type)) {
      byType.set(item.type, []);
    }
    byType.get(item.type)!.push(item);
  }

  // Process in dependency order
  for (const type of IMPORT_ORDER) {
    const items = byType.get(type);
    if (!items || items.length === 0) continue;

    const displayName = service.getDisplayName(type);
    logger.info(`Restoring ${displayName}...`);

    for (const item of items) {
      const itemKey = `${item.displayType}/${item.name}`;

      try {
        // Fetch content at the target commit
        const content = await githubClient.getFileContentAtCommit(
          repoName,
          item.path,
          targetCommit
        );
        const data = JSON.parse(content) as IONComponentDetail;

        if (options.dryRun) {
          logger.info(`[DRY RUN] Would restore: ${item.path}`);
          results.push({
            item: itemKey,
            result: {
              success: true,
              data: {
                originalName: item.name,
                finalName: item.name,
                type: displayName,
                status: 'created',
              },
            },
          });
          succeeded++;
          continue;
        }

        // Import the component
        const importResult = await service.importComponent(
          type,
          data,
          options.onConflict ?? 'rename'
        );

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
            logger.info(`Restored: ${item.path}`);
            break;
          case 'skipped':
            skipped++;
            break;
          case 'failed':
            failed++;
            break;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push({
          item: itemKey,
          result: {
            success: false,
            data: {
              originalName: item.name,
              finalName: item.name,
              type: displayName,
              status: 'failed',
              error: errorMessage,
            },
            error: {
              code: 500,
              message: errorMessage,
              retryable: false,
            },
          },
        });
        failed++;
        logger.error(`Failed to restore: ${item.path}`, { error: errorMessage });
      }
    }
  }

  const batchResult: BatchResult<ImportResult> = {
    total: results.length,
    succeeded,
    failed,
    skipped,
    results,
  };

  // Output results
  if (options.output === 'json') {
    const output = formatJsonOutput(batchResult);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(output, null, 2));
  } else {
    const output = formatResultText(batchResult, targetCommit, options.dryRun ?? false);
    // eslint-disable-next-line no-console
    console.log(output);
  }

  // Exit with error code if there were failures
  if (failed > 0) {
    process.exitCode = 1;
  }
}
