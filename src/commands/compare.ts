/**
 * Compare Command
 * Compares ION components between environments
 */

import { IONClient } from '../clients/ion-client.js';
import { ComponentType, COMPONENT_DISPLAY_NAMES } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { ConfigLoader, ResolvedConfig } from '../config/loader.js';

const logger = new Logger('CompareCommand');

/**
 * Compare command options
 */
export interface CompareCommandOptions {
  config?: string;
  /** Component type */
  type: string;
  /** Component name */
  name: string;
  /** First environment */
  env1: string;
  /** Second environment */
  env2: string;
  /** Output format */
  output: 'text' | 'json';
}

/**
 * Parse component type from string
 */
function parseComponentType(typeStr: string): ComponentType | undefined {
  const normalised = typeStr.toLowerCase();
  // Handle common aliases
  const aliases: Record<string, string> = {
    'cp': 'connectionpoints',
    'connection-point': 'connectionpoints',
    'connection-points': 'connectionpoints',
    'connectionpoint': 'connectionpoints',
    'script': 'scripts',
    'mapping': 'mappings',
    'dataflow': 'dataflows',
    'workflow': 'workflows',
  };
  const mapped = aliases[normalised] || normalised;
  return Object.values(ComponentType).find((t) => t === mapped);
}

/**
 * Load environment configuration
 */
async function loadEnvConfig(env: string): Promise<ResolvedConfig> {
  const loader = new ConfigLoader();
  return loader.resolve({ env });
}

/**
 * Deep diff two objects
 */
function deepDiff(
  obj1: unknown,
  obj2: unknown,
  path: string = ''
): Array<{ path: string; env1: unknown; env2: unknown }> {
  const diffs: Array<{ path: string; env1: unknown; env2: unknown }> = [];

  // Skip runtime-specific fields
  const skipFields = ['runtimeProcessId', 'lastUpdatedBy', 'lastUpdatedOn'];

  if (obj1 === obj2) {
    return diffs;
  }

  if (typeof obj1 !== typeof obj2) {
    diffs.push({ path: path || 'root', env1: obj1, env2: obj2 });
    return diffs;
  }

  if (obj1 === null || obj2 === null) {
    if (obj1 !== obj2) {
      diffs.push({ path: path || 'root', env1: obj1, env2: obj2 });
    }
    return diffs;
  }

  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    const maxLen = Math.max(obj1.length, obj2.length);
    for (let i = 0; i < maxLen; i++) {
      const itemPath = `${path}[${i}]`;
      if (i >= obj1.length) {
        diffs.push({ path: itemPath, env1: undefined, env2: obj2[i] });
      } else if (i >= obj2.length) {
        diffs.push({ path: itemPath, env1: obj1[i], env2: undefined });
      } else {
        diffs.push(...deepDiff(obj1[i], obj2[i], itemPath));
      }
    }
    return diffs;
  }

  if (typeof obj1 === 'object' && typeof obj2 === 'object') {
    const record1 = obj1 as Record<string, unknown>;
    const record2 = obj2 as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(record1), ...Object.keys(record2)]);

    for (const key of allKeys) {
      if (skipFields.includes(key)) continue;

      const keyPath = path ? `${path}.${key}` : key;
      if (!(key in record1)) {
        diffs.push({ path: keyPath, env1: undefined, env2: record2[key] });
      } else if (!(key in record2)) {
        diffs.push({ path: keyPath, env1: record1[key], env2: undefined });
      } else {
        diffs.push(...deepDiff(record1[key], record2[key], keyPath));
      }
    }
    return diffs;
  }

  // Primitive types
  if (obj1 !== obj2) {
    diffs.push({ path: path || 'root', env1: obj1, env2: obj2 });
  }

  return diffs;
}

/**
 * Format a value for display
 */
function formatValue(value: unknown, maxLen: number = 60): string {
  if (value === undefined) return '(missing)';
  if (value === null) return 'null';

  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (str.length > maxLen) {
    return str.substring(0, maxLen - 3) + '...';
  }
  return str;
}

/**
 * Compare document groups in connection points
 */
function compareDocumentGroups(
  groups1: unknown[],
  groups2: unknown[],
  env1Name: string,
  env2Name: string
): void {
  const getCallName = (group: unknown): string => {
    const g = group as Record<string, unknown>;
    const props = g.documentGroupProperties as Array<{ name: string; value: string }>;
    const callNameProp = props?.find((p) => p.name === 'callName');
    return callNameProp?.value || 'Unknown';
  };

  const map1 = new Map(groups1.map((g) => [getCallName(g), g]));
  const map2 = new Map(groups2.map((g) => [getCallName(g), g]));

  const allCallNames = new Set([...map1.keys(), ...map2.keys()]);

  console.log('\n  Document Groups (API Calls):');
  console.log('  ' + '─'.repeat(68));

  for (const callName of allCallNames) {
    const in1 = map1.has(callName);
    const in2 = map2.has(callName);

    if (in1 && in2) {
      // Both have it - check for differences
      const group1 = map1.get(callName) as Record<string, unknown>;
      const group2 = map2.get(callName) as Record<string, unknown>;
      const diffs = deepDiff(group1, group2, '');

      if (diffs.length === 0) {
        console.log(`  ✓ ${callName} - identical`);
      } else {
        console.log(`  ⚠ ${callName} - ${diffs.length} difference(s)`);
        // Show key differences
        for (const diff of diffs.slice(0, 3)) {
          const path = diff.path.replace(/^documentGroupProperties\[\d+\]\./, '');
          console.log(`      ${path}:`);
          console.log(`        ${env1Name}: ${formatValue(diff.env1, 50)}`);
          console.log(`        ${env2Name}: ${formatValue(diff.env2, 50)}`);
        }
        if (diffs.length > 3) {
          console.log(`      ... and ${diffs.length - 3} more differences`);
        }
      }
    } else if (in1 && !in2) {
      console.log(`  ✗ ${callName} - only in ${env1Name}`);
    } else {
      console.log(`  + ${callName} - only in ${env2Name}`);
    }
  }
}

/**
 * Execute the compare command
 */
export async function executeCompare(options: CompareCommandOptions): Promise<void> {
  logger.info('Comparing component', {
    type: options.type,
    name: options.name,
    env1: options.env1,
    env2: options.env2,
  });

  const componentType = parseComponentType(options.type);
  if (!componentType) {
    throw new Error(
      `Invalid component type: ${options.type}. Valid types: ${Object.values(ComponentType).join(', ')}`
    );
  }

  const displayName = COMPONENT_DISPLAY_NAMES[componentType];

  console.log(`\n=== Comparing ${displayName}: ${options.name} ===\n`);
  console.log(`  ${options.env1.toUpperCase()} vs ${options.env2.toUpperCase()}\n`);

  // Connect to both environments
  let config1: ResolvedConfig;
  let config2: ResolvedConfig;
  let client1: IONClient;
  let client2: IONClient;

  try {
    config1 = await loadEnvConfig(options.env1);
    client1 = new IONClient(config1.ionApi);
    await client1.authenticate();
    console.log(`  ✓ Connected to ${options.env1.toUpperCase()}`);
  } catch (error) {
    throw new Error(`Failed to connect to ${options.env1}: ${error}`);
  }

  try {
    config2 = await loadEnvConfig(options.env2);
    client2 = new IONClient(config2.ionApi);
    await client2.authenticate();
    console.log(`  ✓ Connected to ${options.env2.toUpperCase()}`);
  } catch (error) {
    throw new Error(`Failed to connect to ${options.env2}: ${error}`);
  }

  // Fetch component from both environments
  let component1: Record<string, unknown> | null = null;
  let component2: Record<string, unknown> | null = null;

  try {
    component1 = (await client1.getComponent(componentType, options.name)) as Record<
      string,
      unknown
    >;
    console.log(`  ✓ Found in ${options.env1.toUpperCase()}`);
  } catch {
    console.log(`  ✗ Not found in ${options.env1.toUpperCase()}`);
  }

  try {
    component2 = (await client2.getComponent(componentType, options.name)) as Record<
      string,
      unknown
    >;
    console.log(`  ✓ Found in ${options.env2.toUpperCase()}`);
  } catch {
    console.log(`  ✗ Not found in ${options.env2.toUpperCase()}`);
  }

  if (!component1 && !component2) {
    console.log('\n  Component not found in either environment.\n');
    return;
  }

  if (!component1) {
    console.log(`\n  Component only exists in ${options.env2.toUpperCase()}.`);
    console.log(`  Use 'ion-cicd refresh' to copy it.\n`);
    return;
  }

  if (!component2) {
    console.log(`\n  Component only exists in ${options.env1.toUpperCase()}.`);
    console.log(`  Use 'ion-cicd refresh' to copy it.\n`);
    return;
  }

  // Compare the components
  console.log('\n' + '═'.repeat(70));
  console.log('  Comparison Results');
  console.log('═'.repeat(70));

  // For connection points, do a special comparison of document groups
  if (
    componentType === ComponentType.CONNECTION_POINTS &&
    component1.documentGroups &&
    component2.documentGroups
  ) {
    compareDocumentGroups(
      component1.documentGroups as unknown[],
      component2.documentGroups as unknown[],
      options.env1.toUpperCase(),
      options.env2.toUpperCase()
    );
  }

  // General diff
  const diffs = deepDiff(component1, component2, '');

  // Filter out document groups if we already displayed them specially
  const filteredDiffs =
    componentType === ComponentType.CONNECTION_POINTS
      ? diffs.filter((d) => !d.path.startsWith('documentGroups'))
      : diffs;

  if (filteredDiffs.length === 0 && diffs.length === 0) {
    console.log('\n  ✓ Components are identical (excluding runtime fields)\n');
  } else {
    console.log('\n  Other Differences:');
    console.log('  ' + '─'.repeat(68));

    for (const diff of filteredDiffs.slice(0, 20)) {
      console.log(`  ${diff.path}:`);
      console.log(`    ${options.env1.toUpperCase()}: ${formatValue(diff.env1)}`);
      console.log(`    ${options.env2.toUpperCase()}: ${formatValue(diff.env2)}`);
    }

    if (filteredDiffs.length > 20) {
      console.log(`\n  ... and ${filteredDiffs.length - 20} more differences`);
    }

    console.log(
      `\n  Total differences: ${diffs.length} (excluding runtime fields: runtimeProcessId, lastUpdatedBy, lastUpdatedOn)`
    );
  }

  console.log('═'.repeat(70) + '\n');

  // JSON output
  if (options.output === 'json') {
    console.log(
      JSON.stringify(
        {
          component: options.name,
          type: componentType,
          env1: options.env1,
          env2: options.env2,
          differences: diffs,
        },
        null,
        2
      )
    );
  }
}
