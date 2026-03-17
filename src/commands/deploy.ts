/**
 * Deploy Command
 * Deploys ION components from local files to ION environment
 */

import { readFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, dirname, resolve, relative } from 'path';
import { execSync } from 'child_process';
import { IONClient } from '../clients/ion-client.js';
import { ComponentService, ConflictResolution } from '../services/component-service.js';
import { IONApiConfig, ComponentType, COMPONENT_DISPLAY_NAMES, IMPORT_ORDER, ScriptComponent, BODSchemaComponent, LibraryComponent } from '../types/index.js';
import { IONComponentDetail } from '../types/ion.js';
import { CLIOutput, ImportResult, BatchResult } from '../types/result.js';
import { Logger } from '../utils/logger.js';
import { confirmOperation, selectEnvironmentFromConfig, EnvironmentChoice, selectDependencyTypes, DependencyTypeChoice } from '../interactive/prompts.js';
import { ConfigLoader, ResolvedConfig } from '../config/loader.js';
import {
  validateDataflowForDeployment,
  syncConnectionPointApiCalls,
  parseDataflowDependencies,
  DataflowValidationResult,
  STANDARD_NOUNS,
} from '../services/dataflow-validator.js';
import { markdownToHtml } from '../utils/markdown.js';

const logger = new Logger('DeployCommand');

/**
 * Deploy command options from CLI
 */
export interface DeployCommandOptions {
  /** Path to ionapi config file (optional if ion-cicd.config.json exists) */
  config?: string;
  /** Environment to deploy to (tst, trn, prd) */
  env?: string;
  /** Component type (optional) */
  type?: string;
  /** Comma-separated component names (optional) */
  items?: string;
  /** Deploy all components */
  all?: boolean;
  /** Dry run - show what would be deployed */
  dryRun?: boolean;
  /** Conflict resolution strategy */
  onConflict: ConflictResolution;
  /** Force deploy (skip confirmation for production) */
  force?: boolean;
  /** Only deploy files changed in git */
  changed?: boolean;
  /** Output format */
  output: 'text' | 'json';
  /** Auto-approve scripts after deployment */
  autoApprove?: boolean;
  /** CI mode - allows deploying to protected environments (used by GitHub Actions) */
  ci?: boolean;
  /** Path to a single component file to deploy */
  file?: string;
  /** Skip dependency validation for dataflows */
  skipValidation?: boolean;
  /** Auto-deploy all dependencies (libraries, scripts, BOD schemas) for dataflows */
  withDependencies?: boolean;
  /** Auto-sync missing connection point API calls from source */
  syncDependencies?: boolean;
  /** Source environment for syncing dependencies */
  sourceEnv?: string;
}

/**
 * Detects if running in an actual CI environment
 * Returns true only if specific CI environment variables are set
 */
function isActualCIEnvironment(): boolean {
  // GitHub Actions
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.CI === 'true') {
    return true;
  }
  // GitLab CI
  if (process.env.GITLAB_CI === 'true') {
    return true;
  }
  // Azure DevOps
  if (process.env.TF_BUILD === 'True') {
    return true;
  }
  // Jenkins
  if (process.env.JENKINS_URL) {
    return true;
  }
  // CircleCI
  if (process.env.CIRCLECI === 'true') {
    return true;
  }
  // Travis CI
  if (process.env.TRAVIS === 'true') {
    return true;
  }
  // Bitbucket Pipelines
  if (process.env.BITBUCKET_PIPELINE_UUID) {
    return true;
  }
  return false;
}

/**
 * Validates that CI mode is being used correctly
 * @param options - Command options
 * @throws Error if CI flag is misused
 */
function validateCIMode(options: DeployCommandOptions): void {
  if (options.ci && !isActualCIEnvironment()) {
    logger.warn('--ci flag used outside of detected CI environment', {
      detectedCI: false,
      envCI: process.env.CI,
      envGitHubActions: process.env.GITHUB_ACTIONS,
    });
    // In production, we could make this an error:
    // throw new Error('--ci flag can only be used in actual CI environments (GitHub Actions, GitLab CI, etc.)');
    // For now, just log a warning to allow migration
  }
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
 * Represents a component file to deploy
 */
interface DeployItem {
  name: string;
  type: ComponentType;
  displayType: string;
  path: string;
}

/**
 * Production environment patterns to detect
 */
const PRODUCTION_PATTERNS = ['prd', 'prod', 'production'];

/**
 * Checks if the environment appears to be production
 * @param envName - Environment name
 * @param ionConfig - ION API config (for tenant ID check)
 * @returns True if production
 */
function isProductionEnvironment(envName: string, ionConfig: IONApiConfig): boolean {
  const envLower = envName.toLowerCase();
  if (PRODUCTION_PATTERNS.some((p) => envLower.includes(p))) {
    return true;
  }

  // Check tenant ID for _PRD suffix (Infor convention)
  if (ionConfig.ti && ionConfig.ti.toUpperCase().endsWith('_PRD')) {
    return true;
  }

  return false;
}

/**
 * Gets list of changed files from git
 * @param componentsPath - Path to ion-components folder
 * @returns Array of changed file paths (relative to componentsPath)
 */
function getChangedFiles(componentsPath: string): string[] {
  try {
    // Get files changed relative to main/master branch
    const result = execSync(
      'git diff --name-only HEAD $(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD origin/master 2>/dev/null || echo HEAD~1) 2>/dev/null || git diff --name-only HEAD~1',
      {
        cwd: componentsPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    return result
      .split('\n')
      .filter((f) => f.trim().length > 0 && f.endsWith('.json'))
      .map((f) => f.trim());
  } catch (error) {
    logger.warn('Could not detect git changes, falling back to all files', {
      error: String(error),
    });
    return [];
  }
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
 * Parses a file path to extract component type and name
 * @param filePath - Absolute or relative path to component file
 * @param componentsPath - Path to ion-components folder
 * @returns DeployItem or null if path is invalid
 */
function parseFilePath(filePath: string, componentsPath: string): DeployItem | null {
  // Resolve to absolute path
  const absolutePath = resolve(filePath);
  const absoluteComponentsPath = resolve(componentsPath);

  // Check if file is within components folder
  const relativePath = relative(absoluteComponentsPath, absolutePath);
  if (relativePath.startsWith('..') || relativePath === absolutePath) {
    logger.error('File is not within the ion-components folder', {
      file: filePath,
      componentsPath,
    });
    return null;
  }

  // Parse the relative path: "TypeFolder/ComponentName.ext"
  const parts = relativePath.split('/');
  if (parts.length !== 2) {
    logger.error('Invalid file path structure. Expected: ion-components/<Type>/<Name>.<ext>', {
      path: relativePath,
    });
    return null;
  }

  const [displayType, fileName] = parts;

  // Map folder name to component type
  const type = DISPLAY_NAME_TO_TYPE[displayType];
  if (!type) {
    logger.error('Unknown component type folder', {
      folder: displayType,
      validFolders: Object.keys(DISPLAY_NAME_TO_TYPE),
    });
    return null;
  }

  // Extract component name from filename
  let name: string;
  if (type === ComponentType.SCRIPTS) {
    // Scripts can be .py, .meta.json, or .md - we use .py as the primary file
    if (fileName.endsWith('.py')) {
      name = basename(fileName, '.py');
    } else if (fileName.endsWith('.meta.json')) {
      name = basename(fileName, '.meta.json');
    } else if (fileName.endsWith('.md')) {
      name = basename(fileName, '.md');
    } else {
      logger.error('Script files must have .py, .meta.json, or .md extension', { fileName });
      return null;
    }
    // Always return the .py file path
    return {
      name,
      type,
      displayType,
      path: join(absoluteComponentsPath, displayType, `${name}.py`),
    };
  } else if (type === ComponentType.BOD_SCHEMAS) {
    // BOD schemas use .xsd + .xml - we use .xsd as the primary file
    if (fileName.endsWith('.xsd')) {
      name = basename(fileName, '.xsd');
    } else if (fileName.endsWith('.xml')) {
      name = basename(fileName, '.xml');
    } else {
      logger.error('BOD schema files must have .xsd or .xml extension', { fileName });
      return null;
    }
    // Always return the .xsd file path
    return {
      name,
      type,
      displayType,
      path: join(absoluteComponentsPath, displayType, `${name}.xsd`),
    };
  } else if (type === ComponentType.LIBRARIES) {
    // Libraries can be .py, .whl, .meta.json, or legacy .json - we use .py as the primary file
    if (fileName.endsWith('.py')) {
      name = basename(fileName, '.py');
    } else if (fileName.endsWith('.whl')) {
      name = basename(fileName, '.whl');
    } else if (fileName.endsWith('.meta.json')) {
      name = basename(fileName, '.meta.json');
    } else if (fileName.endsWith('.json')) {
      // Legacy format - use .json directly
      name = basename(fileName, '.json');
      return {
        name,
        type,
        displayType,
        path: absolutePath,
      };
    } else {
      logger.error('Library files must have .py, .whl, .meta.json, or .json extension', { fileName });
      return null;
    }
    // Always return the .py file path for new format (we rebuild wheel from source)
    return {
      name,
      type,
      displayType,
      path: join(absoluteComponentsPath, displayType, `${name}.py`),
    };
  } else {
    // Other components use .json format
    if (!fileName.endsWith('.json')) {
      logger.error('Component files must have .json extension', { fileName });
      return null;
    }
    name = basename(fileName, '.json');
    return {
      name,
      type,
      displayType,
      path: absolutePath,
    };
  }
}

/**
 * Reads a script from .py + .meta.json + optional .md files and combines into ScriptComponent
 * @param pyPath - Path to the .py file
 * @param metaPath - Path to the .meta.json file
 * @returns Combined ScriptComponent
 */
async function readScriptFiles(pyPath: string, metaPath: string): Promise<ScriptComponent> {
  const scriptCode = await readFile(pyPath, 'utf-8');
  const metaContent = await readFile(metaPath, 'utf-8');
  const metadata = JSON.parse(metaContent);

  // Check for .md documentation file
  const mdPath = pyPath.replace(/\.py$/, '.md');
  let documentation = metadata.documentation || '';

  if (existsSync(mdPath)) {
    const markdownContent = await readFile(mdPath, 'utf-8');
    if (markdownContent.trim()) {
      documentation = markdownToHtml(markdownContent);
    }
  }

  return {
    ...metadata,
    scriptCode,
    documentation,
  } as ScriptComponent;
}

/**
 * Reads a BOD schema from .xsd + .xml files and combines into BODSchemaComponent
 * @param xsdPath - Path to the .xsd file
 * @param xmlPath - Path to the .xml file
 * @param name - Component name
 * @returns Combined BODSchemaComponent
 */
async function readBODSchemaFiles(xsdPath: string, xmlPath: string, name: string): Promise<BODSchemaComponent> {
  const nounSchemaXsd = await readFile(xsdPath, 'utf-8');
  const nounMetadataXml = await readFile(xmlPath, 'utf-8');

  return {
    name,
    standard: false, // Custom BODs are not standard
    nounSchemaXsd,
    nounMetadataXml,
  };
}

/**
 * Builds a wheel from Python source code and metadata
 * @param pythonSource - The Python source code
 * @param metadata - Library metadata including name and version
 * @returns Buffer containing the wheel ZIP file
 */
async function buildWheelFromSource(pythonSource: string, metadata: Record<string, unknown>): Promise<Buffer> {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip();

  const name = metadata.name as string;
  const version = metadata.version as string || '1.0.0';
  const distInfoDir = `${name}-${version}.dist-info`;

  // Add the Python source file
  zip.addFile(`${name}.py`, Buffer.from(pythonSource, 'utf-8'));

  // Create METADATA file
  const metadataContent = [
    'Metadata-Version: 2.1',
    `Name: ${name}`,
    `Version: ${version}`,
  ].join('\n');
  zip.addFile(`${distInfoDir}/METADATA`, Buffer.from(metadataContent, 'utf-8'));

  // Create WHEEL file
  const wheelContent = [
    'Wheel-Version: 1.0',
    'Generator: ion-cicd',
    'Root-Is-Purelib: true',
    'Tag: py3-none-any',
  ].join('\n');
  zip.addFile(`${distInfoDir}/WHEEL`, Buffer.from(wheelContent, 'utf-8'));

  // Create top_level.txt
  zip.addFile(`${distInfoDir}/top_level.txt`, Buffer.from(name, 'utf-8'));

  // Create RECORD (checksums) - we'll use empty hashes as ION doesn't validate them
  const recordContent = [
    `${name}.py,,`,
    `${distInfoDir}/METADATA,,`,
    `${distInfoDir}/WHEEL,,`,
    `${distInfoDir}/top_level.txt,,`,
    `${distInfoDir}/RECORD,,`,
  ].join('\n');
  zip.addFile(`${distInfoDir}/RECORD`, Buffer.from(recordContent, 'utf-8'));

  return zip.toBuffer();
}

/**
 * Reads a library from .py + .meta.json files and rebuilds into LibraryComponent
 * @param pyPath - Path to the .py file (Python source code)
 * @param metaPath - Path to the .meta.json file
 * @returns Combined LibraryComponent with base64-encoded wheel file
 */
async function readLibraryFiles(pyPath: string, metaPath: string): Promise<LibraryComponent> {
  const pythonSource = await readFile(pyPath, 'utf-8');
  const metadata = JSON.parse(await readFile(metaPath, 'utf-8'));

  // Rebuild the wheel from source
  const wheelBuffer = await buildWheelFromSource(pythonSource, metadata);
  const base64File = wheelBuffer.toString('base64');

  return {
    ...metadata,
    file: base64File,
  } as LibraryComponent;
}

/**
 * Discovers all component files in the ion-components folder
 * @param componentsPath - Path to ion-components folder
 * @param types - Optional filter by types
 * @param items - Optional filter by item names
 * @returns Array of deploy items
 */
async function discoverComponents(
  componentsPath: string,
  types?: ComponentType[],
  items?: string[]
): Promise<DeployItem[]> {
  const result: DeployItem[] = [];

  if (!existsSync(componentsPath)) {
    logger.warn('Components folder does not exist', { path: componentsPath });
    return result;
  }

  // Read top-level folders (component type folders)
  const folders = await readdir(componentsPath);

  for (const folder of folders) {
    const folderPath = join(componentsPath, folder);
    const folderStat = await stat(folderPath);

    if (!folderStat.isDirectory()) continue;

    // Map folder name to component type
    const type = DISPLAY_NAME_TO_TYPE[folder];
    if (!type) {
      logger.debug('Unknown component folder, skipping', { folder });
      continue;
    }

    // Filter by types if specified
    if (types && !types.includes(type)) {
      continue;
    }

    // Read files in folder
    const files = await readdir(folderPath);

    // Scripts use .py + .meta.json format
    if (type === ComponentType.SCRIPTS) {
      // Find all .py files (these are the primary script files)
      const pyFiles = files.filter((f) => f.endsWith('.py'));

      for (const pyFile of pyFiles) {
        const name = basename(pyFile, '.py');
        const metaFile = `${name}.meta.json`;

        // Check that both files exist
        if (!files.includes(metaFile)) {
          logger.warn('Script missing .meta.json file, skipping', { name });
          continue;
        }

        // Filter by items if specified
        if (items && !items.map((i) => i.toLowerCase()).includes(name.toLowerCase())) {
          continue;
        }

        result.push({
          name,
          type,
          displayType: folder,
          path: join(folderPath, pyFile), // Store .py path, we'll read .meta.json alongside
        });
      }
    } else if (type === ComponentType.BOD_SCHEMAS) {
      // BOD schemas use .xsd + .xml format
      const xsdFiles = files.filter((f) => f.endsWith('.xsd'));

      for (const xsdFile of xsdFiles) {
        const name = basename(xsdFile, '.xsd');
        const xmlFile = `${name}.xml`;

        // Check that both files exist
        if (!files.includes(xmlFile)) {
          logger.warn('BOD schema missing .xml file, skipping', { name });
          continue;
        }

        // Filter by items if specified
        if (items && !items.map((i) => i.toLowerCase()).includes(name.toLowerCase())) {
          continue;
        }

        result.push({
          name,
          type,
          displayType: folder,
          path: join(folderPath, xsdFile), // Store .xsd path, we'll read .xml alongside
        });
      }
    } else if (type === ComponentType.LIBRARIES) {
      // Libraries use .py + .meta.json format (preferred) or legacy .json format
      const pyFiles = files.filter((f) => f.endsWith('.py'));
      const discoveredNames = new Set<string>();

      // First, discover .py files (preferred format - we rebuild wheel from source)
      for (const pyFile of pyFiles) {
        const name = basename(pyFile, '.py');
        const metaFile = `${name}.meta.json`;

        // Check that both files exist
        if (!files.includes(metaFile)) {
          logger.warn('Library missing .meta.json file, skipping', { name });
          continue;
        }

        // Filter by items if specified
        if (items && !items.map((i) => i.toLowerCase()).includes(name.toLowerCase())) {
          continue;
        }

        discoveredNames.add(name);
        result.push({
          name,
          type,
          displayType: folder,
          path: join(folderPath, pyFile), // Store .py path, we'll read .meta.json alongside
        });
      }

      // Then, discover legacy .json files (only if not already discovered as .py)
      for (const file of files) {
        if (!file.endsWith('.json') || file.endsWith('.meta.json')) continue;

        const name = basename(file, '.json');

        // Skip if already discovered as .py format
        if (discoveredNames.has(name)) continue;

        // Filter by items if specified
        if (items && !items.map((i) => i.toLowerCase()).includes(name.toLowerCase())) {
          continue;
        }

        result.push({
          name,
          type,
          displayType: folder,
          path: join(folderPath, file),
        });
      }
    } else {
      // Other components use .json format
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const name = basename(file, '.json');

        // Filter by items if specified
        if (items && !items.map((i) => i.toLowerCase()).includes(name.toLowerCase())) {
          continue;
        }

        result.push({
          name,
          type,
          displayType: folder,
          path: join(folderPath, file),
        });
      }
    }
  }

  return result;
}

/**
 * Formats the deploy result for text output
 * @param result - Batch result from deploy
 * @param envName - Environment name
 * @param dryRun - Whether this was a dry run
 * @returns Formatted string
 */
function formatTextOutput(
  result: BatchResult<ImportResult>,
  envName: string,
  dryRun: boolean
): string {
  const lines: string[] = [];

  if (dryRun) {
    lines.push('=== DRY RUN - No changes made ===\n');
  }

  lines.push(`=== Deploy to ${envName.toUpperCase()} ===\n`);

  lines.push(`Deploy Summary:`);
  lines.push(`  Total:    ${result.total}`);
  lines.push(`  Deployed: ${result.succeeded}`);
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

  // Output by type (in import order)
  const orderedTypes = IMPORT_ORDER.map((t) => COMPONENT_DISPLAY_NAMES[t]);
  for (const typeName of orderedTypes) {
    const typeItems = byType.get(typeName);
    if (!typeItems || typeItems.length === 0) continue;

    lines.push(`${typeName}:`);
    for (const item of typeItems) {
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
 * Formats the deploy result for JSON output
 * @param result - Batch result from deploy
 * @returns CLIOutput object
 */
function formatJsonOutput(result: BatchResult<ImportResult>): CLIOutput {
  const components = result.results.filter((r) => r.result.data).map((r) => r.result.data!);

  const errors = result.results
    .filter((r) => r.result.error)
    .map((r) => r.result.error!.message);

  return {
    success: result.failed === 0,
    operation: 'deploy',
    timestamp: new Date().toISOString(),
    summary: {
      deployed: result.succeeded,
      skipped: result.skipped,
      failed: result.failed,
    },
    components,
    errors,
  };
}

/**
 * Executes the deploy command
 * @param options - Command options
 */
export async function executeDeploy(options: DeployCommandOptions): Promise<void> {
  // Validate CI mode usage
  validateCIMode(options);

  logger.info('Starting deploy', {
    env: options.env,
    dryRun: options.dryRun ?? false,
    onConflict: options.onConflict,
    changed: options.changed ?? false,
    ci: options.ci ?? false,
    isActualCI: isActualCIEnvironment(),
  });

  // Load configuration
  const loader = new ConfigLoader();
  let resolved: ResolvedConfig;

  // Load app config early for environment prompts
  const appConfig = await loader.loadAppConfig(options.config);
  const envChoices: EnvironmentChoice[] = Object.entries(appConfig.environments).map(
    ([key, config]) => ({
      key,
      displayName: config.displayName,
      protected: config.protected,
    })
  );

  // If --file is provided without --env, prompt for environment selection
  let selectedEnv = options.env;
  if (options.file && !options.env && !options.ci) {
    if (envChoices.length === 0) {
      throw new Error('No environments configured in ion-cicd.config.json');
    }

    selectedEnv = await selectEnvironmentFromConfig(envChoices);
  }

  // Prompt for source environment if --sync-dependencies is used but --source-env is not provided
  let sourceEnv = options.sourceEnv;
  if (options.syncDependencies && !sourceEnv && !options.ci) {
    const sourceChoices = envChoices.filter((e: EnvironmentChoice) => e.key !== selectedEnv);
    if (sourceChoices.length > 0) {
      sourceEnv = await selectEnvironmentFromConfig(
        sourceChoices,
        'Select source environment for syncing dependencies:'
      );
      options.sourceEnv = sourceEnv;
    }
  }

  try {
    resolved = await loader.resolve({
      configPath: options.config,
      env: selectedEnv,
    });
  } catch (error) {
    logger.error('Failed to load config', { error: String(error) });
    throw new Error(`Failed to load configuration: ${error}`);
  }

  const componentsPath = resolved.componentsPath;
  const envName = resolved.environmentName;

  logger.info('Configuration loaded', {
    environment: envName,
    componentsPath,
    tenant: resolved.ionApi.ti,
  });

  // Check for protected environment - require confirmation
  if (resolved.environment.protected && !options.force && !options.dryRun && !options.ci) {
    const displayName = resolved.environment.displayName ?? envName.toUpperCase();
    // eslint-disable-next-line no-console
    console.log(`\n⚠️  WARNING: ${displayName} is a PROTECTED environment ⚠️\n`);
    // eslint-disable-next-line no-console
    console.log(`  Environment: ${envName.toUpperCase()}`);
    // eslint-disable-next-line no-console
    console.log(`  Tenant: ${resolved.ionApi.ti}\n`);

    const confirmed = await confirmOperation(
      `Are you sure you want to deploy to ${displayName}?`,
      false
    );

    if (!confirmed) {
      logger.info('Deploy cancelled by user');
      // eslint-disable-next-line no-console
      console.log('Deploy cancelled.');
      return;
    }
  }
  // Check for production environment (if not already handled by protected check)
  else if (isProductionEnvironment(envName, resolved.ionApi)) {
    if (!options.force && !options.dryRun && !options.ci) {
      // eslint-disable-next-line no-console
      console.log('\n⚠️  WARNING: You are about to deploy to PRODUCTION ⚠️\n');
      // eslint-disable-next-line no-console
      console.log(`  Environment: ${envName.toUpperCase()}`);
      // eslint-disable-next-line no-console
      console.log(`  Tenant: ${resolved.ionApi.ti}\n`);

      const confirmed = await confirmOperation(
        'Are you sure you want to deploy to PRODUCTION?',
        false
      );

      if (!confirmed) {
        logger.info('Deploy cancelled by user');
        // eslint-disable-next-line no-console
        console.log('Deploy cancelled.');
        return;
      }
    }
  }

  // Handle --file option for single file deployment
  let deployItems: DeployItem[];

  if (options.file) {
    // Parse the file path to get component type and name
    const item = parseFilePath(options.file, componentsPath);
    if (!item) {
      throw new Error(`Invalid file path: ${options.file}`);
    }

    // Validate the file exists
    if (!existsSync(item.path)) {
      throw new Error(`File not found: ${item.path}`);
    }

    // For scripts, also check that .meta.json exists
    if (item.type === ComponentType.SCRIPTS) {
      const metaPath = item.path.replace(/\.py$/, '.meta.json');
      if (!existsSync(metaPath)) {
        throw new Error(`Script metadata file not found: ${metaPath}`);
      }
    }

    // For BOD schemas, also check that .xml exists
    if (item.type === ComponentType.BOD_SCHEMAS) {
      const xmlPath = item.path.replace(/\.xsd$/, '.xml');
      if (!existsSync(xmlPath)) {
        throw new Error(`BOD schema XML metadata file not found: ${xmlPath}`);
      }
    }

    // For Libraries with .py format, also check that .meta.json exists
    if (item.type === ComponentType.LIBRARIES && item.path.endsWith('.py')) {
      const metaPath = item.path.replace(/\.py$/, '.meta.json');
      if (!existsSync(metaPath)) {
        throw new Error(`Library metadata file not found: ${metaPath}`);
      }
    }

    deployItems = [item];
    logger.info('Deploying single file', { file: options.file, type: item.displayType, name: item.name });
  } else {
    // Parse component types filter
    let types: ComponentType[] | undefined;
    if (options.type) {
      const parsedType = parseComponentType(options.type);
      if (!parsedType) {
        throw new Error(
          `Invalid component type: ${options.type}. Valid types: ${Object.values(ComponentType).join(', ')}`
        );
      }
      types = [parsedType];
    }

    // Parse items filter
    let items: string[] | undefined;
    if (options.items) {
      items = options.items.split(',').map((i) => i.trim());
    }

    // Discover components to deploy
    deployItems = await discoverComponents(componentsPath, types, items);

    if (deployItems.length === 0) {
      logger.info('No components found to deploy');
      // eslint-disable-next-line no-console
      console.log('No components found to deploy.');
      return;
    }

    // Filter to changed files only if --changed flag is set
    if (options.changed) {
      const changedFiles = getChangedFiles(dirname(componentsPath));
      if (changedFiles.length > 0) {
        const changedSet = new Set(changedFiles.map((f) => f.toLowerCase()));
        deployItems = deployItems.filter((item) => {
          const relativePath = `${item.displayType}/${item.name}.json`.toLowerCase();
          return changedSet.has(relativePath);
        });

        if (deployItems.length === 0) {
          logger.info('No changed components found to deploy');
          // eslint-disable-next-line no-console
          console.log('No changed components found to deploy.');
          return;
        }
      } else {
        logger.warn('Could not detect changes, deploying all components');
      }
    }

    // Require explicit --all flag if no filtering provided (unless --file was used)
    if (!options.all && !options.type && !options.items && !options.changed) {
      throw new Error('Specify --all, --type, --items, --changed, or --file');
    }
  }

  // Show preview
  if (options.output !== 'json') {
    // eslint-disable-next-line no-console
    console.log(`\nDeploying to: ${envName.toUpperCase()}`);
    // eslint-disable-next-line no-console
    console.log(`Components to deploy: ${deployItems.length}\n`);

    for (const item of deployItems) {
      // eslint-disable-next-line no-console
      console.log(`  ${item.displayType}/${item.name}`);
    }
    // eslint-disable-next-line no-console
    console.log('');
  }

  // Create ION client and component service
  const ionClient = new IONClient(resolved.ionApi);
  await ionClient.authenticate();
  const service = new ComponentService(ionClient, null as unknown as never);

  // Deploy all dependencies first if --with-dependencies is set
  const dataflows = deployItems.filter((item) => item.type === ComponentType.DATAFLOWS);
  if (dataflows.length > 0 && options.withDependencies) {
    // Collect all dependencies from dataflows first
    const allLibraries = new Map<string, string>(); // name -> scriptName (for logging)
    const allScripts = new Set<string>();
    const allSchemas = new Set<string>();
    const allWorkflows = new Set<string>();
    const allMappings = new Set<string>();
    const allConnectionPoints = new Set<string>();

    for (const df of dataflows) {
      const content = await readFile(df.path, 'utf-8');
      const dataflow = JSON.parse(content);
      const deps = parseDataflowDependencies(dataflow);

      // Collect scripts
      for (const script of deps.scripts) {
        allScripts.add(script.scriptName);

        // Get libraries from script metadata
        const metaPath = join(componentsPath, 'Script', `${script.scriptName}.meta.json`);
        if (existsSync(metaPath)) {
          try {
            const metaContent = await readFile(metaPath, 'utf-8');
            const metadata = JSON.parse(metaContent) as { usedLibraries?: Array<{ name: string }> };
            if (metadata.usedLibraries) {
              for (const lib of metadata.usedLibraries) {
                allLibraries.set(lib.name, script.scriptName);
              }
            }
          } catch {
            // Ignore metadata read errors
          }
        }
      }

      // Collect custom schemas
      for (const noun of deps.customNouns) {
        allSchemas.add(noun.noun);
      }

      // Collect workflows
      for (const workflow of deps.workflows) {
        allWorkflows.add(workflow.workflowName);
      }

      // Collect mappings
      for (const mapping of deps.mappings) {
        allMappings.add(mapping.mappingName);
      }

      // Collect ION API connection points
      for (const ionApi of deps.ionApiActivities) {
        allConnectionPoints.add(ionApi.connectionPoint);
      }
    }

    // Second-level check: Extract BOD dependencies from mappings
    for (const mappingName of allMappings) {
      const mappingPath = join(componentsPath, 'Mapping', `${mappingName}.json`);
      if (existsSync(mappingPath)) {
        try {
          const mappingContent = await readFile(mappingPath, 'utf-8');
          const mapping = JSON.parse(mappingContent) as {
            fromDocument?: string;
            toDocument?: string;
          };

          // Check if toDocument is a custom noun (output of the mapping)
          if (mapping.toDocument && !STANDARD_NOUNS.has(mapping.toDocument)) {
            allSchemas.add(mapping.toDocument);
          }

          // Check if fromDocument is a custom noun (input of the mapping)
          if (mapping.fromDocument && !STANDARD_NOUNS.has(mapping.fromDocument)) {
            allSchemas.add(mapping.fromDocument);
          }
        } catch {
          // Ignore errors reading mapping file
        }
      }
    }

    // Check if there are any dependencies to deploy
    const hasDependencies = allLibraries.size > 0 || allWorkflows.size > 0 || allMappings.size > 0 || allSchemas.size > 0 || allScripts.size > 0 || allConnectionPoints.size > 0;

    // Build dependency choices for interactive selection
    const dependencyChoices: DependencyTypeChoice[] = [];
    if (allLibraries.size > 0) {
      dependencyChoices.push({
        type: 'libraries',
        label: 'Libraries',
        count: allLibraries.size,
        items: [...allLibraries.keys()],
      });
    }
    if (allWorkflows.size > 0) {
      dependencyChoices.push({
        type: 'workflows',
        label: 'Workflows',
        count: allWorkflows.size,
        items: [...allWorkflows],
      });
    }
    if (allMappings.size > 0) {
      dependencyChoices.push({
        type: 'mappings',
        label: 'Mappings',
        count: allMappings.size,
        items: [...allMappings],
      });
    }
    if (allSchemas.size > 0) {
      dependencyChoices.push({
        type: 'schemas',
        label: 'Schemas',
        count: allSchemas.size,
        items: [...allSchemas],
      });
    }
    if (allScripts.size > 0) {
      dependencyChoices.push({
        type: 'scripts',
        label: 'Scripts',
        count: allScripts.size,
        items: [...allScripts],
      });
    }
    if (allConnectionPoints.size > 0) {
      dependencyChoices.push({
        type: 'connectionpoints',
        label: 'Connection Points',
        count: allConnectionPoints.size,
        items: [...allConnectionPoints],
      });
    }

    // Prompt user to select which dependency types to deploy (unless in CI mode)
    let selectedDepTypes: string[] = ['libraries', 'workflows', 'mappings', 'schemas', 'scripts', 'connectionpoints'];
    if (hasDependencies && !options.ci && options.output !== 'json') {
      // eslint-disable-next-line no-console
      console.log('=== Dependencies Found ===');
      for (const dep of dependencyChoices) {
        // eslint-disable-next-line no-console
        console.log(`  ${dep.label}: ${dep.items.join(', ')}`);
      }
      // eslint-disable-next-line no-console
      console.log('');

      selectedDepTypes = await selectDependencyTypes(dependencyChoices);

      if (selectedDepTypes.length === 0) {
        // eslint-disable-next-line no-console
        console.log('No dependency types selected, skipping dependency deployment.\n');
      } else {
        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log('=== Deploying Dependencies ===');
      }
    } else if (hasDependencies && options.output !== 'json') {
      // CI mode - show summary and deploy all
      // eslint-disable-next-line no-console
      console.log('=== Dependencies ===');
      // eslint-disable-next-line no-console
      console.log(`  Libraries:  ${allLibraries.size > 0 ? [...allLibraries.keys()].join(', ') : 'none'}`);
      // eslint-disable-next-line no-console
      console.log(`  Workflows:  ${allWorkflows.size > 0 ? [...allWorkflows].join(', ') : 'none'}`);
      // eslint-disable-next-line no-console
      console.log(`  Mappings:   ${allMappings.size > 0 ? [...allMappings].join(', ') : 'none'}`);
      // eslint-disable-next-line no-console
      console.log(`  Schemas:    ${allSchemas.size > 0 ? [...allSchemas].join(', ') : 'none'}`);
      // eslint-disable-next-line no-console
      console.log(`  Scripts:    ${allScripts.size > 0 ? [...allScripts].join(', ') : 'none'}`);
      // eslint-disable-next-line no-console
      console.log(`  Connection Points: ${allConnectionPoints.size > 0 ? [...allConnectionPoints].join(', ') : 'none'}`);
      // eslint-disable-next-line no-console
      console.log('');
      // eslint-disable-next-line no-console
      console.log('=== Deploying Dependencies ===');
    }

    // Deploy libraries first (if selected)
    if (selectedDepTypes.includes('libraries')) {
    for (const [libName] of allLibraries) {
      const libPyPath = join(componentsPath, 'Library', `${libName}.py`);
      const libMetaPath = join(componentsPath, 'Library', `${libName}.meta.json`);
      const libJsonPath = join(componentsPath, 'Library', `${libName}.json`);

      // Prefer .py + .meta.json format (rebuild wheel from source), fall back to legacy .json
      const useNewFormat = existsSync(libPyPath) && existsSync(libMetaPath);
      const useLegacyFormat = !useNewFormat && existsSync(libJsonPath);

      if (useNewFormat || useLegacyFormat) {
        try {
          let libData: LibraryComponent;
          if (useNewFormat) {
            libData = await readLibraryFiles(libPyPath, libMetaPath);
          } else {
            const content = await readFile(libJsonPath, 'utf-8');
            libData = JSON.parse(content);
          }
          if (!options.dryRun) {
            const result = await service.importComponent(ComponentType.LIBRARIES, libData, 'update');
            if (result.status === 'failed') {
              // Check if it's a "version already exists" error - treat as success
              if (result.error?.includes('already existing')) {
                if (hasDependencies && options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`  ✓ Library: ${libName} (already exists)`);
                }
              } else {
                if (hasDependencies && options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`  ✗ Library: ${libName} - ${result.error}`);
                }
              }
            } else if (hasDependencies && options.output !== 'json') {
              // eslint-disable-next-line no-console
              console.log(`  ✓ Library: ${libName}`);
            }
          } else if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✓ Library: ${libName}`);
          }
        } catch (error) {
          if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✗ Library: ${libName} - ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        if (hasDependencies && options.output !== 'json') {
          // eslint-disable-next-line no-console
          console.log(`  ⚠ Library: ${libName} - not found locally`);
        }
      }
    }
    }

    // Deploy connection points (if selected) - before workflows/mappings that reference them
    if (selectedDepTypes.includes('connectionpoints')) {
    for (const cpName of allConnectionPoints) {
      const cpPath = join(componentsPath, 'Connection point', `${cpName}.json`);
      if (existsSync(cpPath)) {
        try {
          const content = await readFile(cpPath, 'utf-8');
          const cpData = JSON.parse(content);
          // Remove connectionPointProperties to avoid overwriting credentials (e.g., serviceAccount)
          // This allows updating document groups without affecting authentication settings
          delete cpData.connectionPointProperties;
          if (!options.dryRun) {
            const result = await service.importComponent(ComponentType.CONNECTION_POINTS, cpData, 'update');
            if (result.status === 'failed') {
              if (hasDependencies && options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`  ✗ Connection Point: ${cpName} - ${result.error}`);
              }
            } else if (hasDependencies && options.output !== 'json') {
              // eslint-disable-next-line no-console
              console.log(`  ✓ Connection Point: ${cpName}`);
            }
          } else if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✓ Connection Point: ${cpName}`);
          }
        } catch (error) {
          if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✗ Connection Point: ${cpName} - ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        if (hasDependencies && options.output !== 'json') {
          // eslint-disable-next-line no-console
          console.log(`  ⚠ Connection Point: ${cpName} - not found locally`);
        }
      }
    }
    }

    // Deploy workflows (if selected)
    if (selectedDepTypes.includes('workflows')) {
    for (const workflowName of allWorkflows) {
      const workflowPath = join(componentsPath, 'Workflow', `${workflowName}.json`);
      if (existsSync(workflowPath)) {
        try {
          const content = await readFile(workflowPath, 'utf-8');
          const workflowData = JSON.parse(content);
          if (!options.dryRun) {
            const result = await service.importComponent(ComponentType.WORKFLOWS, workflowData, 'update');
            if (result.status === 'failed') {
              if (hasDependencies && options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`  ✗ Workflow: ${workflowName} - ${result.error}`);
              }
            } else if (hasDependencies && options.output !== 'json') {
              // eslint-disable-next-line no-console
              console.log(`  ✓ Workflow: ${workflowName}`);
            }
          } else if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✓ Workflow: ${workflowName}`);
          }
        } catch (error) {
          if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✗ Workflow: ${workflowName} - ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        if (hasDependencies && options.output !== 'json') {
          // eslint-disable-next-line no-console
          console.log(`  ⚠ Workflow: ${workflowName} - not found locally`);
        }
      }
    }
    }

    // Deploy mappings (if selected)
    if (selectedDepTypes.includes('mappings')) {
    for (const mappingName of allMappings) {
      const mappingPath = join(componentsPath, 'Mapping', `${mappingName}.json`);
      if (existsSync(mappingPath)) {
        try {
          const content = await readFile(mappingPath, 'utf-8');
          const mappingData = JSON.parse(content);
          if (!options.dryRun) {
            const result = await service.importComponent(ComponentType.MAPPINGS, mappingData, 'update');
            if (result.status === 'failed') {
              if (hasDependencies && options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`  ✗ Mapping: ${mappingName} - ${result.error}`);
              }
            } else if (hasDependencies && options.output !== 'json') {
              // eslint-disable-next-line no-console
              console.log(`  ✓ Mapping: ${mappingName}`);
            }
          } else if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✓ Mapping: ${mappingName}`);
          }
        } catch (error) {
          if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✗ Mapping: ${mappingName} - ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        if (hasDependencies && options.output !== 'json') {
          // eslint-disable-next-line no-console
          console.log(`  ⚠ Mapping: ${mappingName} - not found locally`);
        }
      }
    }
    }

    // Deploy schemas (if selected)
    if (selectedDepTypes.includes('schemas')) {
    for (const schemaName of allSchemas) {
      const xsdPath = join(componentsPath, 'BOD schema', `${schemaName}.xsd`);
      const xmlPath = join(componentsPath, 'BOD schema', `${schemaName}.xml`);
      const objectSchemaPath = join(componentsPath, 'Object schema', `${schemaName}.json`);

      if (existsSync(xsdPath) && existsSync(xmlPath)) {
        try {
          const xsdContent = await readFile(xsdPath, 'utf-8');
          const xmlContent = await readFile(xmlPath, 'utf-8');
          if (!options.dryRun) {
            const result = await service.importComponent(ComponentType.BOD_SCHEMAS, { name: schemaName, nounSchemaXsd: xsdContent, nounMetadataXml: xmlContent }, 'update');
            if (result.status === 'failed') {
              if (hasDependencies && options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`  ✗ Schema: ${schemaName} - ${result.error}`);
              }
            } else if (hasDependencies && options.output !== 'json') {
              // eslint-disable-next-line no-console
              console.log(`  ✓ Schema: ${schemaName} (BOD)`);
            }
          } else if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✓ Schema: ${schemaName} (BOD)`);
          }
        } catch (error) {
          if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✗ Schema: ${schemaName} - ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else if (existsSync(objectSchemaPath)) {
        try {
          const content = await readFile(objectSchemaPath, 'utf-8');
          const schemaData = JSON.parse(content);
          if (!options.dryRun) {
            const result = await service.importComponent(ComponentType.OBJECT_SCHEMAS, schemaData, 'update');
            if (result.status === 'failed') {
              if (hasDependencies && options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`  ✗ Schema: ${schemaName} - ${result.error}`);
              }
            } else if (hasDependencies && options.output !== 'json') {
              // eslint-disable-next-line no-console
              console.log(`  ✓ Schema: ${schemaName} (Object)`);
            }
          } else if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✓ Schema: ${schemaName} (Object)`);
          }
        } catch (error) {
          if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✗ Schema: ${schemaName} - ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        if (hasDependencies && options.output !== 'json') {
          // eslint-disable-next-line no-console
          console.log(`  ⚠ Schema: ${schemaName} - not found locally`);
        }
      }
    }
    }

    // Deploy scripts (if selected)
    const deployedScriptsForApproval: string[] = [];
    if (selectedDepTypes.includes('scripts')) {
    for (const scriptName of allScripts) {
      const metaPath = join(componentsPath, 'Script', `${scriptName}.meta.json`);
      const pyPath = join(componentsPath, 'Script', `${scriptName}.py`);
      if (existsSync(metaPath) && existsSync(pyPath)) {
        try {
          const metaContent = await readFile(metaPath, 'utf-8');
          const metadata = JSON.parse(metaContent);
          const scriptCode = await readFile(pyPath, 'utf-8');
          const scriptData = { ...metadata, scriptCode };
          if (!options.dryRun) {
            const result = await service.importComponent(ComponentType.SCRIPTS, scriptData, 'update');
            if (result.status === 'failed') {
              if (hasDependencies && options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`  ✗ Script: ${scriptName} - ${result.error}`);
              }
            } else {
              deployedScriptsForApproval.push(scriptName);
              if (hasDependencies && options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`  ✓ Script: ${scriptName}`);
              }
            }
          } else if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✓ Script: ${scriptName}`);
          }
        } catch (error) {
          if (hasDependencies && options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log(`  ✗ Script: ${scriptName} - ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        if (hasDependencies && options.output !== 'json') {
          // eslint-disable-next-line no-console
          console.log(`  ⚠ Script: ${scriptName} - not found locally`);
        }
      }
    }

    // Auto-approve scripts if option is set
    if (options.autoApprove && deployedScriptsForApproval.length > 0 && !options.dryRun) {
      for (const scriptName of deployedScriptsForApproval) {
        try {
          await ionClient.approveScript(scriptName);
        } catch {
          // Silent - approval errors are not critical
        }
      }
    }
    }

    if (hasDependencies && selectedDepTypes.length > 0 && options.output !== 'json') {
      // eslint-disable-next-line no-console
      console.log('');
    }
  }

  // Validate dataflow dependencies before deployment
  if (dataflows.length > 0 && !options.skipValidation) {
    if (options.output !== 'json') {
      // eslint-disable-next-line no-console
      console.log('=== Validating ===');
    }

    const validationResults: DataflowValidationResult[] = [];
    let hasBlockingIssues = false;

    for (const df of dataflows) {
      const result = await validateDataflowForDeployment(df.path, ionClient, componentsPath);
      validationResults.push(result);

      if (!result.valid) {
        hasBlockingIssues = true;
      }

      if (options.output !== 'json') {
        const status = result.valid ? '✓' : '✗';
        // eslint-disable-next-line no-console
        console.log(`  ${status} ${result.dataflow}`);

        for (const issue of result.issues) {
          const icon = issue.severity === 'error' ? '✗' : '⚠';
          // eslint-disable-next-line no-console
          console.log(`      ${icon} ${issue.message}`);
          if (issue.details) {
            // eslint-disable-next-line no-console
            console.log(`        ${issue.details}`);
          }
          if (issue.fix) {
            // eslint-disable-next-line no-console
            console.log(`        Fix: ${issue.fix}`);
          }
        }
      }
    }

    if (options.output !== 'json') {
      // eslint-disable-next-line no-console
      console.log('');
    }

    // Handle blocking issues
    if (hasBlockingIssues) {
      // Try to auto-sync if option is set and source env is provided
      if (options.syncDependencies && options.sourceEnv) {
        if (options.output !== 'json') {
          // eslint-disable-next-line no-console
          console.log('=== Syncing Missing Dependencies ===\n');
        }

        // Load source environment
        const sourceConfig = await loader.resolve({ env: options.sourceEnv });
        const sourceClient = new IONClient(sourceConfig.ionApi);
        await sourceClient.authenticate();

        // Collect all missing API calls by connection point
        const missingByCP = new Map<string, string[]>();
        for (const result of validationResults) {
          for (const ionApi of result.dependencies.ionApiActivities) {
            if (ionApi.requiredCallName) {
              if (!missingByCP.has(ionApi.connectionPoint)) {
                missingByCP.set(ionApi.connectionPoint, []);
              }
              missingByCP.get(ionApi.connectionPoint)!.push(ionApi.requiredCallName);
            }
          }
        }

        // Sync each connection point
        let syncedAny = false;
        for (const [cpName, callNames] of missingByCP) {
          const syncResult = await syncConnectionPointApiCalls(
            cpName,
            sourceClient,
            ionClient,
            callNames
          );

          if (syncResult.synced.length > 0) {
            syncedAny = true;
            if (options.output !== 'json') {
              // eslint-disable-next-line no-console
              console.log(`  ✓ ${cpName}: synced API calls: ${syncResult.synced.join(', ')}`);
            }
          }
          if (syncResult.failed.length > 0) {
            if (options.output !== 'json') {
              // eslint-disable-next-line no-console
              console.log(`  ✗ ${cpName}: failed to sync: ${syncResult.failed.join(', ')}`);
            }
          }
        }

        if (syncedAny) {
          if (options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log('\n  Re-validating after sync...\n');
          }
          // Re-validate after sync
          hasBlockingIssues = false;
          for (const df of dataflows) {
            const result = await validateDataflowForDeployment(df.path, ionClient, componentsPath);
            if (!result.valid) {
              hasBlockingIssues = true;
              if (options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`  ✗ ${result.dataflow} still has issues`);
                for (const issue of result.issues) {
                  // eslint-disable-next-line no-console
                  console.log(`      ${issue.message}`);
                }
              }
            } else {
              if (options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`  ✓ ${result.dataflow} - dependencies resolved`);
              }
            }
          }
        }

        if (options.output !== 'json') {
          // eslint-disable-next-line no-console
          console.log('');
        }
      }

      // Auto-deploy dependencies if option is set
      if (options.withDependencies && hasBlockingIssues) {
        if (options.output !== 'json') {
          // eslint-disable-next-line no-console
          console.log('=== Deploying Missing Dependencies ===\n');
        }

        // Collect all missing dependencies from validation results
        const missingLibraries = new Set<string>();
        const missingScripts = new Set<string>();
        const missingBODSchemas = new Set<string>();
        const missingMappings = new Set<string>();

        for (const result of validationResults) {
          for (const issue of result.issues) {
            if (issue.component.startsWith('Library:')) {
              const libName = issue.component.replace('Library: ', '');
              missingLibraries.add(libName);
            } else if (issue.component.startsWith('Script:')) {
              const scriptName = issue.component.replace('Script: ', '');
              missingScripts.add(scriptName);
            } else if (issue.component.startsWith('BOD Schema:')) {
              const schemaName = issue.component.replace('BOD Schema: ', '');
              missingBODSchemas.add(schemaName);
            } else if (issue.component.startsWith('Mapping:')) {
              const mappingName = issue.component.replace('Mapping: ', '');
              missingMappings.add(mappingName);
            }
          }
        }

        // Deploy libraries first
        if (missingLibraries.size > 0) {
          if (options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log('  Libraries:');
          }
          for (const libName of missingLibraries) {
            const libPyPath = join(componentsPath, 'Library', `${libName}.py`);
            const libMetaPath = join(componentsPath, 'Library', `${libName}.meta.json`);
            const libJsonPath = join(componentsPath, 'Library', `${libName}.json`);

            // Prefer .py + .meta.json format (rebuild wheel from source), fall back to legacy .json
            const useNewFormat = existsSync(libPyPath) && existsSync(libMetaPath);
            const useLegacyFormat = !useNewFormat && existsSync(libJsonPath);

            if (useNewFormat || useLegacyFormat) {
              try {
                let libData: LibraryComponent;
                if (useNewFormat) {
                  libData = await readLibraryFiles(libPyPath, libMetaPath);
                } else {
                  const content = await readFile(libJsonPath, 'utf-8');
                  libData = JSON.parse(content);
                }
                if (!options.dryRun) {
                  await service.importComponent(ComponentType.LIBRARIES, libData, 'update');
                }
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`    ✓ ${libName}`);
                }
              } catch (error) {
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`    ✗ ${libName}: ${error instanceof Error ? error.message : String(error)}`);
                }
              }
            } else {
              if (options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`    ✗ ${libName}: not found in local components`);
              }
            }
          }
        }

        // Deploy BOD schemas (check both BOD schema and Object schema folders)
        if (missingBODSchemas.size > 0) {
          if (options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log('  Schemas:');
          }
          for (const schemaName of missingBODSchemas) {
            // First check for BOD schema (XSD + XML format)
            const xsdPath = join(componentsPath, 'BOD schema', `${schemaName}.xsd`);
            const xmlPath = join(componentsPath, 'BOD schema', `${schemaName}.xml`);
            // Also check for Object schema (JSON format)
            const objectSchemaPath = join(componentsPath, 'Object schema', `${schemaName}.json`);

            if (existsSync(xsdPath) && existsSync(xmlPath)) {
              // Deploy as BOD schema
              try {
                const xsdContent = await readFile(xsdPath, 'utf-8');
                const xmlContent = await readFile(xmlPath, 'utf-8');
                if (!options.dryRun) {
                  await service.importComponent(ComponentType.BOD_SCHEMAS, { name: schemaName, nounSchemaXsd: xsdContent, nounMetadataXml: xmlContent }, 'update');
                }
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`    ✓ ${schemaName} (BOD)`);
                }
              } catch (error) {
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`    ✗ ${schemaName}: ${error instanceof Error ? error.message : String(error)}`);
                }
              }
            } else if (existsSync(objectSchemaPath)) {
              // Deploy as Object schema
              try {
                const content = await readFile(objectSchemaPath, 'utf-8');
                const schemaData = JSON.parse(content);
                if (!options.dryRun) {
                  await service.importComponent(ComponentType.OBJECT_SCHEMAS, schemaData, 'update');
                }
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`    ✓ ${schemaName} (Object)`);
                }
              } catch (error) {
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`    ✗ ${schemaName}: ${error instanceof Error ? error.message : String(error)}`);
                }
              }
            } else {
              if (options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`    ✗ ${schemaName}: not found in local components`);
              }
            }
          }
        }

        // Deploy mappings
        if (missingMappings.size > 0) {
          if (options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log('  Mappings:');
          }
          for (const mappingName of missingMappings) {
            const mappingPath = join(componentsPath, 'Mapping', `${mappingName}.json`);
            if (existsSync(mappingPath)) {
              try {
                const content = await readFile(mappingPath, 'utf-8');
                const mappingData = JSON.parse(content);
                if (!options.dryRun) {
                  await service.importComponent(ComponentType.MAPPINGS, mappingData, 'update');
                }
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`    ✓ ${mappingName}`);
                }
              } catch (error) {
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`    ✗ ${mappingName}: ${error instanceof Error ? error.message : String(error)}`);
                }
              }
            } else {
              if (options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`    ✗ ${mappingName}: not found in local components`);
              }
            }
          }
        }

        // Deploy scripts (with auto-approve if enabled)
        if (missingScripts.size > 0) {
          if (options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log('  Scripts:');
          }
          const deployedDepScripts: string[] = [];
          for (const scriptName of missingScripts) {
            const metaPath = join(componentsPath, 'Script', `${scriptName}.meta.json`);
            const pyPath = join(componentsPath, 'Script', `${scriptName}.py`);
            if (existsSync(metaPath) && existsSync(pyPath)) {
              try {
                const metaContent = await readFile(metaPath, 'utf-8');
                const metadata = JSON.parse(metaContent);
                const scriptCode = await readFile(pyPath, 'utf-8');
                const scriptData = { ...metadata, scriptCode };
                if (!options.dryRun) {
                  await service.importComponent(ComponentType.SCRIPTS, scriptData, 'update');
                  deployedDepScripts.push(scriptName);
                }
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`    ✓ ${scriptName}`);
                }
              } catch (error) {
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`    ✗ ${scriptName}: ${error instanceof Error ? error.message : String(error)}`);
                }
              }
            } else {
              if (options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`    ✗ ${scriptName}: not found in local components`);
              }
            }
          }

          // Auto-approve dependency scripts if option is set
          if (options.autoApprove && deployedDepScripts.length > 0 && !options.dryRun) {
            if (options.output !== 'json') {
              // eslint-disable-next-line no-console
              console.log('\n  Approving dependency scripts...');
            }
            for (const scriptName of deployedDepScripts) {
              try {
                await ionClient.approveScript(scriptName);
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`    ✓ Approved: ${scriptName}`);
                }
              } catch (error) {
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`    ⚠ Could not approve ${scriptName}: ${error instanceof Error ? error.message : String(error)}`);
                }
              }
            }
          }
        }

        // In dry-run mode, assume dependencies would be resolved
        if (options.dryRun) {
          if (options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log('\n  [DRY RUN] Dependencies would be deployed, proceeding with dataflow...\n');
          }
          hasBlockingIssues = false;
        } else {
          if (options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log('\n  Re-validating after deploying dependencies...\n');
          }

          // Re-validate after deploying dependencies
          hasBlockingIssues = false;
          for (const df of dataflows) {
            const result = await validateDataflowForDeployment(df.path, ionClient, componentsPath);
            if (!result.valid) {
              // Check if only API call issues remain (those need --sync-dependencies)
              const nonApiIssues = result.issues.filter(i => !i.message.includes('API call'));
              if (nonApiIssues.length > 0) {
                hasBlockingIssues = true;
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`  ✗ ${result.dataflow} still has issues`);
                  for (const issue of nonApiIssues) {
                    // eslint-disable-next-line no-console
                    console.log(`      ${issue.message}`);
                  }
                }
              } else {
                if (options.output !== 'json') {
                  // eslint-disable-next-line no-console
                  console.log(`  ✓ ${result.dataflow} - dependencies resolved (API calls may need --sync-dependencies)`);
                }
              }
            } else {
              if (options.output !== 'json') {
                // eslint-disable-next-line no-console
                console.log(`  ✓ ${result.dataflow} - all dependencies resolved`);
              }
            }
          }

          if (options.output !== 'json') {
            // eslint-disable-next-line no-console
            console.log('');
          }
        }
      }

      // If still has blocking issues, abort deployment
      if (hasBlockingIssues && !options.force) {
        if (options.output !== 'json') {
          // eslint-disable-next-line no-console
          console.log('═'.repeat(60));
          // eslint-disable-next-line no-console
          console.log('  Deployment blocked due to missing dependencies');
          // eslint-disable-next-line no-console
          console.log('═'.repeat(60));
          // eslint-disable-next-line no-console
          console.log('\nOptions:');
          // eslint-disable-next-line no-console
          console.log('  1. Fix the issues manually in ION Desk');
          // eslint-disable-next-line no-console
          console.log('  2. Use --with-dependencies to auto-deploy libraries, scripts, and BOD schemas');
          // eslint-disable-next-line no-console
          console.log('  3. Use --sync-dependencies --source-env <env> to auto-sync API calls from source');
          // eslint-disable-next-line no-console
          console.log('  4. Use --skip-validation to deploy anyway (may cause runtime errors)');
          // eslint-disable-next-line no-console
          console.log('  5. Use --force to ignore validation errors\n');
        }
        process.exitCode = 1;
        return;
      }
    }
  }

  // Execute deploy
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

  // Track deployed scripts for auto-approval
  const deployedScripts: string[] = [];

  // Group by type for dependency-ordered import
  const byType = new Map<ComponentType, DeployItem[]>();
  for (const item of deployItems) {
    if (!byType.has(item.type)) {
      byType.set(item.type, []);
    }
    byType.get(item.type)!.push(item);
  }

  // Process in dependency order
  for (const type of IMPORT_ORDER) {
    const typeItems = byType.get(type);
    if (!typeItems || typeItems.length === 0) continue;

    const displayName = COMPONENT_DISPLAY_NAMES[type];
    logger.info(`Deploying ${displayName}...`);

    for (const item of typeItems) {
      const itemKey = `${item.displayType}/${item.name}`;

      try {
        // Read component data from file(s)
        let data: IONComponentDetail;

        if (type === ComponentType.SCRIPTS) {
          // Scripts use .py + .meta.json format
          const pyPath = item.path;
          const metaPath = item.path.replace(/\.py$/, '.meta.json');
          data = await readScriptFiles(pyPath, metaPath);
        } else if (type === ComponentType.BOD_SCHEMAS) {
          // BOD schemas use .xsd + .xml format
          const xsdPath = item.path;
          const xmlPath = item.path.replace(/\.xsd$/, '.xml');
          data = await readBODSchemaFiles(xsdPath, xmlPath, item.name);
        } else if (type === ComponentType.LIBRARIES && item.path.endsWith('.py')) {
          // Libraries use .py + .meta.json format (new format) - rebuild wheel from source
          const pyPath = item.path;
          const metaPath = item.path.replace(/\.py$/, '.meta.json');
          data = await readLibraryFiles(pyPath, metaPath);
        } else {
          // Standard JSON format for other components (including legacy Library .json)
          const content = await readFile(item.path, 'utf-8');
          data = JSON.parse(content) as IONComponentDetail;
        }

        if (options.dryRun) {
          logger.info(`[DRY RUN] Would deploy: ${itemKey}`);
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
        const importResult = await service.importComponent(type, data, options.onConflict);

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
            logger.info(`Deployed: ${itemKey}`);
            // Track deployed scripts for auto-approval
            if (type === ComponentType.SCRIPTS && options.autoApprove) {
              deployedScripts.push(importResult.finalName);
            }
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
        logger.error(`Failed to deploy: ${itemKey}`, { error: errorMessage });
      }
    }
  }

  // Auto-approve scripts if flag is set and not dry-run
  if (options.autoApprove && deployedScripts.length > 0 && !options.dryRun) {
    logger.info('Auto-approving deployed scripts...', { count: deployedScripts.length });
    try {
      await service.approveScripts(deployedScripts);
      if (options.output !== 'json') {
        // eslint-disable-next-line no-console
        console.log(`\n✓ Auto-approved ${deployedScripts.length} script(s)`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to auto-approve scripts', { error: errorMessage });
      if (options.output !== 'json') {
        // eslint-disable-next-line no-console
        console.error(`\n✗ Failed to auto-approve scripts: ${errorMessage}`);
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
    const output = formatTextOutput(batchResult, envName, options.dryRun ?? false);
    // eslint-disable-next-line no-console
    console.log(output);
  }

  // Exit with error code if there were failures
  if (failed > 0) {
    process.exitCode = 1;
  }
}
