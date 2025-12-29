/**
 * ION Component Type Definitions
 * Defines all ION component types and their configurations
 */

/**
 * Enumeration of all supported ION component types
 */
export enum ComponentType {
  DATAFLOWS = 'dataflows',
  CONNECTION_POINTS = 'connectionpoints',
  MAPPINGS = 'mappings',
  WORKFLOWS = 'workflows',
  ACTIVATION_POLICIES = 'activationpolicies',
  FILE_TEMPLATES = 'fileformattemplates',
  ENTERPRISE_LOCATIONS = 'enterpriselocations',
  SCRIPTS = 'scripts',
  LIBRARIES = 'libraries',
  BOD_SCHEMAS = 'bodschemas',
  OBJECT_SCHEMAS = 'objectschemas',
}

/**
 * Human-readable display names for component types
 */
export const COMPONENT_DISPLAY_NAMES: Record<ComponentType, string> = {
  [ComponentType.DATAFLOWS]: 'Document flow',
  [ComponentType.CONNECTION_POINTS]: 'Connection point',
  [ComponentType.MAPPINGS]: 'Mapping',
  [ComponentType.WORKFLOWS]: 'Workflow',
  [ComponentType.ACTIVATION_POLICIES]: 'Activation policy',
  [ComponentType.FILE_TEMPLATES]: 'File template',
  [ComponentType.ENTERPRISE_LOCATIONS]: 'Enterprise Connector',
  [ComponentType.SCRIPTS]: 'Script',
  [ComponentType.LIBRARIES]: 'Library',
  [ComponentType.BOD_SCHEMAS]: 'BOD schema',
  [ComponentType.OBJECT_SCHEMAS]: 'Object schema',
};

/**
 * Import order for components based on their dependencies
 * Components must be imported in this order to satisfy dependencies
 */
export const IMPORT_ORDER: ComponentType[] = [
  ComponentType.BOD_SCHEMAS, // 0. BOD schemas - dataflows may reference custom BODs
  ComponentType.OBJECT_SCHEMAS, // 0. Object schemas - no dependencies
  ComponentType.LIBRARIES, // 1. No dependencies - scripts depend on libraries
  ComponentType.CONNECTION_POINTS, // 2. No dependencies
  ComponentType.FILE_TEMPLATES, // 3. No dependencies
  ComponentType.ENTERPRISE_LOCATIONS, // 4. No dependencies
  ComponentType.SCRIPTS, // 5. Depends on libraries
  ComponentType.MAPPINGS, // 6. May reference connection points
  ComponentType.DATAFLOWS, // 7. References connection points, mappings, BOD schemas
  ComponentType.WORKFLOWS, // 8. May reference dataflows, scripts
  ComponentType.ACTIVATION_POLICIES, // 9. References workflows
];

/**
 * API endpoints for each component type
 */
export const COMPONENT_ENDPOINTS: Record<ComponentType, string> = {
  [ComponentType.DATAFLOWS]: '/IONSERVICES/connect/model/v1/dataflows',
  [ComponentType.CONNECTION_POINTS]: '/IONSERVICES/connect/model/v1/connectionpoints',
  [ComponentType.MAPPINGS]: '/IONSERVICES/connect/model/v1/mappings',
  [ComponentType.WORKFLOWS]: '/IONSERVICES/process/model/v1/workflows',
  [ComponentType.ACTIVATION_POLICIES]: '/IONSERVICES/process/model/v1/activationpolicies',
  [ComponentType.FILE_TEMPLATES]: '/IONSERVICES/connect/model/v1/fileformattemplates',
  [ComponentType.ENTERPRISE_LOCATIONS]: '/IONSERVICES/connect/model/v1/enterpriselocations',
  [ComponentType.SCRIPTS]: '/IONSERVICES/scriptingservice/model/v1/scripts',
  [ComponentType.LIBRARIES]: '/IONSERVICES/scriptingservice/model/v1/libraries',
  [ComponentType.BOD_SCHEMAS]: '/DATAFABRIC/datacatalog/v1/noun',
  [ComponentType.OBJECT_SCHEMAS]: '/DATAFABRIC/datacatalog/v1/object',
};

/**
 * Component configuration including dependencies and special handling requirements
 */
export interface ComponentConfig {
  displayName: string;
  endpoint: string;
  importOrder: number;
  dependencies: ComponentType[];
  specialHandling?: 'mapping' | 'enterprise-connector' | 'script' | 'library' | 'bod-schema' | 'object-schema';
}

/**
 * Full configuration for all component types
 */
export const COMPONENT_CONFIG: Record<ComponentType, ComponentConfig> = {
  [ComponentType.CONNECTION_POINTS]: {
    displayName: 'Connection point',
    endpoint: COMPONENT_ENDPOINTS[ComponentType.CONNECTION_POINTS],
    importOrder: 1,
    dependencies: [],
  },
  [ComponentType.FILE_TEMPLATES]: {
    displayName: 'File template',
    endpoint: COMPONENT_ENDPOINTS[ComponentType.FILE_TEMPLATES],
    importOrder: 2,
    dependencies: [],
  },
  [ComponentType.ENTERPRISE_LOCATIONS]: {
    displayName: 'Enterprise Connector',
    endpoint: COMPONENT_ENDPOINTS[ComponentType.ENTERPRISE_LOCATIONS],
    importOrder: 3,
    dependencies: [],
    specialHandling: 'enterprise-connector',
  },
  [ComponentType.MAPPINGS]: {
    displayName: 'Mapping',
    endpoint: COMPONENT_ENDPOINTS[ComponentType.MAPPINGS],
    importOrder: 4,
    dependencies: [ComponentType.CONNECTION_POINTS],
    specialHandling: 'mapping',
  },
  [ComponentType.DATAFLOWS]: {
    displayName: 'Document flow',
    endpoint: COMPONENT_ENDPOINTS[ComponentType.DATAFLOWS],
    importOrder: 5,
    dependencies: [ComponentType.CONNECTION_POINTS, ComponentType.MAPPINGS],
  },
  [ComponentType.WORKFLOWS]: {
    displayName: 'Workflow',
    endpoint: COMPONENT_ENDPOINTS[ComponentType.WORKFLOWS],
    importOrder: 6,
    dependencies: [ComponentType.DATAFLOWS],
  },
  [ComponentType.ACTIVATION_POLICIES]: {
    displayName: 'Activation policy',
    endpoint: COMPONENT_ENDPOINTS[ComponentType.ACTIVATION_POLICIES],
    importOrder: 9,
    dependencies: [ComponentType.WORKFLOWS],
  },
  [ComponentType.LIBRARIES]: {
    displayName: 'Library',
    endpoint: COMPONENT_ENDPOINTS[ComponentType.LIBRARIES],
    importOrder: 1,
    dependencies: [],
    specialHandling: 'library',
  },
  [ComponentType.SCRIPTS]: {
    displayName: 'Script',
    endpoint: COMPONENT_ENDPOINTS[ComponentType.SCRIPTS],
    importOrder: 5,
    dependencies: [ComponentType.LIBRARIES],
    specialHandling: 'script',
  },
  [ComponentType.BOD_SCHEMAS]: {
    displayName: 'BOD schema',
    endpoint: COMPONENT_ENDPOINTS[ComponentType.BOD_SCHEMAS],
    importOrder: 0,
    dependencies: [],
    specialHandling: 'bod-schema',
  },
  [ComponentType.OBJECT_SCHEMAS]: {
    displayName: 'Object schema',
    endpoint: COMPONENT_ENDPOINTS[ComponentType.OBJECT_SCHEMAS],
    importOrder: 0,
    dependencies: [],
    specialHandling: 'object-schema',
  },
};

/**
 * Base interface for ION components (list view)
 */
export interface IONComponent {
  name: string;
  description?: string;
}

/**
 * Extended interface for ION component details
 */
export interface IONComponentDetail extends IONComponent {
  [key: string]: unknown;
}

/**
 * Mapping model structure (used in Mapping components)
 */
export interface MappingModel {
  mapperName: string;
  [key: string]: unknown;
}

/**
 * Mapping component with special structure
 */
export interface MappingComponent extends IONComponentDetail {
  mappingModels?: MappingModel[];
}

/**
 * Enterprise Connector component (limited fields on import)
 */
export interface EnterpriseConnectorComponent extends IONComponentDetail {
  name: string;
  description: string;
}

/**
 * Script variable definition
 */
export interface ScriptVariable {
  name: string;
  type: 'STRING' | 'INTEGER' | 'BINARY' | 'NUMBER' | 'BOOLEAN';
  description?: string;
}

/**
 * Script library reference
 */
export interface ScriptLibraryRef {
  name: string;
  version: string;
}

/**
 * Script status in ION
 */
export type ScriptStatus = 'DRAFT' | 'APPROVED' | 'APPROVED_WITH_DRAFT';

/**
 * Script component structure
 */
export interface ScriptComponent extends IONComponentDetail {
  name: string;
  description?: string;
  scriptCode: string;
  documentation?: string;
  versionNumber?: number;
  status?: ScriptStatus;
  inputVariables?: ScriptVariable[];
  outputVariables?: ScriptVariable[];
  usedLibraries?: ScriptLibraryRef[];
}

/**
 * Library component structure (Python .whl files)
 */
export interface LibraryComponent extends IONComponentDetail {
  name: string;
  description?: string;
  version?: string;
  file?: string; // base64 encoded .whl file
  fileName?: string; // e.g., "mylib-1.0.0-py2.py3-none-any.whl"
}

/**
 * BOD Schema (Noun) from Datacatalog API
 * Custom BOD definitions with XSD schema and XML metadata
 */
export interface BODSchemaComponent extends IONComponentDetail {
  name: string;
  /** Whether this is a standard (built-in) or custom BOD */
  standard: boolean;
  /** XSD schema content */
  nounSchemaXsd?: string;
  /** XML metadata content */
  nounMetadataXml?: string;
  /** Noun properties */
  properties?: {
    identifierPath?: string;
    accountingEntityPath?: string;
    locationPath?: string;
    statusPath?: string;
    verbs?: string[];
    relations?: Array<{
      fromPath: string;
      toNoun: string;
      toPath: string;
    }>;
  };
}

/**
 * Object Schema types from Datacatalog API
 */
export type ObjectSchemaType = 'JSON' | 'DSV' | 'ANY' | 'VIEW';

/**
 * Object Schema from Datacatalog API
 * JSON, DSV, ANY, or VIEW schema definitions
 */
export interface ObjectSchemaComponent extends IONComponentDetail {
  name: string;
  type: ObjectSchemaType;
  subType?: string; // e.g., 'CSV' for DSV
  /** JSON Schema (draft-06) for JSON/DSV types */
  schema?: Record<string, unknown>;
  /** Additional properties */
  properties?: Record<string, unknown>;
  lastUpdatedOn?: number;
  lastUpdatedBy?: string;
}
