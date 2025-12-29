#!/usr/bin/env node

/**
 * ION CI/CD Toolkit - CLI Entry Point
 * Command-line interface for managing ION components
 */

import { Command } from 'commander';
import { Logger } from './utils/logger.js';
import { executeExport, ExportCommandOptions } from './commands/export.js';
import { executeImport, ImportCommandOptions } from './commands/import.js';
import { executeSync, SyncCommandOptions, SyncDirection } from './commands/sync.js';
import { executeRollback, RollbackCommandOptions } from './commands/rollback.js';
import { executeDeploy, DeployCommandOptions } from './commands/deploy.js';
import { executeValidate, ValidateCommandOptions } from './commands/validate.js';
import { executeRefresh } from './commands/refresh.js';
import { RefreshCommandOptions } from './types/refresh.js';
import { executeAnalyze, AnalyzeCommandOptions } from './commands/analyze.js';
import { executeCompare, CompareCommandOptions } from './commands/compare.js';
import { executePush, PushCommandOptions } from './commands/push.js';
import { ConflictResolution } from './services/component-service.js';
import { ConfigLoader } from './config/loader.js';

const logger = new Logger('CLI');

// Package info
const VERSION = '1.0.0';
const DESCRIPTION = 'Infor ION CI/CD Toolkit - Automated backup and deployment for ION components';

/**
 * Creates and configures the CLI program
 */
function createProgram(): Command {
  const program = new Command();

  program
    .name('ion-cicd')
    .description(DESCRIPTION)
    .version(VERSION, '-v, --version', 'Display version number')
    .option('--config <path>', 'Path to ionapi configuration file (or use ion-cicd.config.json)')
    .option('--env <name>', 'Environment name (tst|trn|prd)')
    .option('--output <format>', 'Output format (text|json)', 'text')
    .option('--verbose', 'Enable verbose logging')
    .hook('preAction', (thisCommand) => {
      const options = thisCommand.opts();
      if (options.verbose) {
        Logger.setLevel('debug');
      }
      if (options.output === 'json') {
        Logger.setJsonOutput(true);
      }
    });

  // Export command
  program
    .command('export')
    .description('Export ION components to GitHub or local folder')
    .option(
      '-t, --type <type>',
      'Component type (dataflows|connectionpoints|mappings|workflows|activationpolicies|fileformattemplates|enterpriselocations|scripts|libraries)'
    )
    .option('-i, --items <names>', 'Comma-separated component names')
    .option('-a, --all', 'Export all components')
    .option('--interactive', 'Use interactive selection')
    .option('--local', 'Export to local ion-components folder instead of GitHub')
    .option('--prune', 'Remove local files that no longer exist in ION (only with --local)')
    .option('--repo <name>', 'Target GitHub repository (owner/repo format)', 'PedalGroup/Infor')
    .option('--branch <name>', 'Target branch', 'main')
    .option('--dry-run', 'Show what would be exported without making changes')
    .option('--force', 'Skip change detection, export everything')
    .action(async (options, command) => {
      const globalOpts = command.parent?.opts() ?? {};

      const exportOptions: ExportCommandOptions = {
        config: globalOpts.config,
        env: globalOpts.env,
        type: options.type,
        items: options.items,
        all: options.all,
        interactive: options.interactive,
        local: options.local,
        prune: options.prune,
        repo: options.repo,
        branch: options.branch,
        dryRun: options.dryRun,
        force: options.force,
        output: globalOpts.output ?? 'text',
      };

      try {
        await executeExport(exportOptions);
      } catch (error) {
        logger.error('Export failed', { error: String(error) });
        process.exit(1);
      }
    });

  // Import command
  program
    .command('import')
    .description('Import ION components from GitHub')
    .option('-t, --type <type>', 'Component type')
    .option('-i, --items <names>', 'Comma-separated component names')
    .option('-a, --all', 'Import all components (ordered by dependencies)')
    .option('--interactive', 'Use interactive selection')
    .option('--repo <name>', 'Source GitHub repository (owner/repo format)', 'PedalGroup/Infor')
    .option('--branch <name>', 'Source branch', 'main')
    .option('--dry-run', 'Show what would be imported without making changes')
    .option('--skip-validation', 'Skip pre-import validation')
    .option('--on-conflict <mode>', 'Conflict handling (update|rename|skip|fail)', 'rename')
    .action(async (options, command) => {
      const globalOpts = command.parent?.opts() ?? {};

      // Validate conflict mode
      const validModes: ConflictResolution[] = ['rename', 'skip', 'fail', 'update'];
      if (!validModes.includes(options.onConflict)) {
        logger.error(`Invalid conflict mode: ${options.onConflict}. Use: update, rename, skip, or fail`);
        process.exit(1);
      }

      const importOptions: ImportCommandOptions = {
        config: globalOpts.config,
        env: globalOpts.env,
        type: options.type,
        items: options.items,
        all: options.all,
        interactive: options.interactive,
        repo: options.repo,
        branch: options.branch,
        dryRun: options.dryRun,
        skipValidation: options.skipValidation,
        onConflict: options.onConflict as ConflictResolution,
        output: globalOpts.output ?? 'text',
      };

      try {
        await executeImport(importOptions);
      } catch (error) {
        logger.error('Import failed', { error: String(error) });
        process.exit(1);
      }
    });

  // Sync command
  program
    .command('sync')
    .description('Bidirectional synchronisation between ION and GitHub')
    .option('--direction <dir>', 'Sync direction (export|import|both)', 'both')
    .option('--repo <name>', 'GitHub repository (owner/repo format)', 'PedalGroup/Infor')
    .option('--branch <name>', 'Branch name', 'main')
    .option('--dry-run', 'Show what would change without making changes')
    .option('--force', 'Skip change detection')
    .option('--on-conflict <mode>', 'Conflict handling for imports (rename|skip|fail)', 'rename')
    .option('--interactive', 'Use interactive confirmation')
    .action(async (options, command) => {
      const globalOpts = command.parent?.opts() ?? {};

      // Validate direction
      const validDirections: SyncDirection[] = ['export', 'import', 'both'];
      if (!validDirections.includes(options.direction)) {
        logger.error(`Invalid direction: ${options.direction}. Use: export, import, or both`);
        process.exit(1);
      }

      // Validate conflict mode
      const validModes: ConflictResolution[] = ['rename', 'skip', 'fail'];
      if (!validModes.includes(options.onConflict)) {
        logger.error(`Invalid conflict mode: ${options.onConflict}. Use: rename, skip, or fail`);
        process.exit(1);
      }

      const syncOptions: SyncCommandOptions = {
        config: globalOpts.config,
        env: globalOpts.env,
        direction: options.direction as SyncDirection,
        repo: options.repo,
        branch: options.branch,
        dryRun: options.dryRun,
        force: options.force,
        onConflict: options.onConflict as ConflictResolution,
        output: globalOpts.output ?? 'text',
        interactive: options.interactive,
      };

      try {
        await executeSync(syncOptions);
      } catch (error) {
        logger.error('Sync failed', { error: String(error) });
        process.exit(1);
      }
    });

  // Rollback command
  program
    .command('rollback')
    .description('Rollback to a previous Git commit')
    .option('--commit <sha>', 'Git commit SHA to rollback to')
    .option('--date <date>', 'Rollback to state at date (YYYY-MM-DD)')
    .option('-t, --type <type>', 'Component type to rollback')
    .option('-i, --items <names>', 'Comma-separated component names')
    .option('--repo <name>', 'GitHub repository (owner/repo format)', 'PedalGroup/Infor')
    .option('--branch <name>', 'Branch name', 'main')
    .option('--dry-run', 'Show what would be restored without making changes')
    .option('--on-conflict <mode>', 'Conflict handling (rename|skip|fail)', 'rename')
    .option('--interactive', 'Use interactive selection')
    .action(async (options, command) => {
      const globalOpts = command.parent?.opts() ?? {};

      // Validate conflict mode
      const validModes: ConflictResolution[] = ['rename', 'skip', 'fail'];
      if (!validModes.includes(options.onConflict)) {
        logger.error(`Invalid conflict mode: ${options.onConflict}. Use: rename, skip, or fail`);
        process.exit(1);
      }

      const rollbackOptions: RollbackCommandOptions = {
        config: globalOpts.config,
        env: globalOpts.env,
        commit: options.commit,
        date: options.date,
        type: options.type,
        items: options.items,
        repo: options.repo,
        branch: options.branch,
        dryRun: options.dryRun,
        onConflict: options.onConflict as ConflictResolution,
        output: globalOpts.output ?? 'text',
        interactive: options.interactive,
      };

      try {
        await executeRollback(rollbackOptions);
      } catch (error) {
        logger.error('Rollback failed', { error: String(error) });
        process.exit(1);
      }
    });

  // Deploy command
  program
    .command('deploy')
    .description('Deploy ION components from local files to ION environment')
    .option('-t, --type <type>', 'Component type to deploy')
    .option('-i, --items <names>', 'Comma-separated component names')
    .option('-f, --file <path>', 'Deploy a single component by file path')
    .option('-a, --all', 'Deploy all components')
    .option('--changed', 'Only deploy files changed in git')
    .option('--dry-run', 'Show what would be deployed without making changes')
    .option('--on-conflict <mode>', 'Conflict handling (update|rename|skip|fail)', 'update')
    .option('--force', 'Skip confirmation for production deployment')
    .option('--auto-approve', 'Auto-approve scripts after deployment (scripts stay in DRAFT otherwise)')
    .option('--ci', 'CI mode - allows deploying to protected environments (for GitHub Actions)')
    .option('--skip-validation', 'Skip dependency validation for dataflows')
    .option('--with-dependencies', 'Auto-deploy all dependencies (libraries, scripts, BOD schemas) for dataflows')
    .option('--sync-dependencies', 'Auto-sync missing connection point API calls from source environment')
    .option('--source-env <env>', 'Source environment for syncing dependencies (use with --sync-dependencies)')
    .action(async (options, command) => {
      const globalOpts = command.parent?.opts() ?? {};

      // Validate conflict mode
      const validModes: ConflictResolution[] = ['rename', 'skip', 'fail', 'update'];
      if (!validModes.includes(options.onConflict)) {
        logger.error(`Invalid conflict mode: ${options.onConflict}. Use: update, rename, skip, or fail`);
        process.exit(1);
      }

      const deployOptions: DeployCommandOptions = {
        config: globalOpts.config,
        env: globalOpts.env,
        type: options.type,
        items: options.items,
        file: options.file,
        all: options.all,
        changed: options.changed,
        dryRun: options.dryRun,
        onConflict: options.onConflict as ConflictResolution,
        force: options.force,
        autoApprove: options.autoApprove,
        ci: options.ci,
        skipValidation: options.skipValidation,
        withDependencies: options.withDependencies,
        syncDependencies: options.syncDependencies,
        sourceEnv: options.sourceEnv,
        output: globalOpts.output ?? 'text',
      };

      try {
        await executeDeploy(deployOptions);
      } catch (error) {
        logger.error('Deploy failed', { error: String(error) });
        process.exit(1);
      }
    });

  // Push command - bulk push all local components
  program
    .command('push')
    .description('Bulk push ALL local components to an ION environment')
    .option('-t, --type <type>', 'Filter by component type')
    .option('--dry-run', 'Preview what would be pushed without making changes')
    .option('--force', 'Skip confirmation prompt')
    .action(async (options, command) => {
      const globalOpts = command.parent?.opts() ?? {};

      const pushOptions: PushCommandOptions = {
        config: globalOpts.config,
        env: globalOpts.env,
        type: options.type,
        dryRun: options.dryRun,
        force: options.force,
        output: globalOpts.output ?? 'text',
      };

      try {
        await executePush(pushOptions);
      } catch (error) {
        logger.error('Push failed', { error: String(error) });
        process.exit(1);
      }
    });

  // Validate command
  program
    .command('validate')
    .description('Validate ION components before deployment')
    .option('-t, --type <type>', 'Component type to validate')
    .option('-i, --items <names>', 'Comma-separated component names')
    .option('-a, --all', 'Validate all components')
    .option('--strict', 'Treat warnings as errors')
    .action(async (options, command) => {
      const globalOpts = command.parent?.opts() ?? {};

      const validateOptions: ValidateCommandOptions = {
        config: globalOpts.config,
        env: globalOpts.env,
        type: options.type,
        items: options.items,
        all: options.all,
        strict: options.strict,
        output: globalOpts.output ?? 'text',
      };

      try {
        await executeValidate(validateOptions);
      } catch (error) {
        logger.error('Validation failed', { error: String(error) });
        process.exit(1);
      }
    });

  // Refresh command
  program
    .command('refresh')
    .description('Copy ION components from one environment to another with transformations')
    .requiredOption('--from <env>', 'Source environment (e.g., prd)')
    .requiredOption('--to <env>', 'Target environment (e.g., trn)')
    .option('--mapping <file>', 'Path to environment mapping file', './env-mappings.json')
    .option('--dry-run', 'Preview changes without deploying')
    .option('--skip-scripts', 'Skip script transformation')
    .option('--non-interactive', 'Use mapping defaults only, no prompts')
    .option('--force', 'Skip confirmation prompts')
    .option('-t, --type <type>', 'Only refresh specific component type')
    .action(async (options, command) => {
      const globalOpts = command.parent?.opts() ?? {};

      const refreshOptions: RefreshCommandOptions = {
        config: globalOpts.config,
        from: options.from,
        to: options.to,
        mappingFile: options.mapping,
        dryRun: options.dryRun,
        skipScripts: options.skipScripts,
        nonInteractive: options.nonInteractive,
        force: options.force,
        type: options.type,
        output: globalOpts.output ?? 'text',
      };

      try {
        await executeRefresh(refreshOptions);
      } catch (error) {
        logger.error('Refresh failed', { error: String(error) });
        process.exit(1);
      }
    });

  // Analyze command
  program
    .command('analyze')
    .description('Analyze a dataflow and check if dependencies exist in target environment')
    .requiredOption('-d, --dataflow <name>', 'Dataflow name to analyze')
    .requiredOption('--to <env>', 'Target environment to check (e.g., trn)')
    .action(async (options, command) => {
      const globalOpts = command.parent?.opts() ?? {};

      const analyzeOptions: AnalyzeCommandOptions = {
        config: globalOpts.config,
        dataflow: options.dataflow,
        to: options.to,
        output: globalOpts.output ?? 'text',
      };

      try {
        await executeAnalyze(analyzeOptions);
      } catch (error) {
        logger.error('Analyze failed', { error: String(error) });
        process.exit(1);
      }
    });

  // Compare command
  program
    .command('compare')
    .description('Compare an ION component between two environments')
    .requiredOption('-t, --type <type>', 'Component type (connectionpoints, scripts, mappings, etc.)')
    .requiredOption('-n, --name <name>', 'Component name')
    .requiredOption('--env1 <env>', 'First environment (e.g., prd)')
    .requiredOption('--env2 <env>', 'Second environment (e.g., trn)')
    .action(async (options, command) => {
      const globalOpts = command.parent?.opts() ?? {};

      const compareOptions: CompareCommandOptions = {
        config: globalOpts.config,
        type: options.type,
        name: options.name,
        env1: options.env1,
        env2: options.env2,
        output: globalOpts.output ?? 'text',
      };

      try {
        await executeCompare(compareOptions);
      } catch (error) {
        logger.error('Compare failed', { error: String(error) });
        process.exit(1);
      }
    });

  // Auth test command
  const authCommand = program
    .command('auth')
    .description('Authentication commands');

  authCommand
    .command('test')
    .description('Test ION API authentication')
    .action(async (_, command) => {
      const globalOpts = command.parent?.parent?.opts() ?? {};

      try {
        const { IONClient } = await import('./clients/ion-client.js');
        const { GitHubClient } = await import('./clients/github-client.js');

        logger.info('Testing ION API authentication...');

        // Use ConfigLoader to resolve configuration
        const loader = new ConfigLoader();
        const resolved = await loader.resolve({
          configPath: globalOpts.config,
          env: globalOpts.env,
        });

        const ionClient = new IONClient(resolved.ionApi);
        await ionClient.authenticate();
        logger.info('ION API authentication successful');

        const githubClient = new GitHubClient(ionClient);
        const repos = await githubClient.listRepos();
        logger.info('GitHub API access confirmed', { repoCount: repos.length });

        // eslint-disable-next-line no-console
        console.log('\n✓ Authentication successful');
        // eslint-disable-next-line no-console
        console.log(`  Environment: ${resolved.environmentName}`);
        // eslint-disable-next-line no-console
        console.log(`  ION tenant: ${resolved.ionApi.ti}`);
        // eslint-disable-next-line no-console
        console.log(`  GitHub repos accessible: ${repos.length}`);
      } catch (error) {
        logger.error('Authentication test failed', { error: String(error) });
        // eslint-disable-next-line no-console
        console.error('\n✗ Authentication failed:', String(error));
        process.exit(1);
      }
    });

  // List command for exploring available components
  const listCommand = program
    .command('list')
    .description('List ION components');

  listCommand
    .command('components')
    .description('List all ION components')
    .option('-t, --type <type>', 'Filter by component type')
    .action(async (options, command) => {
      const globalOpts = command.parent?.parent?.opts() ?? {};
      const outputFormat = globalOpts.output ?? 'text';

      try {
        const { IONClient } = await import('./clients/ion-client.js');
        const { ComponentType, COMPONENT_DISPLAY_NAMES } = await import('./types/ion.js');

        // Use ConfigLoader to resolve configuration
        const loader = new ConfigLoader();
        const resolved = await loader.resolve({
          configPath: globalOpts.config,
          env: globalOpts.env,
        });

        const ionClient = new IONClient(resolved.ionApi);
        await ionClient.authenticate();

        // Get all component type values
        const allTypes = Object.values(ComponentType);
        const types = options.type ? [options.type] : allTypes;

        const results: Record<string, { count: number; items: string[] }> = {};

        for (const type of types) {
          const components = await ionClient.listComponents(type);
          const displayName = (COMPONENT_DISPLAY_NAMES as Record<string, string>)[type] || type;
          results[displayName] = {
            count: components.length,
            items: components.map((c) => c.name),
          };
        }

        if (outputFormat === 'json') {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify(results, null, 2));
        } else {
          let total = 0;
          for (const [typeName, data] of Object.entries(results)) {
            // eslint-disable-next-line no-console
            console.log(`\n${typeName} (${data.count}):`);
            for (const item of data.items) {
              // eslint-disable-next-line no-console
              console.log(`  - ${item}`);
            }
            total += data.count;
          }
          // eslint-disable-next-line no-console
          console.log(`\nTotal: ${total} components`);
        }
      } catch (error) {
        logger.error('Failed to list components', { error: String(error) });
        process.exit(1);
      }
    });

  return program;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Command failed', { error: error.message });
    }
    process.exit(1);
  }
}

// Run CLI
main().catch((error: unknown) => {
  logger.error('Unexpected error', { error: String(error) });
  process.exit(1);
});
