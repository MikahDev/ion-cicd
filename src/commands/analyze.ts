/**
 * Analyze Command
 * Analyzes a dataflow's dependencies and checks if they exist in target environment
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { IONClient } from '../clients/ion-client.js';
import { ComponentType } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { ConfigLoader, ResolvedConfig } from '../config/loader.js';

const logger = new Logger('AnalyzeCommand');

/**
 * Dependency found in a dataflow
 */
interface Dependency {
  type: 'connectionPoint' | 'script' | 'mapping' | 'document';
  name: string;
  activity?: string;
  details?: string;
}

/**
 * Dependency check result
 */
interface DependencyCheck {
  dependency: Dependency;
  existsInSource: boolean;
  existsInTarget: boolean;
}

/**
 * Analyze command options
 */
export interface AnalyzeCommandOptions {
  config?: string;
  /** Dataflow name to analyze */
  dataflow: string;
  /** Source environment */
  from?: string;
  /** Target environment to check */
  to: string;
  /** Output format */
  output: 'text' | 'json';
}

/**
 * Extract dependencies from a dataflow JSON
 */
function extractDependencies(dataflow: Record<string, unknown>): Dependency[] {
  const dependencies: Dependency[] = [];
  const seen = new Set<string>();

  function addDependency(dep: Dependency) {
    const key = `${dep.type}:${dep.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      dependencies.push(dep);
    }
  }

  function traverse(obj: unknown, activityName?: string): void {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach((item) => traverse(item, activityName));
      return;
    }

    const record = obj as Record<string, unknown>;

    // Get activity name if present
    const currentActivity = (record.name as string) || activityName;

    // Check for connection points
    if (record.ionApiConnectionPoint) {
      addDependency({
        type: 'connectionPoint',
        name: record.ionApiConnectionPoint as string,
        activity: currentActivity,
        details: 'ION API',
      });
    }

    if (record.applicationConnectionPoints) {
      const cp = record.applicationConnectionPoints as string;
      addDependency({
        type: 'connectionPoint',
        name: cp,
        activity: currentActivity,
        details: 'Application',
      });
    }

    if (record.fileConnectionPoint) {
      addDependency({
        type: 'connectionPoint',
        name: record.fileConnectionPoint as string,
        activity: currentActivity,
        details: 'File',
      });
    }

    // Check for scripts
    if (record.scriptName) {
      addDependency({
        type: 'script',
        name: record.scriptName as string,
        activity: currentActivity,
      });
    }

    // Check for mappings
    if (record.mapperName) {
      addDependency({
        type: 'mapping',
        name: record.mapperName as string,
        activity: currentActivity,
      });
    }

    // Check for documents (BODs)
    if (record.activityDocuments && Array.isArray(record.activityDocuments)) {
      for (const doc of record.activityDocuments) {
        if (doc.noun && doc.verb) {
          addDependency({
            type: 'document',
            name: `${doc.verb}.${doc.noun}`,
            activity: currentActivity,
            details: doc.documentType || 'BOD',
          });
        }
      }
    }

    // Check document mappings
    if (record.documentMappings && Array.isArray(record.documentMappings)) {
      for (const mapping of record.documentMappings) {
        if (mapping.inputDocument) {
          addDependency({
            type: 'document',
            name: mapping.inputDocument as string,
            activity: currentActivity,
            details: `Input (${mapping.inputDocumentType || 'BOD'})`,
          });
        }
        if (mapping.outputDocument) {
          addDependency({
            type: 'document',
            name: mapping.outputDocument as string,
            activity: currentActivity,
            details: `Output (${mapping.outputDocumentType || 'BOD'})`,
          });
        }
      }
    }

    // Recurse into all properties
    for (const value of Object.values(record)) {
      traverse(value, currentActivity);
    }
  }

  traverse(dataflow);
  return dependencies;
}

/**
 * Check if a component exists in an environment
 */
async function checkComponentExists(
  client: IONClient,
  type: ComponentType,
  name: string
): Promise<boolean> {
  try {
    await client.getComponent(type, name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load environment configuration
 */
async function loadEnvConfig(env: string): Promise<ResolvedConfig> {
  const loader = new ConfigLoader();
  return loader.resolve({ env });
}

/**
 * Execute the analyze command
 */
export async function executeAnalyze(options: AnalyzeCommandOptions): Promise<void> {
  logger.info('Analyzing dataflow', { dataflow: options.dataflow, target: options.to });

  // Load dataflow from local files
  const componentsPath = './ion-components';
  const dataflowPath = join(componentsPath, 'Document flow', `${options.dataflow}.json`);

  if (!existsSync(dataflowPath)) {
    throw new Error(`Dataflow not found: ${dataflowPath}`);
  }

  const dataflowContent = await readFile(dataflowPath, 'utf-8');
  const dataflow = JSON.parse(dataflowContent);

  console.log(`\n=== Analyzing: ${options.dataflow} ===\n`);
  console.log(`Description: ${dataflow.description || 'N/A'}`);
  console.log(`Status: ${dataflow.documentFlowStatus || 'N/A'}\n`);

  // Extract dependencies
  const dependencies = extractDependencies(dataflow);

  console.log(`Found ${dependencies.length} dependencies:\n`);

  // Group by type
  const byType = new Map<string, Dependency[]>();
  for (const dep of dependencies) {
    if (!byType.has(dep.type)) {
      byType.set(dep.type, []);
    }
    byType.get(dep.type)!.push(dep);
  }

  // Display dependencies
  for (const [type, deps] of byType) {
    console.log(`  ${type.charAt(0).toUpperCase() + type.slice(1)}s:`);
    for (const dep of deps) {
      const details = dep.details ? ` (${dep.details})` : '';
      const activity = dep.activity ? ` - used by "${dep.activity}"` : '';
      console.log(`    - ${dep.name}${details}${activity}`);
    }
    console.log('');
  }

  // Check target environment
  console.log(`\n=== Checking Target Environment: ${options.to.toUpperCase()} ===\n`);

  let targetConfig: ResolvedConfig;
  let targetClient: IONClient;

  try {
    targetConfig = await loadEnvConfig(options.to);
    targetClient = new IONClient(targetConfig.ionApi);
    await targetClient.authenticate();
  } catch (error) {
    console.log(`❌ Failed to connect to ${options.to}: ${error}`);
    console.log('\nCannot check dependencies without target environment access.\n');
    return;
  }

  const results: DependencyCheck[] = [];
  let missingCount = 0;
  let existsCount = 0;
  let unknownCount = 0;

  for (const dep of dependencies) {
    let exists = false;
    let checkable = true;

    switch (dep.type) {
      case 'connectionPoint':
        exists = await checkComponentExists(
          targetClient,
          ComponentType.CONNECTION_POINTS,
          dep.name
        );
        break;
      case 'script':
        exists = await checkComponentExists(targetClient, ComponentType.SCRIPTS, dep.name);
        break;
      case 'mapping':
        exists = await checkComponentExists(targetClient, ComponentType.MAPPINGS, dep.name);
        break;
      case 'document':
        // Documents are registered through connection points, harder to check directly
        checkable = false;
        break;
    }

    if (checkable) {
      if (exists) {
        existsCount++;
        console.log(`  ✓ ${dep.type}: ${dep.name}`);
      } else {
        missingCount++;
        console.log(`  ✗ ${dep.type}: ${dep.name} - MISSING`);
      }
    } else {
      unknownCount++;
      console.log(`  ? ${dep.type}: ${dep.name} - (registered via connection point)`);
    }

    results.push({
      dependency: dep,
      existsInSource: true,
      existsInTarget: exists,
    });
  }

  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log('  Summary');
  console.log('═'.repeat(50));
  console.log(`  ✓ Exists in ${options.to.toUpperCase()}: ${existsCount}`);
  console.log(`  ✗ Missing: ${missingCount}`);
  console.log(`  ? Cannot check: ${unknownCount}`);
  console.log('═'.repeat(50));

  if (missingCount > 0) {
    console.log('\n⚠️  Missing dependencies must be created before deploying this dataflow.\n');

    // Show what needs to be done
    console.log('To deploy this dataflow, you need to:');
    let step = 1;

    const missingCPs = dependencies.filter(
      (d) => d.type === 'connectionPoint' && !results.find((r) => r.dependency === d)?.existsInTarget
    );
    if (missingCPs.length > 0) {
      console.log(`\n${step}. Create connection points in ${options.to.toUpperCase()} (via ION Desk):`);
      for (const cp of missingCPs) {
        console.log(`   - ${cp.name} (${cp.details})`);
      }
      step++;
    }

    const missingScripts = dependencies.filter(
      (d) => d.type === 'script' && !results.find((r) => r.dependency === d)?.existsInTarget
    );
    if (missingScripts.length > 0) {
      console.log(`\n${step}. Deploy scripts:`);
      console.log(`   ion-cicd --env ${options.to} deploy -t scripts -i ${missingScripts.map((s) => s.name).join(',')}`);
      step++;
    }

    const missingMappings = dependencies.filter(
      (d) => d.type === 'mapping' && !results.find((r) => r.dependency === d)?.existsInTarget
    );
    if (missingMappings.length > 0) {
      console.log(`\n${step}. Deploy mappings:`);
      console.log(`   ion-cicd --env ${options.to} deploy -t mappings -i ${missingMappings.map((m) => m.name).join(',')}`);
      step++;
    }

    console.log(`\n${step}. Deploy the dataflow:`);
    console.log(`   ion-cicd --env ${options.to} deploy -t dataflows -i ${options.dataflow}`);
  } else {
    console.log('\n✓ All checkable dependencies exist. Ready to deploy:\n');
    console.log(`   ion-cicd --env ${options.to} deploy -t dataflows -i ${options.dataflow}\n`);
  }

  // JSON output
  if (options.output === 'json') {
    console.log(JSON.stringify({ dataflow: options.dataflow, dependencies, results }, null, 2));
  }
}
