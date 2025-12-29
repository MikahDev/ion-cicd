/**
 * Script Prompts
 * Interactive prompts for script transformation during environment refresh
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { DetectedValue } from '../types/refresh.js';

/**
 * Display detected hardcoded values in a script with context
 * @param scriptName - Name of the script
 * @param detectedValues - Array of detected values
 */
export function displayDetectedValues(
  scriptName: string,
  detectedValues: DetectedValue[]
): void {
  console.log('\n' + chalk.cyan('─'.repeat(70)));
  console.log(chalk.bold.cyan(`  Script: ${scriptName}`));
  console.log(chalk.cyan('─'.repeat(70)));
  console.log(chalk.yellow('\n  Detected hardcoded values:\n'));

  let valueIndex = 1;
  for (const detected of detectedValues) {
    for (const occurrence of detected.occurrences) {
      console.log(
        chalk.white(`  ${valueIndex}. `) +
          chalk.yellow(`${detected.description}`) +
          chalk.gray(` (line ${occurrence.line}):`)
      );

      // Display context with highlighted match
      const contextLines = occurrence.context.split('\n');
      for (const line of contextLines) {
        const highlightedLine = line.replace(
          new RegExp(escapeRegex(occurrence.match), 'g'),
          chalk.red.bold(occurrence.match)
        );
        console.log(chalk.gray('     ') + highlightedLine);
      }
      console.log('');
      valueIndex++;
    }
  }

  console.log(chalk.cyan('─'.repeat(70)) + '\n');
}

/**
 * Prompt user for replacement values for detected hardcoded values
 * @param detectedValues - Array of detected values
 * @param defaultSubstitutions - Default values to suggest
 * @returns Map of original value to replacement value
 */
export async function promptForReplacements(
  detectedValues: DetectedValue[],
  defaultSubstitutions: Record<string, string>
): Promise<Record<string, string>> {
  const replacements: Record<string, string> = {};
  const uniqueValues = new Set<string>();

  // Collect unique values across all detections
  for (const detected of detectedValues) {
    for (const occurrence of detected.occurrences) {
      uniqueValues.add(occurrence.match);
    }
  }

  // Prompt for each unique value
  for (const value of uniqueValues) {
    // Find the description for this value
    let description = 'Value';
    for (const detected of detectedValues) {
      for (const occurrence of detected.occurrences) {
        if (occurrence.match === value) {
          description = detected.description;
          break;
        }
      }
    }

    const defaultValue = defaultSubstitutions[value] || value;

    const { replacement } = await inquirer.prompt<{ replacement: string }>([
      {
        type: 'input',
        name: 'replacement',
        message: `Replace ${chalk.red(value)} (${description}) with:`,
        default: defaultValue,
      },
    ]);

    // Only add if different from original
    if (replacement !== value) {
      replacements[value] = replacement;
    }
  }

  return replacements;
}

/**
 * Prompt user to confirm script transformation
 * @param scriptName - Name of the script
 * @param replacementCount - Number of replacements to make
 * @returns True if confirmed
 */
export async function confirmScriptTransformation(
  scriptName: string,
  replacementCount: number
): Promise<boolean> {
  if (replacementCount === 0) {
    return true; // Nothing to confirm
  }

  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `Apply ${replacementCount} replacement(s) to ${scriptName}?`,
      default: true,
    },
  ]);

  return confirmed;
}

/**
 * Prompt user to choose how to handle a script with hardcoded values
 * @param scriptName - Name of the script
 * @returns Action to take
 */
export async function promptScriptAction(
  scriptName: string
): Promise<'replace' | 'skip' | 'use-defaults'> {
  const { action } = await inquirer.prompt<{
    action: 'replace' | 'skip' | 'use-defaults';
  }>([
    {
      type: 'list',
      name: 'action',
      message: `How do you want to handle ${scriptName}?`,
      choices: [
        {
          name: 'Replace values interactively',
          value: 'replace',
        },
        {
          name: 'Use default substitutions from mapping file',
          value: 'use-defaults',
        },
        {
          name: 'Skip this script (keep original values)',
          value: 'skip',
        },
      ],
      default: 'replace',
    },
  ]);

  return action;
}

/**
 * Display summary of script transformations
 * @param transformedScripts - Array of transformed script info
 */
export function displayScriptTransformSummary(
  transformedScripts: Array<{
    name: string;
    replacements: number;
    skipped: boolean;
  }>
): void {
  console.log('\n' + chalk.cyan('═'.repeat(70)));
  console.log(chalk.bold.cyan('  Script Transformation Summary'));
  console.log(chalk.cyan('═'.repeat(70)) + '\n');

  for (const script of transformedScripts) {
    if (script.skipped) {
      console.log(chalk.yellow(`  ○ ${script.name}`) + chalk.gray(' (skipped)'));
    } else if (script.replacements > 0) {
      console.log(
        chalk.green(`  ✓ ${script.name}`) +
          chalk.gray(` (${script.replacements} replacement(s))`)
      );
    } else {
      console.log(chalk.green(`  ✓ ${script.name}`) + chalk.gray(' (no changes needed)'));
    }
  }

  console.log('\n' + chalk.cyan('═'.repeat(70)) + '\n');
}

/**
 * Prompt user to confirm refresh operation
 * @param sourceEnv - Source environment
 * @param targetEnv - Target environment
 * @param componentCount - Number of components to refresh
 * @returns True if confirmed
 */
export async function confirmRefresh(
  sourceEnv: string,
  targetEnv: string,
  componentCount: number
): Promise<boolean> {
  console.log('\n' + chalk.yellow('⚠️  Environment Refresh Warning ⚠️'));
  console.log(chalk.yellow('─'.repeat(50)));
  console.log(`  Source: ${chalk.cyan(sourceEnv.toUpperCase())}`);
  console.log(`  Target: ${chalk.cyan(targetEnv.toUpperCase())}`);
  console.log(`  Components: ${chalk.cyan(componentCount.toString())}`);
  console.log(chalk.yellow('─'.repeat(50)) + '\n');

  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `Are you sure you want to refresh ${targetEnv.toUpperCase()} from ${sourceEnv.toUpperCase()}?`,
      default: false,
    },
  ]);

  return confirmed;
}

/**
 * Display credential configuration reminder
 * @param credentials - Array of credentials needing configuration
 */
export function displayCredentialReminder(
  credentials: Array<{ component: string; fields: string[] }>
): void {
  if (credentials.length === 0) return;

  console.log('\n' + chalk.yellow('⚠️  Manual Configuration Required'));
  console.log(chalk.yellow('─'.repeat(50)));
  console.log(
    chalk.gray('  The following credentials need to be configured in ION:\n')
  );

  for (const cred of credentials) {
    console.log(chalk.white(`  ${cred.component}:`));
    for (const field of cred.fields) {
      console.log(chalk.gray(`    - ${field}`));
    }
  }

  console.log('\n' + chalk.yellow('─'.repeat(50)) + '\n');
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
