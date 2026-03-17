/**
 * Push Command
 * Bulk push ALL local components to an ION environment
 * Simple interface with no validation - just pushes everything
 */

import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { IONClient } from '../clients/ion-client.js';
import { ComponentService } from '../services/component-service.js';
import { ComponentType, COMPONENT_DISPLAY_NAMES, IMPORT_ORDER } from '../types/index.js';
import { confirmOperation } from '../interactive/prompts.js';
import { ConfigLoader } from '../config/loader.js';
import { markdownToHtml } from '../utils/markdown.js';

/**
 * Push command options from CLI
 */
export interface PushCommandOptions {
  /** Path to ionapi config file */
  config?: string;
  /** Environment name (tst|trn|prd) */
  env?: string;
  /** Component type filter (optional) */
  type?: string;
  /** Dry run - preview without changes */
  dryRun?: boolean;
  /** Skip confirmation prompt */
  force?: boolean;
  /** Output format (text|json) */
  output?: string;
}

/**
 * Represents a local component discovered from the filesystem
 */
interface LocalComponent {
  type: ComponentType;
  name: string;
  path: string;
  displayType: string;
}

/**
 * Maps folder names to component types
 */
const FOLDER_TO_TYPE: Record<string, ComponentType> = {
  'BOD schema': ComponentType.BOD_SCHEMAS,
  'Object schema': ComponentType.OBJECT_SCHEMAS,
  'Library': ComponentType.LIBRARIES,
  'Connection point': ComponentType.CONNECTION_POINTS,
  'File template': ComponentType.FILE_TEMPLATES,
  'Enterprise Connector': ComponentType.ENTERPRISE_LOCATIONS,
  'Script': ComponentType.SCRIPTS,
  'Mapping': ComponentType.MAPPINGS,
  'Document flow': ComponentType.DATAFLOWS,
  'Workflow': ComponentType.WORKFLOWS,
  'Activation policy': ComponentType.ACTIVATION_POLICIES,
};

/**
 * Discovers all local components from the components folder
 */
async function discoverLocalComponents(
  basePath: string,
  filterType?: ComponentType
): Promise<LocalComponent[]> {
  const components: LocalComponent[] = [];

  for (const [folder, type] of Object.entries(FOLDER_TO_TYPE)) {
    // Skip if filtering by type and this isn't it
    if (filterType && type !== filterType) continue;

    const folderPath = join(basePath, folder);
    if (!existsSync(folderPath)) continue;

    const files = await readdir(folderPath);

    // Track discovered names to avoid duplicates
    const discoveredNames = new Set<string>();

    for (const file of files) {
      const filePath = join(folderPath, file);

      // Handle different file types
      if (type === ComponentType.SCRIPTS) {
        // Scripts: only count .py files (skip .meta.json)
        if (file.endsWith('.py')) {
          const name = file.replace('.py', '');
          components.push({
            type,
            name,
            path: filePath,
            displayType: COMPONENT_DISPLAY_NAMES[type],
          });
        }
      } else if (type === ComponentType.BOD_SCHEMAS) {
        // BOD schemas: only count .xsd files (pair with .xml)
        if (file.endsWith('.xsd')) {
          const name = file.replace('.xsd', '');
          components.push({
            type,
            name,
            path: filePath,
            displayType: COMPONENT_DISPLAY_NAMES[type],
          });
        }
      } else if (type === ComponentType.LIBRARIES) {
        // Libraries: prefer .py files (new format - rebuild wheel from source), fall back to .json (legacy)
        if (file.endsWith('.py')) {
          const name = file.replace('.py', '');
          discoveredNames.add(name);
          components.push({
            type,
            name,
            path: filePath,
            displayType: COMPONENT_DISPLAY_NAMES[type],
          });
        }
      } else if (file.endsWith('.json')) {
        // All other types: .json files
        const name = file.replace('.json', '');
        components.push({
          type,
          name,
          path: filePath,
          displayType: COMPONENT_DISPLAY_NAMES[type],
        });
      }
    }

    // For Libraries, also discover legacy .json files not already found as .py
    if (type === ComponentType.LIBRARIES) {
      for (const file of files) {
        if (file.endsWith('.json') && !file.endsWith('.meta.json')) {
          const name = file.replace('.json', '');
          if (!discoveredNames.has(name)) {
            components.push({
              type,
              name,
              path: join(folderPath, file),
              displayType: COMPONENT_DISPLAY_NAMES[type],
            });
          }
        }
      }
    }
  }

  return components;
}

/**
 * Sorts components by IMPORT_ORDER to respect dependencies
 */
function sortByImportOrder(components: LocalComponent[]): LocalComponent[] {
  return [...components].sort((a, b) => {
    const orderA = IMPORT_ORDER.indexOf(a.type);
    const orderB = IMPORT_ORDER.indexOf(b.type);
    return orderA - orderB;
  });
}

/**
 * Reads component data from local file
 */
async function readComponentData(
  component: LocalComponent,
  basePath: string
): Promise<Record<string, unknown>> {
  if (component.type === ComponentType.SCRIPTS) {
    // Scripts: combine .py, .meta.json, and optional .md
    const metaPath = join(basePath, 'Script', `${component.name}.meta.json`);
    const pyPath = component.path;
    const mdPath = join(basePath, 'Script', `${component.name}.md`);

    const metadata = JSON.parse(await readFile(metaPath, 'utf-8'));
    const scriptCode = await readFile(pyPath, 'utf-8');

    // Check for .md documentation file
    let documentation = metadata.documentation || '';
    if (existsSync(mdPath)) {
      const markdownContent = await readFile(mdPath, 'utf-8');
      if (markdownContent.trim()) {
        documentation = markdownToHtml(markdownContent);
      }
    }

    return { ...metadata, scriptCode, documentation };
  } else if (component.type === ComponentType.BOD_SCHEMAS) {
    // BOD schemas: combine .xsd and .xml
    const xsdPath = component.path;
    const xmlPath = join(basePath, 'BOD schema', `${component.name}.xml`);

    const nounSchemaXsd = await readFile(xsdPath, 'utf-8');
    const nounMetadataXml = existsSync(xmlPath) ? await readFile(xmlPath, 'utf-8') : '';

    return { name: component.name, nounSchemaXsd, nounMetadataXml };
  } else if (component.type === ComponentType.LIBRARIES && component.path.endsWith('.py')) {
    // Libraries (new format): rebuild wheel from .py source + .meta.json
    const pyPath = component.path;
    const metaPath = join(basePath, 'Library', `${component.name}.meta.json`);

    const pythonSource = await readFile(pyPath, 'utf-8');
    const metadata = JSON.parse(await readFile(metaPath, 'utf-8'));

    // Rebuild the wheel from source
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

    // Create RECORD
    const recordContent = [
      `${name}.py,,`,
      `${distInfoDir}/METADATA,,`,
      `${distInfoDir}/WHEEL,,`,
      `${distInfoDir}/top_level.txt,,`,
      `${distInfoDir}/RECORD,,`,
    ].join('\n');
    zip.addFile(`${distInfoDir}/RECORD`, Buffer.from(recordContent, 'utf-8'));

    const base64File = zip.toBuffer().toString('base64');

    return { ...metadata, file: base64File };
  } else {
    // Standard JSON components (including legacy Library .json)
    return JSON.parse(await readFile(component.path, 'utf-8'));
  }
}

/**
 * Executes the push command
 * Pushes ALL local components to the target ION environment
 */
export async function executePush(options: PushCommandOptions): Promise<void> {
  const isJson = options.output === 'json';

  // Resolve config
  const loader = new ConfigLoader();
  const config = await loader.resolve({
    env: options.env,
    configPath: options.config,
  });

  const componentsPath = config.settings?.componentsPath || './ion-components';

  // Parse type filter if provided
  let filterType: ComponentType | undefined;
  if (options.type) {
    const typeKey = options.type.toLowerCase();
    filterType = Object.values(ComponentType).find((t) => t === typeKey) as ComponentType | undefined;
    if (!filterType) {
      throw new Error(`Invalid component type: ${options.type}. Valid types: ${Object.values(ComponentType).join(', ')}`);
    }
  }

  // Discover all local components
  if (!isJson) {
    // eslint-disable-next-line no-console
    console.log(`Discovering components in ${componentsPath}...`);
  }

  const allComponents = await discoverLocalComponents(componentsPath, filterType);

  if (allComponents.length === 0) {
    if (!isJson) {
      // eslint-disable-next-line no-console
      console.log('No components found to push.');
    }
    return;
  }

  // Sort by import order
  const sorted = sortByImportOrder(allComponents);

  // Group by type for summary
  const byType = new Map<ComponentType, LocalComponent[]>();
  for (const comp of sorted) {
    if (!byType.has(comp.type)) {
      byType.set(comp.type, []);
    }
    byType.get(comp.type)!.push(comp);
  }

  // Show summary
  if (!isJson) {
    // eslint-disable-next-line no-console
    console.log(`\nFound ${sorted.length} components to push:\n`);
    for (const [type, components] of byType) {
      // eslint-disable-next-line no-console
      console.log(`  ${COMPONENT_DISPLAY_NAMES[type]}: ${components.length}`);
    }
    // eslint-disable-next-line no-console
    console.log('');
  }

  // Confirm unless --force or --dry-run
  if (!options.force && !options.dryRun) {
    const envDisplay = config.environment?.displayName || options.env || 'target';
    const confirmed = await confirmOperation(
      `Push ${sorted.length} components to ${envDisplay}?`,
      false // not a dry run since we skip confirmation for dry runs
    );
    if (!confirmed) {
      if (!isJson) {
        // eslint-disable-next-line no-console
        console.log('Push cancelled.');
      }
      return;
    }
  }

  // Authenticate
  if (!isJson) {
    // eslint-disable-next-line no-console
    console.log('Authenticating...');
  }

  const ionClient = new IONClient(config.ionApi);
  await ionClient.authenticate();

  // GitHubClient not needed for push - we're only pushing to ION
  const service = new ComponentService(ionClient, null as unknown as never);

  // Push each component
  if (!isJson) {
    // eslint-disable-next-line no-console
    console.log('\n=== Pushing Components ===\n');
  }

  const results = {
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [] as { name: string; type: string; error: string }[],
  };

  for (const component of sorted) {
    try {
      const data = await readComponentData(component, componentsPath);

      // Skip Enterprise Locations - they must be created manually
      if (component.type === ComponentType.ENTERPRISE_LOCATIONS) {
        results.skipped++;
        if (!isJson) {
          // eslint-disable-next-line no-console
          console.log(`  ⊘ ${component.displayType}: ${component.name} (skipped - create manually)`);
        }
        continue;
      }

      // Libraries: check if version already exists (cannot overwrite same version)
      if (component.type === ComponentType.LIBRARIES) {
        const localVersion = (data as { version?: string }).version;
        try {
          const remote = await ionClient.getComponent(ComponentType.LIBRARIES, component.name);
          const remoteVersion = (remote as { version?: string }).version;
          if (localVersion && remoteVersion && localVersion === remoteVersion) {
            results.skipped++;
            if (!isJson) {
              // eslint-disable-next-line no-console
              console.log(`  ⊘ ${component.displayType}: ${component.name} (v${localVersion} already exists)`);
            }
            continue;
          }
        } catch {
          // Library doesn't exist remotely, will be created
        }
      }

      // Ensure dataflows have required 'type' field
      if (component.type === ComponentType.DATAFLOWS) {
        if (!(data as Record<string, unknown>).type) {
          (data as Record<string, unknown>).type = 'DATA_FLOW';
        }
      }

      // Strip connectionPointProperties for connection points (preserve credentials)
      if (component.type === ComponentType.CONNECTION_POINTS) {
        delete (data as Record<string, unknown>).connectionPointProperties;
      }

      if (!options.dryRun) {
        const result = await service.importComponent(
          component.type,
          data as never,
          'update'
        );

        if (result.status === 'failed') {
          results.failed++;
          results.errors.push({
            name: component.name,
            type: component.displayType,
            error: result.error || 'Unknown error',
          });
          if (!isJson) {
            // eslint-disable-next-line no-console
            console.log(`  ✗ ${component.displayType}: ${component.name} - ${result.error}`);
          }
        } else {
          results.success++;
          if (!isJson) {
            // eslint-disable-next-line no-console
            console.log(`  ✓ ${component.displayType}: ${component.name}`);
          }
        }
      } else {
        results.success++;
        if (!isJson) {
          // eslint-disable-next-line no-console
          console.log(`  ✓ ${component.displayType}: ${component.name} (dry run)`);
        }
      }
    } catch (error) {
      results.failed++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.errors.push({
        name: component.name,
        type: component.displayType,
        error: errorMessage,
      });
      if (!isJson) {
        // eslint-disable-next-line no-console
        console.log(`  ✗ ${component.displayType}: ${component.name} - ${errorMessage}`);
      }
    }
  }

  // Summary
  if (!isJson) {
    // eslint-disable-next-line no-console
    console.log('\n=== Summary ===');
    // eslint-disable-next-line no-console
    console.log(`  Success: ${results.success}`);
    // eslint-disable-next-line no-console
    console.log(`  Failed:  ${results.failed}`);
    if (results.skipped > 0) {
      // eslint-disable-next-line no-console
      console.log(`  Skipped: ${results.skipped}`);
    }
    if (options.dryRun) {
      // eslint-disable-next-line no-console
      console.log('\n  (Dry run - no changes made)');
    }
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(results, null, 2));
  }
}
