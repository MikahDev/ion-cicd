/**
 * Refresh Command
 * Copies ION components from source environment to target with transformations
 */

import { existsSync } from 'fs';
import { IONClient } from '../clients/ion-client.js';
import {
  TransformationService,
  loadMappingFile,
} from '../services/transformation-service.js';
import {
  ComponentType,
  COMPONENT_DISPLAY_NAMES,
  ScriptComponent,
  IONComponentDetail,
} from '../types/index.js';
import {
  RefreshCommandOptions,
  RefreshSummary,
  TransformationResult,
} from '../types/refresh.js';
import { Logger } from '../utils/logger.js';
import { ConfigLoader, ResolvedConfig } from '../config/loader.js';
import {
  displayDetectedValues,
  promptForReplacements,
  promptScriptAction,
  displayScriptTransformSummary,
  confirmRefresh,
  displayCredentialReminder,
} from '../interactive/script-prompts.js';

const logger = new Logger('RefreshCommand');

/**
 * Component types in deployment order
 */
const REFRESH_ORDER: ComponentType[] = [
  ComponentType.LIBRARIES,
  ComponentType.CONNECTION_POINTS,
  ComponentType.FILE_TEMPLATES,
  ComponentType.ENTERPRISE_LOCATIONS,
  ComponentType.SCRIPTS,
  ComponentType.MAPPINGS,
  ComponentType.DATAFLOWS,
  ComponentType.WORKFLOWS,
  ComponentType.ACTIVATION_POLICIES,
];

/**
 * Parse component type from string
 */
function parseComponentType(typeStr: string): ComponentType | undefined {
  const normalised = typeStr.toLowerCase();
  return Object.values(ComponentType).find((t) => t === normalised);
}

/**
 * Loads configuration for an environment
 */
async function loadEnvConfig(env: string): Promise<ResolvedConfig> {
  const loader = new ConfigLoader();
  return loader.resolve({ env });
}

/**
 * Executes the refresh command
 */
export async function executeRefresh(options: RefreshCommandOptions): Promise<void> {
  logger.info('Starting environment refresh', {
    from: options.from,
    to: options.to,
    dryRun: options.dryRun ?? false,
  });

  // Load mapping file
  const mappingPath = options.mappingFile || './env-mappings.json';
  if (!existsSync(mappingPath)) {
    throw new Error(
      `Mapping file not found: ${mappingPath}\n` +
        'Create an env-mappings.json file or specify path with --mapping'
    );
  }

  const mapping = await loadMappingFile(mappingPath);
  const transformService = new TransformationService(mapping);

  // Validate environments exist in mapping
  if (!mapping.environments[options.from]) {
    throw new Error(`Source environment '${options.from}' not found in mapping file`);
  }
  if (!mapping.environments[options.to]) {
    throw new Error(`Target environment '${options.to}' not found in mapping file`);
  }

  // Load source and target configurations
  let sourceConfig: ResolvedConfig;
  let targetConfig: ResolvedConfig;

  try {
    sourceConfig = await loadEnvConfig(options.from);
  } catch (error) {
    throw new Error(`Failed to load source environment config: ${error}`);
  }

  try {
    targetConfig = await loadEnvConfig(options.to);
  } catch (error) {
    throw new Error(`Failed to load target environment config: ${error}`);
  }

  // Create ION clients
  const sourceClient = new IONClient(sourceConfig.ionApi);
  const targetClient = new IONClient(targetConfig.ionApi);

  await sourceClient.authenticate();
  await targetClient.authenticate();

  logger.info('Authenticated to both environments');

  // Determine which types to refresh
  let typesToRefresh = REFRESH_ORDER;
  if (options.type) {
    const parsedType = parseComponentType(options.type);
    if (!parsedType) {
      throw new Error(
        `Invalid component type: ${options.type}. Valid types: ${Object.values(ComponentType).join(', ')}`
      );
    }
    typesToRefresh = [parsedType];
  }

  // Collect all components from source
  const allComponents: Array<{
    type: ComponentType;
    component: IONComponentDetail;
  }> = [];

  console.log(`\n=== Fetching components from ${options.from.toUpperCase()} ===\n`);

  for (const type of typesToRefresh) {
    const displayName = COMPONENT_DISPLAY_NAMES[type];
    process.stdout.write(`  ${displayName}...`);

    try {
      const components = await sourceClient.listComponents(type);
      let count = 0;

      for (const comp of components) {
        let detail: IONComponentDetail;

        if (type === ComponentType.SCRIPTS) {
          try {
            detail = await sourceClient.getApprovedScript(comp.name);
          } catch {
            detail = await sourceClient.getComponent(type, comp.name);
          }
        } else {
          detail = await sourceClient.getComponent(type, comp.name);
        }

        allComponents.push({ type, component: detail });
        count++;
      }

      console.log(` ${count} found`);
    } catch (error) {
      console.log(` error: ${error}`);
    }
  }

  console.log(`\nTotal components: ${allComponents.length}\n`);

  // Confirm refresh
  if (!options.force && !options.dryRun) {
    const confirmed = await confirmRefresh(
      options.from,
      options.to,
      allComponents.length
    );
    if (!confirmed) {
      console.log('Refresh cancelled.');
      return;
    }
  }

  // Transform components
  console.log(`\n=== Transforming components ===\n`);

  const transformedComponents: Array<{
    type: ComponentType;
    result: TransformationResult;
  }> = [];

  const credentialsRequired: RefreshSummary['credentialsRequired'] = [];
  const scriptTransformSummary: Array<{
    name: string;
    replacements: number;
    skipped: boolean;
  }> = [];

  for (const { type, component } of allComponents) {
    let result: TransformationResult;

    if (type === ComponentType.CONNECTION_POINTS) {
      result = transformService.transformConnectionPoint(component);

      if (result.credentialFields.length > 0) {
        credentialsRequired.push({
          component: result.transformedName,
          fields: result.credentialFields,
        });
      }
    } else if (type === ComponentType.ENTERPRISE_LOCATIONS) {
      result = transformService.transformEnterpriseConnector(component);
    } else if (type === ComponentType.SCRIPTS) {
      const script = component as ScriptComponent;

      if (options.skipScripts) {
        // Skip script transformation
        result = {
          originalName: script.name,
          transformedName: script.name,
          type: 'Script',
          changes: [],
          warnings: [],
          credentialFields: [],
          transformedData: script,
        };
        scriptTransformSummary.push({
          name: script.name,
          replacements: 0,
          skipped: true,
        });
      } else {
        // Detect hardcoded values
        const detected = transformService.detectHardcodedValues(script.scriptCode || '');

        if (detected.length > 0 && !options.nonInteractive) {
          // Interactive mode
          displayDetectedValues(script.name, detected);

          const action = await promptScriptAction(script.name);

          if (action === 'skip') {
            result = {
              originalName: script.name,
              transformedName: script.name,
              type: 'Script',
              changes: [],
              warnings: [],
              credentialFields: [],
              transformedData: script,
            };
            scriptTransformSummary.push({
              name: script.name,
              replacements: 0,
              skipped: true,
            });
          } else if (action === 'use-defaults') {
            const defaults = transformService.getDefaultSubstitutions();
            result = transformService.transformScript(script, defaults);
            scriptTransformSummary.push({
              name: script.name,
              replacements: result.changes.length,
              skipped: false,
            });
          } else {
            // Replace interactively
            const defaults = transformService.getDefaultSubstitutions();
            const replacements = await promptForReplacements(detected, defaults);
            result = transformService.transformScript(script, replacements);
            scriptTransformSummary.push({
              name: script.name,
              replacements: result.changes.length,
              skipped: false,
            });
          }
        } else if (detected.length > 0 && options.nonInteractive) {
          // Non-interactive: use defaults
          const defaults = transformService.getDefaultSubstitutions();
          result = transformService.transformScript(script, defaults);
          scriptTransformSummary.push({
            name: script.name,
            replacements: result.changes.length,
            skipped: false,
          });
        } else {
          // No hardcoded values detected
          result = {
            originalName: script.name,
            transformedName: script.name,
            type: 'Script',
            changes: [],
            warnings: [],
            credentialFields: [],
            transformedData: script,
          };
          scriptTransformSummary.push({
            name: script.name,
            replacements: 0,
            skipped: false,
          });
        }
      }
    } else {
      // Other component types - no transformation
      result = {
        originalName: component.name,
        transformedName: component.name,
        type: COMPONENT_DISPLAY_NAMES[type],
        changes: [],
        warnings: [],
        credentialFields: [],
        transformedData: component,
      };
    }

    transformedComponents.push({ type, result });

    // Log changes
    if (result.changes.length > 0) {
      logger.info(`Transformed ${result.originalName}`, {
        changes: result.changes.length,
      });
    }
  }

  // Display script transform summary
  if (scriptTransformSummary.length > 0) {
    displayScriptTransformSummary(scriptTransformSummary);
  }

  // Display credential reminder
  displayCredentialReminder(credentialsRequired);

  // Deploy to target
  if (options.dryRun) {
    console.log('\n=== DRY RUN - No changes made ===\n');
    displayRefreshSummary(transformedComponents, credentialsRequired);
    return;
  }

  console.log(`\n=== Deploying to ${options.to.toUpperCase()} ===\n`);

  let deployed = 0;
  let failed = 0;
  let skipped = 0;

  for (const { type, result } of transformedComponents) {
    const displayName = COMPONENT_DISPLAY_NAMES[type];
    const componentData = result.transformedData as IONComponentDetail;

    try {
      // Check if component exists in target
      let exists = false;
      try {
        await targetClient.getComponent(type, result.transformedName);
        exists = true;
      } catch {
        exists = false;
      }

      if (exists) {
        // Update existing
        await targetClient.updateComponent(type, result.transformedName, componentData);
        console.log(`  ✓ ${displayName}/${result.transformedName} (updated)`);
      } else {
        // Create new
        await targetClient.createComponent(type, componentData);
        console.log(`  ✓ ${displayName}/${result.transformedName} (created)`);
      }

      deployed++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`  ✗ ${displayName}/${result.transformedName} - ${errorMessage}`);
      failed++;
    }
  }

  // Final summary
  console.log('\n' + '═'.repeat(70));
  console.log('  Refresh Complete');
  console.log('═'.repeat(70));
  console.log(`  Source: ${options.from.toUpperCase()}`);
  console.log(`  Target: ${options.to.toUpperCase()}`);
  console.log(`  Deployed: ${deployed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Skipped: ${skipped}`);

  if (credentialsRequired.length > 0) {
    console.log(`  Credentials to configure: ${credentialsRequired.length}`);
  }

  console.log('═'.repeat(70) + '\n');

  if (failed > 0) {
    process.exitCode = 1;
  }
}

/**
 * Display refresh summary for dry run
 */
function displayRefreshSummary(
  transformedComponents: Array<{
    type: ComponentType;
    result: TransformationResult;
  }>,
  credentialsRequired: RefreshSummary['credentialsRequired']
): void {
  // Group by type
  const byType = new Map<ComponentType, TransformationResult[]>();

  for (const { type, result } of transformedComponents) {
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type)!.push(result);
  }

  console.log('Components to refresh:\n');

  for (const [type, results] of byType) {
    const displayName = COMPONENT_DISPLAY_NAMES[type];
    console.log(`  ${displayName}: ${results.length}`);

    for (const result of results) {
      const changeInfo =
        result.changes.length > 0 ? ` (${result.changes.length} changes)` : '';
      const renamed =
        result.originalName !== result.transformedName
          ? ` → ${result.transformedName}`
          : '';

      console.log(`    - ${result.originalName}${renamed}${changeInfo}`);
    }
    console.log('');
  }

  if (credentialsRequired.length > 0) {
    console.log('Credentials requiring manual configuration:');
    for (const cred of credentialsRequired) {
      console.log(`  - ${cred.component}: ${cred.fields.join(', ')}`);
    }
    console.log('');
  }
}
