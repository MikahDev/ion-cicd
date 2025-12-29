/**
 * Transformation Service
 * Handles component value substitution for environment refresh
 */

import {
  EnvMapping,
  PatternRule,
  ChangeRecord,
  TransformationResult,
  DetectedValue,
  ScriptTransformResult,
} from '../types/refresh.js';
import { IONComponentDetail, ScriptComponent } from '../types/index.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('TransformationService');

/**
 * Known credential field names
 */
const CREDENTIAL_FIELDS = [
  'password',
  'secret',
  'apiKey',
  'apikey',
  'api_key',
  'serviceAccount',
  'accessKey',
  'secretKey',
  'token',
  'credential',
  'privateKey',
];

/**
 * Service for transforming ION components between environments
 */
export class TransformationService {
  constructor(private mapping: EnvMapping) {}

  /**
   * Transform a connection point for target environment
   */
  transformConnectionPoint(component: IONComponentDetail): TransformationResult {
    const changes: ChangeRecord[] = [];
    const warnings: string[] = [];
    const credentialFields: string[] = [];

    // Deep clone to avoid modifying original
    let transformed = JSON.parse(JSON.stringify(component)) as IONComponentDetail;
    const originalName = transformed.name;

    // Apply pattern-based replacements
    for (const rule of this.mapping.connectionPoints.patterns) {
      const result = this.applyPatternToComponent(transformed, rule);
      transformed = result.component;
      changes.push(...result.changes);
    }

    // Apply direct substitutions
    const subResult = this.applySubstitutions(
      transformed,
      this.mapping.connectionPoints.substitutions
    );
    transformed = subResult.component;
    changes.push(...subResult.changes);

    // Handle credential fields
    const credResult = this.handleCredentials(
      transformed,
      this.mapping.connectionPoints.credentialPlaceholder
    );
    transformed = credResult.component;
    credentialFields.push(...credResult.credentialFields);

    if (credentialFields.length > 0) {
      warnings.push(`${credentialFields.length} credential field(s) require manual configuration`);
    }

    // Remove specified fields
    if (this.mapping.connectionPoints.removeFields) {
      for (const field of this.mapping.connectionPoints.removeFields) {
        if (field in transformed) {
          delete (transformed as Record<string, unknown>)[field];
          changes.push({
            field,
            oldValue: '[removed]',
            newValue: '',
            reason: 'Field removal rule',
          });
        }
      }
    }

    return {
      originalName,
      transformedName: transformed.name,
      type: 'Connection point',
      changes,
      warnings,
      credentialFields,
      transformedData: transformed,
    };
  }

  /**
   * Transform an enterprise connector for target environment
   */
  transformEnterpriseConnector(component: IONComponentDetail): TransformationResult {
    const changes: ChangeRecord[] = [];
    const warnings: string[] = [];
    const credentialFields: string[] = [];

    let transformed = JSON.parse(JSON.stringify(component)) as IONComponentDetail;
    const originalName = transformed.name;

    if (this.mapping.enterpriseConnectors) {
      // Apply pattern-based replacements
      for (const rule of this.mapping.enterpriseConnectors.patterns) {
        const result = this.applyPatternToComponent(transformed, rule);
        transformed = result.component;
        changes.push(...result.changes);
      }

      // Apply direct substitutions
      const subResult = this.applySubstitutions(
        transformed,
        this.mapping.enterpriseConnectors.substitutions
      );
      transformed = subResult.component;
      changes.push(...subResult.changes);
    }

    return {
      originalName,
      transformedName: transformed.name,
      type: 'Enterprise Connector',
      changes,
      warnings,
      credentialFields,
      transformedData: transformed,
    };
  }

  /**
   * Detect hardcoded values in script code
   */
  detectHardcodedValues(scriptCode: string): DetectedValue[] {
    const detected: DetectedValue[] = [];
    const lines = scriptCode.split('\n');

    for (const pattern of this.mapping.scripts.detectionPatterns) {
      const regex = new RegExp(pattern.pattern, 'g');
      const occurrences: DetectedValue['occurrences'] = [];

      lines.forEach((line, index) => {
        let match;
        while ((match = regex.exec(line)) !== null) {
          // Get context (the line with some surrounding)
          const contextStart = Math.max(0, index - 1);
          const contextEnd = Math.min(lines.length, index + 2);
          const context = lines.slice(contextStart, contextEnd).join('\n');

          occurrences.push({
            line: index + 1,
            context,
            match: match[0],
          });
        }
        // Reset regex lastIndex for next line
        regex.lastIndex = 0;
      });

      if (occurrences.length > 0) {
        detected.push({
          pattern: pattern.pattern,
          type: pattern.type,
          description: pattern.description,
          occurrences,
        });
      }
    }

    return detected;
  }

  /**
   * Apply replacements to script code
   */
  applyScriptReplacements(
    scriptCode: string,
    replacements: Record<string, string>
  ): ScriptTransformResult {
    let transformedCode = scriptCode;
    const appliedReplacements: ScriptTransformResult['replacements'] = [];

    for (const [original, replacement] of Object.entries(replacements)) {
      // Escape special regex characters in the original value
      const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedOriginal, 'g');
      const matches = transformedCode.match(regex);
      const count = matches ? matches.length : 0;

      if (count > 0) {
        transformedCode = transformedCode.replace(regex, replacement);
        appliedReplacements.push({ original, replacement, count });
      }
    }

    return {
      originalCode: scriptCode,
      transformedCode,
      replacements: appliedReplacements,
      skipped: [],
    };
  }

  /**
   * Transform a script component
   */
  transformScript(
    script: ScriptComponent,
    replacements: Record<string, string>
  ): TransformationResult {
    const changes: ChangeRecord[] = [];
    const warnings: string[] = [];

    const transformed = JSON.parse(JSON.stringify(script)) as ScriptComponent;
    const originalName = transformed.name;

    // Apply replacements to script code
    if (transformed.scriptCode && Object.keys(replacements).length > 0) {
      const result = this.applyScriptReplacements(transformed.scriptCode, replacements);
      transformed.scriptCode = result.transformedCode;

      for (const rep of result.replacements) {
        changes.push({
          field: 'scriptCode',
          oldValue: rep.original,
          newValue: rep.replacement,
          reason: `Replaced ${rep.count} occurrence(s)`,
        });
      }
    }

    return {
      originalName,
      transformedName: transformed.name,
      type: 'Script',
      changes,
      warnings,
      credentialFields: [],
      transformedData: transformed,
    };
  }

  /**
   * Apply a pattern rule to a component
   */
  private applyPatternToComponent(
    component: IONComponentDetail,
    rule: PatternRule
  ): { component: IONComponentDetail; changes: ChangeRecord[] } {
    const changes: ChangeRecord[] = [];
    const transformed = JSON.parse(JSON.stringify(component));

    // Handle simple field paths
    if (!rule.field.includes('*')) {
      const value = this.getNestedValue(transformed, rule.field);
      if (typeof value === 'string') {
        const regex = new RegExp(rule.pattern);
        if (regex.test(value)) {
          const newValue = value.replace(regex, rule.replacement);
          this.setNestedValue(transformed, rule.field, newValue);
          changes.push({
            field: rule.field,
            oldValue: value,
            newValue,
            reason: rule.description || `Pattern: ${rule.pattern}`,
          });
        }
      }
    } else {
      // Handle wildcard paths like "documentGroups.*.documents.*.documentProperties.readLocation"
      const wildcardChanges = this.applyPatternWithWildcards(transformed, rule);
      changes.push(...wildcardChanges);
    }

    return { component: transformed, changes };
  }

  /**
   * Apply pattern with wildcard path support
   */
  private applyPatternWithWildcards(
    obj: Record<string, unknown>,
    rule: PatternRule,
    currentPath: string = ''
  ): ChangeRecord[] {
    const changes: ChangeRecord[] = [];
    const pathParts = rule.field.split('.');

    const traverse = (
      current: unknown,
      remainingPath: string[],
      pathSoFar: string
    ): void => {
      if (remainingPath.length === 0) {
        return;
      }

      const [part, ...rest] = remainingPath;

      if (part === '*') {
        // Wildcard - iterate over array or object
        if (Array.isArray(current)) {
          current.forEach((item, index) => {
            traverse(item, rest, `${pathSoFar}[${index}]`);
          });
        } else if (current && typeof current === 'object') {
          for (const key of Object.keys(current)) {
            traverse(
              (current as Record<string, unknown>)[key],
              rest,
              `${pathSoFar}.${key}`
            );
          }
        }
      } else if (rest.length === 0) {
        // Last part - apply pattern
        if (current && typeof current === 'object' && part in current) {
          const value = (current as Record<string, unknown>)[part];
          if (typeof value === 'string') {
            const regex = new RegExp(rule.pattern);
            if (regex.test(value)) {
              const newValue = value.replace(regex, rule.replacement);
              (current as Record<string, unknown>)[part] = newValue;
              changes.push({
                field: `${pathSoFar}.${part}`.replace(/^\./, ''),
                oldValue: value,
                newValue,
                reason: rule.description || `Pattern: ${rule.pattern}`,
              });
            }
          }
        }
      } else {
        // Continue traversing
        if (current && typeof current === 'object' && part in current) {
          traverse(
            (current as Record<string, unknown>)[part],
            rest,
            `${pathSoFar}.${part}`
          );
        }
      }
    };

    traverse(obj, pathParts, currentPath);
    return changes;
  }

  /**
   * Apply direct substitutions to component
   */
  private applySubstitutions(
    component: IONComponentDetail,
    substitutions: Record<string, Record<string, string>>
  ): { component: IONComponentDetail; changes: ChangeRecord[] } {
    const changes: ChangeRecord[] = [];
    const transformed = JSON.parse(JSON.stringify(component));

    const applyToObject = (obj: unknown, path: string = ''): void => {
      if (!obj || typeof obj !== 'object') return;

      if (Array.isArray(obj)) {
        obj.forEach((item, index) => applyToObject(item, `${path}[${index}]`));
        return;
      }

      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const currentPath = path ? `${path}.${key}` : key;

        if (typeof value === 'string') {
          // Check if this field has substitutions
          if (substitutions[key] && substitutions[key][value]) {
            const newValue = substitutions[key][value];
            (obj as Record<string, unknown>)[key] = newValue;
            changes.push({
              field: currentPath,
              oldValue: value,
              newValue,
              reason: `Substitution for ${key}`,
            });
          }
        } else if (typeof value === 'object') {
          applyToObject(value, currentPath);
        }
      }
    };

    applyToObject(transformed);
    return { component: transformed, changes };
  }

  /**
   * Handle credential fields in component
   */
  private handleCredentials(
    component: IONComponentDetail,
    placeholder: string
  ): { component: IONComponentDetail; credentialFields: string[] } {
    const credentialFields: string[] = [];
    const transformed = JSON.parse(JSON.stringify(component));

    const processObject = (obj: unknown, path: string = ''): void => {
      if (!obj || typeof obj !== 'object') return;

      if (Array.isArray(obj)) {
        obj.forEach((item, index) => processObject(item, `${path}[${index}]`));
        return;
      }

      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const currentPath = path ? `${path}.${key}` : key;

        // Check if this is a credential field
        const isCredential =
          CREDENTIAL_FIELDS.some((cf) => key.toLowerCase().includes(cf.toLowerCase())) ||
          (typeof value === 'object' &&
            value !== null &&
            'encrypted' in value &&
            (value as Record<string, unknown>).encrypted === true);

        if (isCredential && typeof value === 'string' && value.length > 0) {
          // Check if it looks like an encrypted value (starts with aes: or similar)
          if (value.startsWith('aes:') || value.length > 50) {
            (obj as Record<string, unknown>)[key] = placeholder;
            credentialFields.push(currentPath);
          }
        } else if (typeof value === 'object') {
          processObject(value, currentPath);
        }
      }
    };

    processObject(transformed);
    return { component: transformed, credentialFields };
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Set nested value in object using dot notation
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Get default substitutions for scripts
   */
  getDefaultSubstitutions(): Record<string, string> {
    return { ...this.mapping.scripts.defaultSubstitutions };
  }
}

/**
 * Load and validate mapping file
 */
export async function loadMappingFile(filePath: string): Promise<EnvMapping> {
  const { readFile } = await import('fs/promises');
  const { existsSync } = await import('fs');

  if (!existsSync(filePath)) {
    throw new Error(`Mapping file not found: ${filePath}`);
  }

  const content = await readFile(filePath, 'utf-8');
  const mapping = JSON.parse(content) as EnvMapping;

  // Validate required fields
  if (!mapping.version) {
    throw new Error('Mapping file missing required field: version');
  }
  if (!mapping.environments) {
    throw new Error('Mapping file missing required field: environments');
  }
  if (!mapping.connectionPoints) {
    throw new Error('Mapping file missing required field: connectionPoints');
  }
  if (!mapping.scripts) {
    throw new Error('Mapping file missing required field: scripts');
  }

  logger.info('Loaded mapping file', { path: filePath, version: mapping.version });
  return mapping;
}
