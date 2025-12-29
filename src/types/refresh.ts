/**
 * Environment Refresh Type Definitions
 * Types for the refresh command and transformation service
 */

/**
 * Pattern-based replacement rule
 */
export interface PatternRule {
  /** JSON path to field (supports wildcards like *.readLocation) */
  field: string;
  /** Regex pattern to match */
  pattern: string;
  /** Replacement string (supports $1, $2 capture groups) */
  replacement: string;
  /** Description of what this pattern does */
  description?: string;
}

/**
 * Environment definition in mapping file
 */
export interface EnvironmentDef {
  /** Short identifier (e.g., "prdsyd", "trnsyd") */
  identifier: string;
  /** Display name (e.g., "Production Sydney") */
  displayName: string;
}

/**
 * Connection point transformation configuration
 */
export interface ConnectionPointMapping {
  /** Pattern-based replacements */
  patterns: PatternRule[];
  /** Direct value substitutions by field name */
  substitutions: Record<string, Record<string, string>>;
  /** Fields to remove from exported components */
  removeFields?: string[];
  /** Placeholder for credential fields */
  credentialPlaceholder: string;
}

/**
 * Enterprise connector transformation configuration
 */
export interface EnterpriseConnectorMapping {
  /** Pattern-based replacements */
  patterns: PatternRule[];
  /** Direct value substitutions by field name */
  substitutions: Record<string, Record<string, string>>;
}

/**
 * Script hardcoded value detection pattern
 */
export interface DetectionPattern {
  /** Regex pattern to detect */
  pattern: string;
  /** Type of value (customerCode, warehouseCode, etc.) */
  type: string;
  /** Human-readable description */
  description: string;
}

/**
 * Script transformation configuration
 */
export interface ScriptMapping {
  /** Patterns to detect hardcoded values */
  detectionPatterns: DetectionPattern[];
  /** Default substitutions when not prompted */
  defaultSubstitutions: Record<string, string>;
}

/**
 * Complete environment mapping file structure
 */
export interface EnvMapping {
  /** Schema version */
  version: string;
  /** Description of this mapping */
  description?: string;
  /** Environment definitions */
  environments: Record<string, EnvironmentDef>;
  /** Connection point transformations */
  connectionPoints: ConnectionPointMapping;
  /** Enterprise connector transformations */
  enterpriseConnectors?: EnterpriseConnectorMapping;
  /** Script transformations */
  scripts: ScriptMapping;
}

/**
 * Record of a single change made during transformation
 */
export interface ChangeRecord {
  /** Field path that was changed */
  field: string;
  /** Original value */
  oldValue: string;
  /** New value after transformation */
  newValue: string;
  /** Reason/rule that triggered the change */
  reason: string;
}

/**
 * Result of transforming a single component
 */
export interface TransformationResult {
  /** Original component name */
  originalName: string;
  /** Transformed component name (may differ if renamed) */
  transformedName: string;
  /** Component type */
  type: string;
  /** List of changes made */
  changes: ChangeRecord[];
  /** Warning messages */
  warnings: string[];
  /** Credential fields that need manual configuration */
  credentialFields: string[];
  /** The transformed component data */
  transformedData: unknown;
}

/**
 * Detected hardcoded value in a script
 */
export interface DetectedValue {
  /** The pattern that matched */
  pattern: string;
  /** Type of value */
  type: string;
  /** Description */
  description: string;
  /** Occurrences in the script */
  occurrences: Array<{
    /** Line number (1-based) */
    line: number;
    /** Code context around the match */
    context: string;
    /** The actual matched value */
    match: string;
  }>;
}

/**
 * Result of script transformation
 */
export interface ScriptTransformResult {
  /** Original script code */
  originalCode: string;
  /** Transformed script code */
  transformedCode: string;
  /** Values that were replaced */
  replacements: Array<{
    original: string;
    replacement: string;
    count: number;
  }>;
  /** Values detected but not replaced */
  skipped: DetectedValue[];
}

/**
 * Refresh command options
 */
export interface RefreshCommandOptions {
  /** Path to config file */
  config?: string;
  /** Source environment */
  from: string;
  /** Target environment */
  to: string;
  /** Path to mapping file */
  mappingFile?: string;
  /** Preview without deploying */
  dryRun?: boolean;
  /** Skip script transformation */
  skipScripts?: boolean;
  /** Don't prompt for script values */
  nonInteractive?: boolean;
  /** Skip confirmation prompts */
  force?: boolean;
  /** Only refresh specific component type */
  type?: string;
  /** Output format */
  output: 'text' | 'json';
}

/**
 * Summary of refresh operation
 */
export interface RefreshSummary {
  /** Source environment */
  sourceEnv: string;
  /** Target environment */
  targetEnv: string;
  /** Components processed by type */
  componentsByType: Record<string, number>;
  /** Total components transformed */
  totalTransformed: number;
  /** Total components deployed */
  totalDeployed: number;
  /** Components skipped */
  totalSkipped: number;
  /** Components with errors */
  totalFailed: number;
  /** Credentials requiring manual configuration */
  credentialsRequired: Array<{
    component: string;
    fields: string[];
  }>;
  /** Warnings generated */
  warnings: string[];
}
