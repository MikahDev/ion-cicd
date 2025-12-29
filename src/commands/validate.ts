/**
 * Validate Command
 * Validates ION components before deployment
 */

import { readFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import {
  ComponentType,
  COMPONENT_DISPLAY_NAMES,
  IMPORT_ORDER,
  ScriptComponent,
} from '../types/index.js';
import { IONComponentDetail } from '../types/ion.js';
import { Logger } from '../utils/logger.js';
import { ConfigLoader, ResolvedConfig } from '../config/loader.js';

const logger = new Logger('ValidateCommand');

/**
 * Validate command options from CLI
 */
export interface ValidateCommandOptions {
  /** Path to config file */
  config?: string;
  /** Environment to validate for */
  env?: string;
  /** Component type (optional) */
  type?: string;
  /** Comma-separated component names (optional) */
  items?: string;
  /** Validate all components */
  all?: boolean;
  /** Strict mode - treat warnings as errors */
  strict?: boolean;
  /** Output format */
  output: 'text' | 'json';
}

/**
 * Validation result for a single component
 */
interface ValidationResult {
  name: string;
  type: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
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
 * Validates a script component
 */
function validateScript(data: ScriptComponent, name: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!data.name) {
    errors.push('Missing required field: name');
  }

  if (!data.scriptCode && !existsSync(name)) {
    errors.push('Missing required field: scriptCode');
  }

  // Check for empty script
  if (data.scriptCode && data.scriptCode.trim().length === 0) {
    errors.push('Script code is empty');
  }

  // Check for common issues in Python code
  if (data.scriptCode) {
    // Check for syntax issues (basic)
    if (data.scriptCode.includes('\t') && data.scriptCode.includes('    ')) {
      warnings.push('Mixed tabs and spaces detected - may cause Python indentation errors');
    }

    // Check for potential issues
    if (data.scriptCode.includes('import os') && data.scriptCode.includes('os.system')) {
      warnings.push('os.system() detected - consider using subprocess for better security');
    }

    // Check for hardcoded credentials (basic patterns)
    const credentialPatterns = [
      /password\s*=\s*['"][^'"]+['"]/i,
      /api_key\s*=\s*['"][^'"]+['"]/i,
      /secret\s*=\s*['"][^'"]+['"]/i,
    ];
    for (const pattern of credentialPatterns) {
      if (pattern.test(data.scriptCode)) {
        warnings.push('Potential hardcoded credential detected');
        break;
      }
    }
  }

  // Check usedLibraries format
  if (data.usedLibraries) {
    if (!Array.isArray(data.usedLibraries)) {
      errors.push('usedLibraries must be an array');
    }
  }

  // Check variables
  if (data.inputVariables) {
    if (!Array.isArray(data.inputVariables)) {
      errors.push('inputVariables must be an array');
    }
  }

  if (data.outputVariables) {
    if (!Array.isArray(data.outputVariables)) {
      errors.push('outputVariables must be an array');
    }
  }

  return {
    name: data.name || name,
    type: 'Script',
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates a generic component (dataflow, mapping, etc.)
 */
function validateGenericComponent(
  data: IONComponentDetail,
  name: string,
  displayType: string
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!data.name) {
    errors.push('Missing required field: name');
  }

  // Check for name mismatch with filename
  if (data.name && data.name !== name) {
    warnings.push(`Component name "${data.name}" doesn't match filename "${name}"`);
  }

  // Type-specific validations
  if (displayType === 'Document flow') {
    // Dataflow validations
    const dataflow = data as Record<string, unknown>;
    if (!dataflow.elements && !dataflow.nodes) {
      warnings.push('Dataflow appears to have no elements/nodes defined');
    }
  }

  if (displayType === 'Mapping') {
    // Mapping validations
    const mapping = data as Record<string, unknown>;
    if (!mapping.mappingModels) {
      warnings.push('Mapping has no mappingModels defined');
    }
  }

  if (displayType === 'Connection point') {
    // Connection point validations
    const cp = data as Record<string, unknown>;
    if (!cp.type) {
      errors.push('Connection point missing type');
    }
  }

  return {
    name: data.name || name,
    type: displayType,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates dependency references
 */
async function validateDependencies(
  componentsPath: string,
  results: ValidationResult[]
): Promise<void> {
  // Build a set of available component names by type
  const available = new Map<string, Set<string>>();

  for (const result of results) {
    if (!available.has(result.type)) {
      available.set(result.type, new Set());
    }
    available.get(result.type)!.add(result.name);
  }

  // Check for missing dependencies (this is a simplified check)
  for (const result of results) {
    if (result.type === 'Script') {
      // Check if referenced libraries exist
      const scriptPath = join(componentsPath, 'Script', `${result.name}.meta.json`);
      if (existsSync(scriptPath)) {
        try {
          const content = await readFile(scriptPath, 'utf-8');
          const metadata = JSON.parse(content);
          if (metadata.usedLibraries) {
            const librarySet = available.get('Library') || new Set();
            for (const lib of metadata.usedLibraries) {
              if (!librarySet.has(lib)) {
                result.warnings.push(`Referenced library "${lib}" not found in local components`);
              }
            }
          }
        } catch {
          // Ignore read errors
        }
      }
    }
  }
}

/**
 * Executes the validate command
 */
export async function executeValidate(options: ValidateCommandOptions): Promise<void> {
  logger.info('Starting validation', {
    all: options.all ?? false,
    strict: options.strict ?? false,
  });

  // Load configuration
  const loader = new ConfigLoader();
  let resolved: ResolvedConfig;

  try {
    resolved = await loader.resolve({
      configPath: options.config,
      env: options.env,
    });
  } catch (error) {
    logger.error('Failed to load config', { error: String(error) });
    throw new Error(`Failed to load configuration: ${error}`);
  }

  const componentsPath = resolved.componentsPath;

  if (!existsSync(componentsPath)) {
    throw new Error(`Components folder not found: ${componentsPath}`);
  }

  // Require explicit selection
  if (!options.all && !options.type && !options.items) {
    throw new Error('Specify --all, --type, or --items');
  }

  const results: ValidationResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  // Read component folders
  const folders = await readdir(componentsPath);

  for (const folder of folders) {
    const folderPath = join(componentsPath, folder);
    const folderStat = await stat(folderPath);

    if (!folderStat.isDirectory()) continue;

    const type = DISPLAY_NAME_TO_TYPE[folder];
    if (!type) continue;

    // Filter by type if specified
    if (options.type && type !== options.type) continue;

    const files = await readdir(folderPath);

    for (const file of files) {
      // Handle scripts (look for .py files)
      if (type === ComponentType.SCRIPTS) {
        if (!file.endsWith('.py')) continue;

        const name = basename(file, '.py');
        const metaPath = join(folderPath, `${name}.meta.json`);

        // Filter by items if specified
        if (options.items) {
          const itemList = options.items.split(',').map((i) => i.trim().toLowerCase());
          if (!itemList.includes(name.toLowerCase())) continue;
        }

        try {
          const pyPath = join(folderPath, file);
          const scriptCode = await readFile(pyPath, 'utf-8');

          let metadata: Record<string, unknown> = { name };
          if (existsSync(metaPath)) {
            const metaContent = await readFile(metaPath, 'utf-8');
            metadata = JSON.parse(metaContent);
          }

          const data: ScriptComponent = {
            ...metadata,
            name,
            scriptCode,
          } as ScriptComponent;

          const result = validateScript(data, name);
          results.push(result);

          totalErrors += result.errors.length;
          totalWarnings += result.warnings.length;
        } catch (error) {
          results.push({
            name,
            type: folder,
            valid: false,
            errors: [`Failed to read component: ${error}`],
            warnings: [],
          });
          totalErrors++;
        }
      } else {
        // Other components use .json format
        if (!file.endsWith('.json')) continue;

        const name = basename(file, '.json');

        // Filter by items if specified
        if (options.items) {
          const itemList = options.items.split(',').map((i) => i.trim().toLowerCase());
          if (!itemList.includes(name.toLowerCase())) continue;
        }

        try {
          const filePath = join(folderPath, file);
          const content = await readFile(filePath, 'utf-8');
          const data = JSON.parse(content) as IONComponentDetail;

          const result = validateGenericComponent(data, name, folder);
          results.push(result);

          totalErrors += result.errors.length;
          totalWarnings += result.warnings.length;
        } catch (error) {
          results.push({
            name,
            type: folder,
            valid: false,
            errors: [`Failed to parse JSON: ${error}`],
            warnings: [],
          });
          totalErrors++;
        }
      }
    }
  }

  // Validate dependencies across components
  await validateDependencies(componentsPath, results);

  // Recount after dependency validation
  totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);

  // Output results
  if (options.output === 'json') {
    const output = {
      success: totalErrors === 0 && (!options.strict || totalWarnings === 0),
      components: results.length,
      errors: totalErrors,
      warnings: totalWarnings,
      results,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(output, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n=== Component Validation ===\n`);
    // eslint-disable-next-line no-console
    console.log(`Components: ${results.length}`);
    // eslint-disable-next-line no-console
    console.log(`Errors: ${totalErrors}`);
    // eslint-disable-next-line no-console
    console.log(`Warnings: ${totalWarnings}\n`);

    // Group by type
    const byType = new Map<string, ValidationResult[]>();
    for (const result of results) {
      if (!byType.has(result.type)) {
        byType.set(result.type, []);
      }
      byType.get(result.type)!.push(result);
    }

    for (const type of IMPORT_ORDER) {
      const displayName = COMPONENT_DISPLAY_NAMES[type];
      const typeResults = byType.get(displayName);
      if (!typeResults || typeResults.length === 0) continue;

      // eslint-disable-next-line no-console
      console.log(`${displayName}:`);

      for (const result of typeResults) {
        const status = result.valid ? '✓' : '✗';
        const warningCount = result.warnings.length > 0 ? ` (${result.warnings.length} warnings)` : '';
        // eslint-disable-next-line no-console
        console.log(`  ${status} ${result.name}${warningCount}`);

        for (const error of result.errors) {
          // eslint-disable-next-line no-console
          console.log(`    ✗ ${error}`);
        }

        for (const warning of result.warnings) {
          // eslint-disable-next-line no-console
          console.log(`    ⚠ ${warning}`);
        }
      }
      // eslint-disable-next-line no-console
      console.log('');
    }

    if (totalErrors === 0 && totalWarnings === 0) {
      // eslint-disable-next-line no-console
      console.log('✓ All components valid\n');
    }
  }

  // Exit with error if validation failed
  if (totalErrors > 0 || (options.strict && totalWarnings > 0)) {
    process.exitCode = 1;
  }
}
