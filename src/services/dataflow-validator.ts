/**
 * Dataflow Validator Service
 * Validates dataflow dependencies including connection point API calls
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { IONClient } from '../clients/ion-client.js';
import { ComponentType } from '../types/index.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('DataflowValidator');

/**
 * ION API activity dependency
 */
export interface IonApiDependency {
  activityName: string;
  connectionPoint: string;
  /** Explicit call name specified in the dataflow (ionapiCallName property) */
  explicitCallName?: string;
  /** Documents that flow INTO this activity (determines which API call is used) */
  inputDocuments: Array<{ verb: string; noun: string }>;
  /** The callName from the connection point that handles these documents */
  requiredCallName?: string;
}

/**
 * Script dependency
 */
export interface ScriptDependency {
  activityName: string;
  scriptName: string;
}

/**
 * Application connection point dependency
 */
export interface AppConnectionDependency {
  activityName: string;
  connectionPoint: string;
}

/**
 * Custom noun dependency (BOD schema)
 */
export interface CustomNounDependency {
  activityName: string;
  noun: string;
  verb?: string;
}

/**
 * Library dependency
 */
export interface LibraryDependency {
  scriptName: string;
  libraryName: string;
  version?: string;
}

/**
 * Workflow dependency
 */
export interface WorkflowDependency {
  activityName: string;
  workflowName: string;
}

/**
 * Mapping dependency
 */
export interface MappingDependency {
  activityName: string;
  mappingName: string;
}

/**
 * Dataflow dependencies
 */
export interface DataflowDependencies {
  name: string;
  ionApiActivities: IonApiDependency[];
  scripts: ScriptDependency[];
  appConnections: AppConnectionDependency[];
  customNouns: CustomNounDependency[];
  libraries: LibraryDependency[];
  workflows: WorkflowDependency[];
  mappings: MappingDependency[];
}

/**
 * Validation result for a single issue
 */
export interface ValidationIssue {
  severity: 'error' | 'warning';
  component: string;
  message: string;
  details?: string;
  fix?: string;
}

/**
 * Full validation result
 */
export interface DataflowValidationResult {
  dataflow: string;
  valid: boolean;
  issues: ValidationIssue[];
  dependencies: DataflowDependencies;
}

/**
 * Document group from connection point
 */
interface DocumentGroup {
  documentGroupProperties: Array<{ name: string; value: string }>;
  documents: Array<{ verb: string; noun: string; documentType: string }>;
}

/**
 * Parse a dataflow JSON to extract dependencies
 */
// Standard Infor nouns that don't need custom BOD schema validation
export const STANDARD_NOUNS = new Set([
  'Shipment', 'ShipmentOrder', 'SalesOrder', 'PurchaseOrder', 'ItemMaster',
  'InventoryBalance', 'InventoryCount', 'InventoryAdjustment', 'BillOfMaterials',
  'CustomerPartyMaster', 'SupplierPartyMaster', 'CodeDefinition', 'Location',
  'Receivable', 'Payable', 'Invoice', 'Receipt', 'Payment', 'JournalEntry',
  'ChartOfAccounts', 'PersonnelMaster', 'TimeEntry', 'WorkOrder', 'Asset',
  'ReceiveDelivery', 'ShipFromPartyMaster', 'ShipToPartyMaster', 'CarrierRoute',
  'AdvanceShipNotice', 'WarehouseShipmentAdvice', 'TransportationRequest',
]);

export function parseDataflowDependencies(
  dataflow: Record<string, unknown>
): DataflowDependencies {
  const dependencies: DataflowDependencies = {
    name: dataflow.name as string,
    ionApiActivities: [],
    scripts: [],
    appConnections: [],
    customNouns: [],
    libraries: [],
    workflows: [],
    mappings: [],
  };

  // Track nouns we've already added to avoid duplicates
  const seenNouns = new Set<string>();

  function traverse(obj: unknown, previousActivity?: Record<string, unknown>): void {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach((item) => traverse(item, previousActivity));
      return;
    }

    const record = obj as Record<string, unknown>;

    // ION API activity
    if (record._type === 'ionApiActivity' && record.ionApiConnectionPoint) {
      const activity: IonApiDependency = {
        activityName: record.name as string,
        connectionPoint: record.ionApiConnectionPoint as string,
        inputDocuments: [],
      };

      // Capture explicit call name if specified
      if (record.ionapiCallName) {
        activity.explicitCallName = record.ionapiCallName as string;
      }

      // The input documents come from the PREVIOUS activity's output
      // This is tricky - we need to trace the flow
      // For now, we'll look at activityDocuments if present
      if (record.activityDocuments && Array.isArray(record.activityDocuments)) {
        for (const doc of record.activityDocuments) {
          if (doc.verb && doc.noun) {
            activity.inputDocuments.push({
              verb: doc.verb as string,
              noun: doc.noun as string,
            });
          }
        }
      }

      dependencies.ionApiActivities.push(activity);
    }

    // Script activity
    if (record._type === 'scriptingActivity' && record.scriptName) {
      dependencies.scripts.push({
        activityName: record.name as string,
        scriptName: record.scriptName as string,
      });

      // Check activityDocuments for custom nouns
      if (record.activityDocuments && Array.isArray(record.activityDocuments)) {
        for (const doc of record.activityDocuments) {
          const noun = doc.noun as string;
          if (noun && !STANDARD_NOUNS.has(noun) && !seenNouns.has(noun)) {
            seenNouns.add(noun);
            dependencies.customNouns.push({
              activityName: record.name as string,
              noun: noun,
              verb: doc.verb as string,
            });
          }
        }
      }

      // Check documentMappings for custom output nouns
      if (record.documentMappings && Array.isArray(record.documentMappings)) {
        for (const mapping of record.documentMappings) {
          // Check output document for custom nouns
          if (mapping.outputDocument) {
            const outputDoc = mapping.outputDocument as string;
            const parts = outputDoc.split('.');
            let verb = '';
            let noun = '';
            if (parts.length === 2) {
              [verb, noun] = parts;
            } else if (parts.length === 1) {
              noun = parts[0];
            }
            if (noun && !STANDARD_NOUNS.has(noun) && !seenNouns.has(noun)) {
              seenNouns.add(noun);
              dependencies.customNouns.push({
                activityName: record.name as string,
                noun: noun,
                verb: verb,
              });
            }
          }

          // Check input document for custom BOD nouns
          if (mapping.inputDocument && mapping.inputDocumentType === 'BOD') {
            const inputDoc = mapping.inputDocument as string;
            const parts = inputDoc.split('.');
            let verb = '';
            let noun = '';
            if (parts.length === 2) {
              [verb, noun] = parts;
            } else if (parts.length === 1) {
              noun = parts[0];
            }
            if (noun && !STANDARD_NOUNS.has(noun) && !seenNouns.has(noun)) {
              seenNouns.add(noun);
              dependencies.customNouns.push({
                activityName: record.name as string,
                noun: noun,
                verb: verb,
              });
            }
          }
        }
      }

      // Check activityDocuments for custom BOD nouns
      if (record.activityDocuments && Array.isArray(record.activityDocuments)) {
        for (const doc of record.activityDocuments) {
          if (doc.documentType === 'BOD' && doc.noun) {
            const noun = doc.noun as string;
            if (!STANDARD_NOUNS.has(noun) && !seenNouns.has(noun)) {
              seenNouns.add(noun);
              dependencies.customNouns.push({
                activityName: record.name as string,
                noun: noun,
                verb: (doc.verb as string) || '',
              });
            }
          }
        }
      }
    }

    // Application activity
    if (record._type === 'applicationActivity' && record.applicationConnectionPoints) {
      dependencies.appConnections.push({
        activityName: record.name as string,
        connectionPoint: record.applicationConnectionPoints as string,
      });
    }

    // Workflow activity
    if (record._type === 'workflowActivity' && record.workflowName) {
      dependencies.workflows.push({
        activityName: record.name as string,
        workflowName: record.workflowName as string,
      });
    }

    // Mapping activity
    if (record._type === 'mappingActivity' && record.mappingName) {
      dependencies.mappings.push({
        activityName: record.name as string,
        mappingName: record.mappingName as string,
      });
    }

    // Recurse into flowParts and other nested structures
    if (record.flowParts && Array.isArray(record.flowParts)) {
      // Process flow parts in order to track document flow
      const parts = record.flowParts as Array<Record<string, unknown>>;
      for (let i = 0; i < parts.length; i++) {
        traverse(parts[i], i > 0 ? parts[i - 1] : undefined);
      }
    } else {
      for (const value of Object.values(record)) {
        traverse(value, record);
      }
    }
  }

  traverse(dataflow);

  // Now trace the document flow to determine which documents go to ION API activities
  // This requires understanding the sequential flow
  traceDocumentFlow(dataflow, dependencies);

  return dependencies;
}

/**
 * Trace document flow through dataflow to determine ION API input documents
 */
function traceDocumentFlow(
  dataflow: Record<string, unknown>,
  dependencies: DataflowDependencies
): void {
  // Find all activities with their sequence numbers
  const activities: Array<{
    type: string;
    name: string;
    sequenceNumber: number;
    outputDocs: Array<{ verb: string; noun: string }>;
    record: Record<string, unknown>;
  }> = [];

  function findActivities(obj: unknown): void {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(findActivities);
      return;
    }

    const record = obj as Record<string, unknown>;
    const type = record._type as string;

    if (
      type === 'ionApiActivity' ||
      type === 'scriptingActivity' ||
      type === 'applicationActivity' ||
      type === 'cbrFilterActivity'
    ) {
      const outputDocs: Array<{ verb: string; noun: string }> = [];

      // Get output documents from documentMappings (scripts)
      if (record.documentMappings && Array.isArray(record.documentMappings)) {
        for (const mapping of record.documentMappings) {
          if (mapping.outputDocument) {
            const outputDoc = mapping.outputDocument as string;
            const parts = outputDoc.split('.');
            if (parts.length === 2) {
              // Verb.Noun format (e.g., "Sync.Shipment")
              outputDocs.push({ verb: parts[0], noun: parts[1] });
            } else if (parts.length === 1) {
              // Just Noun format (e.g., "PA_RequestBody" for JSON documents)
              outputDocs.push({ verb: '', noun: parts[0] });
            }
          }
        }
      }

      // Get output documents from activityDocuments
      if (record.activityDocuments && Array.isArray(record.activityDocuments)) {
        for (const doc of record.activityDocuments) {
          if (doc.noun) {
            // Noun is required, verb can be empty (for JSON documents)
            outputDocs.push({ verb: doc.verb || '', noun: doc.noun });
          }
        }
      }

      activities.push({
        type,
        name: record.name as string,
        sequenceNumber: (record.sequenceNumber as number) ?? 0,
        outputDocs,
        record,
      });
    }

    // Recurse into nested structures
    if (record.flowParts && Array.isArray(record.flowParts)) {
      record.flowParts.forEach(findActivities);
    } else if (record.flowPart && typeof record.flowPart === 'object') {
      findActivities(record.flowPart);
    } else {
      for (const value of Object.values(record)) {
        if (typeof value === 'object') {
          findActivities(value);
        }
      }
    }
  }

  findActivities(dataflow);

  // Sort activities by sequence number to get execution order
  activities.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  logger.debug('Traced activities in order', {
    activities: activities.map((a) => ({
      name: a.name,
      type: a.type,
      seq: a.sequenceNumber,
      outputDocs: a.outputDocs,
    })),
  });

  // Now link outputs to ION API inputs
  // ION API activities receive documents from the immediately preceding activity
  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];

    if (activity.type === 'ionApiActivity') {
      // Find the previous non-filter activity's output
      for (let j = i - 1; j >= 0; j--) {
        const prevActivity = activities[j];
        if (prevActivity.outputDocs.length > 0) {
          const ionApiDep = dependencies.ionApiActivities.find(
            (d) => d.activityName === activity.name
          );

          if (ionApiDep) {
            ionApiDep.inputDocuments = prevActivity.outputDocs;
            logger.debug('Linked ION API activity to previous output', {
              ionApiActivity: activity.name,
              previousActivity: prevActivity.name,
              documents: prevActivity.outputDocs,
            });
          }
          break;
        }
      }
    }
  }
}

/**
 * Get the callName from a connection point's document group that handles a specific document
 */
function findCallNameForDocument(
  connectionPoint: Record<string, unknown>,
  verb: string,
  noun: string
): string | undefined {
  const documentGroups = connectionPoint.documentGroups as DocumentGroup[] | undefined;
  if (!documentGroups) return undefined;

  for (const group of documentGroups) {
    for (const doc of group.documents || []) {
      // Match on noun, and verb if provided (empty verb matches any verb)
      const verbMatches = !verb || doc.verb === verb;
      if (verbMatches && doc.noun === noun) {
        // Found matching document - get the callName
        const callNameProp = group.documentGroupProperties?.find((p) => p.name === 'callName');
        return callNameProp?.value;
      }
    }
  }

  return undefined;
}

/**
 * Check if a specific call name exists in a connection point's document groups
 */
function hasCallName(
  connectionPoint: Record<string, unknown>,
  callName: string
): boolean {
  const documentGroups = connectionPoint.documentGroups as DocumentGroup[] | undefined;
  if (!documentGroups) return false;

  for (const group of documentGroups) {
    const callNameProp = group.documentGroupProperties?.find((p) => p.name === 'callName');
    if (callNameProp?.value === callName) {
      return true;
    }
  }

  return false;
}

/**
 * Validate a dataflow's dependencies against a target environment
 */
export async function validateDataflowForDeployment(
  dataflowPath: string,
  targetClient: IONClient,
  localComponentsPath: string = './ion-components'
): Promise<DataflowValidationResult> {
  const issues: ValidationIssue[] = [];

  // Read dataflow
  if (!existsSync(dataflowPath)) {
    return {
      dataflow: dataflowPath,
      valid: false,
      issues: [
        {
          severity: 'error',
          component: 'dataflow',
          message: `Dataflow file not found: ${dataflowPath}`,
        },
      ],
      dependencies: {
        name: '',
        ionApiActivities: [],
        scripts: [],
        appConnections: [],
        customNouns: [],
        libraries: [],
        workflows: [],
        mappings: [],
      },
    };
  }

  const dataflowContent = await readFile(dataflowPath, 'utf-8');
  const dataflow = JSON.parse(dataflowContent) as Record<string, unknown>;
  const dependencies = parseDataflowDependencies(dataflow);

  logger.info('Validating dataflow dependencies', {
    name: dependencies.name,
    scripts: dependencies.scripts.length,
    ionApiActivities: dependencies.ionApiActivities.length,
    customNouns: dependencies.customNouns.length,
  });

  // Validate scripts exist in target and collect library dependencies
  const seenLibraries = new Set<string>();
  for (const script of dependencies.scripts) {
    const exists = await targetClient.componentExists(ComponentType.SCRIPTS, script.scriptName);
    if (!exists) {
      issues.push({
        severity: 'error',
        component: `Script: ${script.scriptName}`,
        message: `Script "${script.scriptName}" not found in target environment`,
        fix: `Deploy script first: ion-cicd deploy -t scripts -i ${script.scriptName}`,
      });
    }

    // Read local script metadata to find library dependencies
    const scriptMetaPath = join(localComponentsPath, 'Script', `${script.scriptName}.meta.json`);
    if (existsSync(scriptMetaPath)) {
      try {
        const metaContent = await readFile(scriptMetaPath, 'utf-8');
        const metadata = JSON.parse(metaContent) as { usedLibraries?: Array<{ name: string; version?: string }> };
        if (metadata.usedLibraries && Array.isArray(metadata.usedLibraries)) {
          for (const lib of metadata.usedLibraries) {
            if (!seenLibraries.has(lib.name)) {
              seenLibraries.add(lib.name);
              dependencies.libraries.push({
                scriptName: script.scriptName,
                libraryName: lib.name,
                version: lib.version,
              });
            }
          }
        }
      } catch {
        // Ignore errors reading metadata
      }
    }
  }

  // Validate libraries exist in target
  for (const library of dependencies.libraries) {
    const exists = await targetClient.componentExists(ComponentType.LIBRARIES, library.libraryName);
    if (!exists) {
      issues.push({
        severity: 'error',
        component: `Library: ${library.libraryName}`,
        message: `Library "${library.libraryName}" not found in target environment (used by script "${library.scriptName}")`,
        fix: `Deploy library first: ion-cicd deploy -t libraries -i ${library.libraryName}`,
      });
    }
  }

  // Validate workflows exist in target
  for (const workflow of dependencies.workflows) {
    const exists = await targetClient.componentExists(ComponentType.WORKFLOWS, workflow.workflowName);
    if (!exists) {
      issues.push({
        severity: 'error',
        component: `Workflow: ${workflow.workflowName}`,
        message: `Workflow "${workflow.workflowName}" not found in target environment`,
        fix: `Deploy workflow first: ion-cicd deploy -t workflows -i ${workflow.workflowName}`,
      });
    }
  }

  // Validate mappings exist in target
  for (const mapping of dependencies.mappings) {
    const exists = await targetClient.componentExists(ComponentType.MAPPINGS, mapping.mappingName);
    if (!exists) {
      issues.push({
        severity: 'error',
        component: `Mapping: ${mapping.mappingName}`,
        message: `Mapping "${mapping.mappingName}" not found in target environment`,
        fix: `Deploy mapping first: ion-cicd deploy -t mappings -i ${mapping.mappingName}`,
      });
    }
  }

  // Validate custom schemas (BOD or Object) exist in target
  for (const customNoun of dependencies.customNouns) {
    // Try BOD schema first, then Object schema
    const isBodSchema = await targetClient.componentExists(ComponentType.BOD_SCHEMAS, customNoun.noun);
    const isObjectSchema = !isBodSchema && await targetClient.componentExists(ComponentType.OBJECT_SCHEMAS, customNoun.noun);

    if (!isBodSchema && !isObjectSchema) {
      issues.push({
        severity: 'error',
        component: `BOD Schema: ${customNoun.noun}`,
        message: `Custom BOD schema "${customNoun.noun}" not found in target environment`,
        fix: `Deploy BOD schema first: ion-cicd deploy -t bodschemas -i ${customNoun.noun}`,
      });
    }
  }

  // Validate ION API connection points and their document groups
  for (const ionApi of dependencies.ionApiActivities) {
    // Check if connection point exists
    const cpExists = await targetClient.componentExists(ComponentType.CONNECTION_POINTS, ionApi.connectionPoint);
    if (!cpExists) {
      issues.push({
        severity: 'error',
        component: `Connection Point: ${ionApi.connectionPoint}`,
        message: `Connection point "${ionApi.connectionPoint}" not found in target environment`,
      });
      continue;
    }

    // Get the connection point details for API call validation
    const targetCP = (await targetClient.getComponent(
      ComponentType.CONNECTION_POINTS,
      ionApi.connectionPoint
    )) as Record<string, unknown>;

    // If the dataflow specifies an explicit call name, check for that directly
    if (ionApi.explicitCallName) {
      if (!hasCallName(targetCP, ionApi.explicitCallName)) {
        issues.push({
          severity: 'error',
          component: `Connection Point: ${ionApi.connectionPoint}`,
          message: `Missing API call "${ionApi.explicitCallName}" in connection point`,
          details: `The dataflow activity "${ionApi.activityName}" requires the API call "${ionApi.explicitCallName}"`,
          fix: `Add the "${ionApi.explicitCallName}" API call to ${ionApi.connectionPoint} in ION Desk, or use --sync-dependencies --source-env <env>`,
        });
        // Store the required call name for potential auto-fix
        ionApi.requiredCallName = ionApi.explicitCallName;
      }
      continue; // Skip document-based matching if explicit call name is specified
    }

    // Check if the required API calls exist (by document matching)
    for (const doc of ionApi.inputDocuments) {
      const targetCallName = findCallNameForDocument(targetCP, doc.verb, doc.noun);

      if (!targetCallName) {
        // Check the local source to find what call name should be used
        const localCPPath = join(
          localComponentsPath,
          'Connection point',
          `${ionApi.connectionPoint}.json`
        );
        let sourceCallName: string | undefined;

        if (existsSync(localCPPath)) {
          const localCPContent = await readFile(localCPPath, 'utf-8');
          const localCP = JSON.parse(localCPContent) as Record<string, unknown>;
          sourceCallName = findCallNameForDocument(localCP, doc.verb, doc.noun);
        }

        issues.push({
          severity: 'error',
          component: `Connection Point: ${ionApi.connectionPoint}`,
          message: `Missing API call for document "${doc.verb}.${doc.noun}"`,
          details: sourceCallName
            ? `The API call "${sourceCallName}" needs to be added to handle this document`
            : `No API call configured to handle "${doc.verb}.${doc.noun}" documents`,
          fix: `Add the "${sourceCallName || doc.verb + '.' + doc.noun}" API call to ${ionApi.connectionPoint} in ION Desk, or sync the connection point`,
        });

        // Store the required call name for potential auto-fix
        ionApi.requiredCallName = sourceCallName;
      }
    }
  }

  // Validate application connection points
  for (const appConn of dependencies.appConnections) {
    const exists = await targetClient.componentExists(ComponentType.CONNECTION_POINTS, appConn.connectionPoint);
    if (!exists) {
      issues.push({
        severity: 'error',
        component: `Connection Point: ${appConn.connectionPoint}`,
        message: `Application connection point "${appConn.connectionPoint}" not found in target environment`,
      });
    }
  }

  return {
    dataflow: dependencies.name,
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
    dependencies,
  };
}

/**
 * Sync a connection point's document groups from source to target
 */
export async function syncConnectionPointApiCalls(
  connectionPointName: string,
  sourceClient: IONClient,
  targetClient: IONClient,
  requiredCallNames: string[]
): Promise<{ synced: string[]; failed: string[] }> {
  const synced: string[] = [];
  const failed: string[] = [];

  try {
    // Get source connection point
    const sourceCP = (await sourceClient.getComponent(
      ComponentType.CONNECTION_POINTS,
      connectionPointName
    )) as Record<string, unknown>;

    // Get target connection point
    const targetCP = (await targetClient.getComponent(
      ComponentType.CONNECTION_POINTS,
      connectionPointName
    )) as Record<string, unknown>;

    const sourceGroups = (sourceCP.documentGroups || []) as DocumentGroup[];
    const targetGroups = (targetCP.documentGroups || []) as DocumentGroup[];

    // Find missing document groups by callName
    const targetCallNames = new Set(
      targetGroups.map((g) => {
        const prop = g.documentGroupProperties?.find((p) => p.name === 'callName');
        return prop?.value;
      })
    );

    const groupsToAdd: DocumentGroup[] = [];
    for (const sourceGroup of sourceGroups) {
      const callNameProp = sourceGroup.documentGroupProperties?.find((p) => p.name === 'callName');
      const callName = callNameProp?.value;

      if (callName && requiredCallNames.includes(callName) && !targetCallNames.has(callName)) {
        groupsToAdd.push(sourceGroup);
      }
    }

    if (groupsToAdd.length > 0) {
      // Add missing groups to target
      const updatedGroups = [...targetGroups, ...groupsToAdd];
      (targetCP as Record<string, unknown>).documentGroups = updatedGroups;

      // Update the connection point
      await targetClient.updateComponent(
        ComponentType.CONNECTION_POINTS,
        connectionPointName,
        targetCP as unknown as import('../types/index.js').IONComponentDetail
      );

      for (const group of groupsToAdd) {
        const callName =
          group.documentGroupProperties?.find((p) => p.name === 'callName')?.value || 'Unknown';
        synced.push(callName);
      }
    }
  } catch (error) {
    logger.error('Failed to sync connection point', { connectionPointName, error: String(error) });
    failed.push(...requiredCallNames);
  }

  return { synced, failed };
}
