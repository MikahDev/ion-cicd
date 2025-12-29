/**
 * Interactive Prompts
 * Provides interactive CLI prompts using Inquirer.js
 */

import inquirer from 'inquirer';
import { ComponentType, COMPONENT_DISPLAY_NAMES } from '../types/ion.js';
import { ConflictResolution } from '../services/component-service.js';

/**
 * Prompts user to select component types
 * @param availableTypes - Array of available component types
 * @returns Selected component types
 */
export async function selectComponentTypes(
  availableTypes: ComponentType[]
): Promise<ComponentType[]> {
  const choices = availableTypes.map((type) => ({
    name: COMPONENT_DISPLAY_NAMES[type],
    value: type,
    checked: true, // Default to all selected
  }));

  const { selectedTypes } = await inquirer.prompt<{ selectedTypes: ComponentType[] }>([
    {
      type: 'checkbox',
      name: 'selectedTypes',
      message: 'Select component types to process:',
      choices,
      validate: (answer: ComponentType[]) => {
        if (answer.length === 0) {
          return 'You must select at least one component type.';
        }
        return true;
      },
    },
  ]);

  return selectedTypes;
}

/**
 * Prompts user to select specific components from a list
 * @param typeName - Display name of the component type
 * @param components - Array of component names
 * @returns Selected component names
 */
export async function selectComponents(
  typeName: string,
  components: string[]
): Promise<string[]> {
  const choices = components.map((name) => ({
    name,
    value: name,
    checked: true, // Default to all selected
  }));

  const { selectedComponents } = await inquirer.prompt<{ selectedComponents: string[] }>([
    {
      type: 'checkbox',
      name: 'selectedComponents',
      message: `Select ${typeName} components:`,
      choices,
      pageSize: 15,
    },
  ]);

  return selectedComponents;
}

/**
 * Prompts user to confirm an operation
 * @param message - Confirmation message
 * @param isDryRun - Whether this is a dry run
 * @returns True if confirmed
 */
export async function confirmOperation(
  message: string,
  isDryRun: boolean
): Promise<boolean> {
  const fullMessage = isDryRun ? `[DRY RUN] ${message}` : message;

  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message: fullMessage,
      default: true,
    },
  ]);

  return confirmed;
}

/**
 * Prompts user to select a conflict resolution strategy
 * @returns Selected conflict resolution strategy
 */
export async function selectConflictResolution(): Promise<ConflictResolution> {
  const { resolution } = await inquirer.prompt<{ resolution: ConflictResolution }>([
    {
      type: 'list',
      name: 'resolution',
      message: 'How should naming conflicts be handled?',
      choices: [
        {
          name: 'Rename - Add suffix to conflicting components (e.g., MyFlow_1)',
          value: 'rename',
        },
        {
          name: 'Skip - Skip components that already exist',
          value: 'skip',
        },
        {
          name: 'Fail - Stop import on first conflict',
          value: 'fail',
        },
      ],
      default: 'rename',
    },
  ]);

  return resolution;
}

/**
 * Prompts user to select a repository from a list
 * @param repos - Array of repository objects with name and full_name
 * @returns Selected repository full name (owner/repo)
 */
export async function selectRepository(
  repos: Array<{ name: string; full_name: string }>
): Promise<string> {
  const choices = repos.map((repo) => ({
    name: repo.full_name,
    value: repo.full_name,
  }));

  const { selectedRepo } = await inquirer.prompt<{ selectedRepo: string }>([
    {
      type: 'list',
      name: 'selectedRepo',
      message: 'Select a repository:',
      choices,
      pageSize: 10,
    },
  ]);

  return selectedRepo;
}

/**
 * Prompts user to enter a repository name
 * @param defaultValue - Default repository name
 * @returns Repository full name (owner/repo)
 */
export async function inputRepository(defaultValue?: string): Promise<string> {
  const { repo } = await inquirer.prompt<{ repo: string }>([
    {
      type: 'input',
      name: 'repo',
      message: 'Enter repository (owner/repo):',
      default: defaultValue,
      validate: (input: string) => {
        if (!input.includes('/')) {
          return 'Repository must be in "owner/repo" format';
        }
        const [owner, name] = input.split('/');
        if (!owner || !name) {
          return 'Repository must be in "owner/repo" format';
        }
        return true;
      },
    },
  ]);

  return repo;
}

/**
 * Prompts user to enter a branch name
 * @param defaultValue - Default branch name
 * @returns Branch name
 */
export async function inputBranch(defaultValue = 'main'): Promise<string> {
  const { branch } = await inquirer.prompt<{ branch: string }>([
    {
      type: 'input',
      name: 'branch',
      message: 'Enter branch name:',
      default: defaultValue,
    },
  ]);

  return branch;
}

/**
 * Prompts user to select an environment
 * @param environments - Array of environment names
 * @returns Selected environment name
 */
export async function selectEnvironment(environments: string[]): Promise<string> {
  const { selectedEnv } = await inquirer.prompt<{ selectedEnv: string }>([
    {
      type: 'list',
      name: 'selectedEnv',
      message: 'Select target environment:',
      choices: environments,
    },
  ]);

  return selectedEnv;
}

/**
 * Environment info for selection prompt
 */
export interface EnvironmentChoice {
  /** Environment key (e.g., 'tst', 'prd') */
  key: string;
  /** Display name (e.g., 'Test', 'Production') */
  displayName?: string;
  /** Whether the environment is protected */
  protected?: boolean;
}

/**
 * Prompts user to select an environment from config with display names and protected warnings
 * @param environments - Array of environment choices with display names and protected status
 * @returns Selected environment key
 */
export async function selectEnvironmentFromConfig(
  environments: EnvironmentChoice[],
  message: string = 'Select target environment:'
): Promise<string> {
  const choices = environments.map((env) => {
    let label = env.displayName || env.key.toUpperCase();
    if (env.protected) {
      label = `${label} ⚠️  Protected`;
    }
    return {
      name: label,
      value: env.key,
    };
  });

  const { selectedEnv } = await inquirer.prompt<{ selectedEnv: string }>([
    {
      type: 'list',
      name: 'selectedEnv',
      message,
      choices,
    },
  ]);

  return selectedEnv;
}

/**
 * Dependency type choice for deployment selection
 */
export interface DependencyTypeChoice {
  type: 'libraries' | 'workflows' | 'mappings' | 'schemas' | 'scripts' | 'connectionpoints';
  label: string;
  count: number;
  items: string[];
}

/**
 * Prompts user to select which dependency types to deploy
 * @param dependencies - Available dependency types with counts
 * @returns Selected dependency types
 */
export async function selectDependencyTypes(
  dependencies: DependencyTypeChoice[]
): Promise<string[]> {
  const choices = dependencies.map((dep) => ({
    name: `${dep.label} (${dep.count}): ${dep.items.slice(0, 3).join(', ')}${dep.items.length > 3 ? '...' : ''}`,
    value: dep.type,
    checked: true, // Default to all selected
  }));

  const { selectedTypes } = await inquirer.prompt<{ selectedTypes: string[] }>([
    {
      type: 'checkbox',
      name: 'selectedTypes',
      message: 'Select dependency types to deploy:',
      choices,
    },
  ]);

  return selectedTypes;
}

/**
 * Prompts user to select export/import direction for sync
 * @returns Direction: 'export', 'import', or 'both'
 */
export async function selectSyncDirection(): Promise<'export' | 'import' | 'both'> {
  const { direction } = await inquirer.prompt<{ direction: 'export' | 'import' | 'both' }>([
    {
      type: 'list',
      name: 'direction',
      message: 'Select sync direction:',
      choices: [
        {
          name: 'Export (ION → GitHub) - Backup components to repository',
          value: 'export',
        },
        {
          name: 'Import (GitHub → ION) - Deploy components from repository',
          value: 'import',
        },
        {
          name: 'Both - Full bidirectional sync',
          value: 'both',
        },
      ],
      default: 'export',
    },
  ]);

  return direction;
}

/**
 * Generic prompt to select from a list of choices
 * @param message - Prompt message
 * @param choices - Array of choices with name and value
 * @returns Selected value
 */
export async function selectFromList<T>(
  message: string,
  choices: Array<{ name: string; value: T }>
): Promise<T> {
  const { selected } = await inquirer.prompt<{ selected: T }>([
    {
      type: 'list',
      name: 'selected',
      message,
      choices,
      pageSize: 15,
    },
  ]);

  return selected;
}
