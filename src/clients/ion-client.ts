/**
 * ION API Client
 * Handles authentication and component operations with the Infor ION API
 */

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import {
  IONApiConfig,
  ComponentType,
  IONComponent,
  IONComponentDetail,
  COMPONENT_ENDPOINTS,
} from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { withRetry, RetryConfig, DEFAULT_RETRY_CONFIG } from '../utils/retry.js';
import { AuthenticationError, TokenRefreshError, IONApiError } from '../utils/errors.js';

const logger = new Logger('IONClient');

/**
 * Token information structure
 */
interface TokenInfo {
  accessToken: string;
  expiresAt: Date;
}

/**
 * ION API Client for interacting with Infor ION services
 */
export class IONClient {
  private config: IONApiConfig;
  private axiosInstance: AxiosInstance;
  private tokenInfo: TokenInfo | null = null;
  private retryConfig: RetryConfig;
  private tokenRefreshBuffer: number;

  /**
   * Creates a new IONClient instance
   * @param config - ION API configuration from .ionapi file
   * @param options - Additional options
   */
  constructor(
    config: IONApiConfig,
    options: {
      retryConfig?: RetryConfig;
      tokenRefreshBufferSeconds?: number;
    } = {}
  ) {
    this.config = config;
    this.retryConfig = options.retryConfig ?? DEFAULT_RETRY_CONFIG;
    this.tokenRefreshBuffer = (options.tokenRefreshBufferSeconds ?? 300) * 1000; // Convert to ms

    // Build base URL from config
    const baseURL = `${this.config.iu}/${this.config.ti}`;

    this.axiosInstance = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Add request interceptor for token management
    this.axiosInstance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        await this.ensureValidToken();
        if (this.tokenInfo) {
          config.headers.Authorization = `Bearer ${this.tokenInfo.accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );
  }

  /**
   * Gets the base URL for the ION API
   */
  public getBaseUrl(): string {
    return `${this.config.iu}/${this.config.ti}`;
  }

  /**
   * Gets the current access token
   * @returns The current access token or null if not authenticated
   */
  public getToken(): string | null {
    return this.tokenInfo?.accessToken ?? null;
  }

  /**
   * Checks if the token is valid and not expiring soon
   */
  private isTokenValid(): boolean {
    if (!this.tokenInfo) {
      return false;
    }

    const now = Date.now();
    const expiresAt = this.tokenInfo.expiresAt.getTime();
    return now < expiresAt - this.tokenRefreshBuffer;
  }

  /**
   * Ensures a valid token is available, refreshing if necessary
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.isTokenValid()) {
      await this.authenticate();
    }
  }

  /**
   * Authenticates with the ION API and obtains an access token
   */
  public async authenticate(): Promise<void> {
    const { ci, cs, saak, sask, pu, ot } = this.config;
    const tokenUrl = `${pu}${ot}`;

    logger.debug('Authenticating with ION API', { tokenUrl });

    try {
      const response = await axios.post(
        tokenUrl,
        new URLSearchParams({
          grant_type: 'password',
          client_id: ci,
          client_secret: cs,
          username: saak,
          password: sask,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, expires_in } = response.data as {
        access_token: string;
        expires_in: number;
      };

      this.tokenInfo = {
        accessToken: access_token,
        expiresAt: new Date(Date.now() + expires_in * 1000),
      };

      logger.info('Successfully authenticated', {
        expiresIn: `${expires_in}s`,
        tenant: this.config.ti,
      });
    } catch (error) {
      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status;
      const errorData = axiosError.response?.data;

      logger.error('Authentication failed', { statusCode, error: errorData });

      if (statusCode === 401) {
        throw new AuthenticationError('Invalid credentials', errorData);
      }

      throw new TokenRefreshError('Failed to obtain access token', errorData);
    }
  }

  /**
   * Lists all components of a given type
   * @param type - The component type to list
   * @param customOnly - For BOD schemas, only return custom (non-standard) schemas
   * @returns Array of component summaries
   */
  public async listComponents(type: ComponentType, customOnly: boolean = true): Promise<IONComponent[]> {
    // Handle Datacatalog API types specially
    if (type === ComponentType.BOD_SCHEMAS) {
      return this.listBODSchemas(customOnly);
    }
    if (type === ComponentType.OBJECT_SCHEMAS) {
      return this.listObjectSchemas();
    }

    const endpoint = COMPONENT_ENDPOINTS[type];
    logger.debug('Listing components', { type, endpoint });

    return withRetry(async () => {
      try {
        const response = await this.axiosInstance.get<IONComponent[]>(endpoint);
        logger.info('Listed components', { type, count: response.data.length });
        return response.data;
      } catch (error) {
        this.handleApiError(error, `Failed to list ${type}`);
        throw error; // Re-throw for retry logic
      }
    }, this.retryConfig);
  }

  /**
   * Lists BOD schemas from Datacatalog API
   * @param customOnly - Only return custom (non-standard) schemas
   */
  private async listBODSchemas(customOnly: boolean = true): Promise<IONComponent[]> {
    const endpoint = `${COMPONENT_ENDPOINTS[ComponentType.BOD_SCHEMAS]}/list`;
    logger.debug('Listing BOD schemas', { endpoint, customOnly });

    return withRetry(async () => {
      try {
        const response = await this.axiosInstance.get<{ nouns: Array<{ name: string; standard: boolean }> }>(endpoint);
        let nouns = response.data.nouns || [];

        // Filter to custom only if requested
        if (customOnly) {
          nouns = nouns.filter(n => !n.standard);
        }

        logger.info('Listed BOD schemas', { total: response.data.nouns?.length, filtered: nouns.length, customOnly });
        return nouns.map(n => ({ name: n.name, description: n.standard ? 'Standard BOD' : 'Custom BOD' }));
      } catch (error) {
        this.handleApiError(error, 'Failed to list BOD schemas');
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Lists Object schemas from Datacatalog API
   * Only returns custom schemas (excludes standard, system prefixes, Importer, and Verb.Noun patterns)
   * @param types - Filter by object types (JSON, DSV, ANY, VIEW)
   */
  private async listObjectSchemas(types?: string[]): Promise<IONComponent[]> {
    let endpoint = `${COMPONENT_ENDPOINTS[ComponentType.OBJECT_SCHEMAS]}/list`;
    if (types && types.length > 0) {
      endpoint += `?type=${types.join(',')}`;
    }
    logger.debug('Listing Object schemas', { endpoint });

    // Prefixes to exclude (system-generated objects)
    const excludePrefixes = ['CSWMS_', 'ION_', 'AM_'];

    return withRetry(async () => {
      try {
        const response = await this.axiosInstance.get<{ objects: Array<{ name: string; type: string; standard: boolean; lastUpdatedBy?: string }> }>(endpoint);
        const allObjects = response.data.objects || [];

        // Filter to only custom objects: non-standard, not system-generated, not imported, no Verb.Noun patterns
        const objects = allObjects.filter(o =>
          o.standard === false &&
          !excludePrefixes.some(prefix => o.name.startsWith(prefix)) &&
          o.lastUpdatedBy !== 'Importer' &&
          !o.name.includes('.')
        );

        logger.info('Listed Object schemas', { total: allObjects.length, custom: objects.length, excluded: allObjects.length - objects.length });
        return objects.map(o => ({ name: o.name, description: `${o.type} schema` }));
      } catch (error) {
        this.handleApiError(error, 'Failed to list Object schemas');
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Gets detailed information for a specific component
   * @param type - The component type
   * @param name - The component name
   * @returns The component details
   */
  public async getComponent(type: ComponentType, name: string): Promise<IONComponentDetail> {
    // Handle Datacatalog API types specially
    if (type === ComponentType.BOD_SCHEMAS) {
      return this.getBODSchema(name);
    }
    if (type === ComponentType.OBJECT_SCHEMAS) {
      return this.getObjectSchema(name);
    }

    const endpoint = `${COMPONENT_ENDPOINTS[type]}/${encodeURIComponent(name)}`;
    logger.debug('Getting component', { type, name, endpoint });

    return withRetry(async () => {
      try {
        const response = await this.axiosInstance.get<IONComponentDetail>(endpoint);
        logger.debug('Got component details', { type, name });
        return response.data;
      } catch (error) {
        this.handleApiError(error, `Failed to get ${type} "${name}"`);
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Checks if a component exists in the environment without logging errors
   * Use this for validation checks where 404s are expected
   * @param type - The component type
   * @param name - The component name
   * @returns True if the component exists, false otherwise
   */
  async componentExists(type: ComponentType, name: string): Promise<boolean> {
    try {
      await this.getComponentSilent(type, name);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gets a component without logging errors on failure
   * Used internally for existence checks
   */
  private async getComponentSilent(type: ComponentType, name: string): Promise<IONComponentDetail> {
    // Handle special component types
    if (type === ComponentType.BOD_SCHEMAS) {
      return this.getBODSchemaSilent(name);
    }
    if (type === ComponentType.OBJECT_SCHEMAS) {
      return this.getObjectSchemaSilent(name);
    }

    const endpoint = `${COMPONENT_ENDPOINTS[type]}/${encodeURIComponent(name)}`;

    const response = await this.axiosInstance.get<IONComponentDetail>(endpoint);
    return response.data;
  }

  /**
   * Gets a BOD schema without logging errors
   */
  private async getBODSchemaSilent(name: string): Promise<IONComponentDetail> {
    const baseEndpoint = COMPONENT_ENDPOINTS[ComponentType.BOD_SCHEMAS];

    const [xsdResponse, xmlResponse] = await Promise.all([
      this.axiosInstance.get(`${baseEndpoint}/${encodeURIComponent(name)}/xsd`),
      this.axiosInstance.get<string>(`${baseEndpoint}/${encodeURIComponent(name)}/xml`, {
        responseType: 'text',
      }),
    ]);

    return {
      name,
      nounSchemaXsd: xsdResponse.data?.mainSchema?.schemaContent || '',
      nounMetadataXml: xmlResponse.data,
    } as IONComponentDetail;
  }

  /**
   * Gets an Object schema without logging errors
   */
  private async getObjectSchemaSilent(name: string): Promise<IONComponentDetail> {
    const endpoint = `${COMPONENT_ENDPOINTS[ComponentType.OBJECT_SCHEMAS]}/${encodeURIComponent(name)}`;
    const response = await this.axiosInstance.get<IONComponentDetail>(endpoint);
    return response.data;
  }

  /**
   * Gets a BOD schema with its XSD and XML metadata
   * @param name - The noun/BOD name
   */
  private async getBODSchema(name: string): Promise<IONComponentDetail> {
    const baseEndpoint = COMPONENT_ENDPOINTS[ComponentType.BOD_SCHEMAS];
    logger.debug('Getting BOD schema', { name });

    // Define the XSD response structure from Datacatalog API
    interface XsdResponse {
      mainSchema?: {
        path?: string;
        schemaContent: string;
      };
      imports?: Array<{
        path?: string;
        schemaContent: string;
      }>;
    }

    return withRetry(async () => {
      try {
        // Fetch XSD (returns JSON with schema content) and XML (returns raw XML) in parallel
        const [xsdResponse, xmlResponse] = await Promise.all([
          this.axiosInstance.get<XsdResponse>(`${baseEndpoint}/${encodeURIComponent(name)}/xsd`),
          this.axiosInstance.get<string>(`${baseEndpoint}/${encodeURIComponent(name)}/xml`, {
            responseType: 'text',
          }),
        ]);

        // Extract XSD content from the JSON response structure
        let xsdContent: string;
        const xsdData = xsdResponse.data;
        if (xsdData.mainSchema?.schemaContent) {
          xsdContent = xsdData.mainSchema.schemaContent;
        } else if (typeof xsdData === 'string') {
          xsdContent = xsdData;
        } else {
          // Fallback: store the full JSON if structure is unexpected
          xsdContent = JSON.stringify(xsdData);
        }

        logger.debug('Got BOD schema', { name });
        return {
          name,
          standard: false, // We only export custom BODs
          nounSchemaXsd: xsdContent,
          nounMetadataXml: xmlResponse.data,
        };
      } catch (error) {
        this.handleApiError(error, `Failed to get BOD schema "${name}"`);
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Gets an Object schema with its full details
   * @param name - The object schema name
   */
  private async getObjectSchema(name: string): Promise<IONComponentDetail> {
    const endpoint = `${COMPONENT_ENDPOINTS[ComponentType.OBJECT_SCHEMAS]}/${encodeURIComponent(name)}`;
    logger.debug('Getting Object schema', { name, endpoint });

    return withRetry(async () => {
      try {
        const response = await this.axiosInstance.get<IONComponentDetail>(endpoint);
        logger.debug('Got Object schema', { name });
        return response.data;
      } catch (error) {
        this.handleApiError(error, `Failed to get Object schema "${name}"`);
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Creates a new component
   * @param type - The component type
   * @param data - The component data
   */
  public async createComponent(type: ComponentType, data: IONComponentDetail): Promise<void> {
    // Handle Datacatalog API types specially
    if (type === ComponentType.BOD_SCHEMAS) {
      return this.createBODSchema(data);
    }
    if (type === ComponentType.OBJECT_SCHEMAS) {
      return this.createObjectSchema(data);
    }

    const endpoint = COMPONENT_ENDPOINTS[type];
    logger.debug('Creating component', { type, name: data.name, endpoint });

    return withRetry(async () => {
      try {
        await this.axiosInstance.post(endpoint, data);
        logger.info('Created component', { type, name: data.name });
      } catch (error) {
        this.handleApiError(error, `Failed to create ${type} "${data.name}"`);
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Creates or updates a BOD schema
   * @param data - The BOD schema data with nounSchemaXsd and nounMetadataXml
   */
  private async createBODSchema(data: IONComponentDetail): Promise<void> {
    const endpoint = COMPONENT_ENDPOINTS[ComponentType.BOD_SCHEMAS];
    const bodData = data as { name: string; nounSchemaXsd?: string; nounMetadataXml?: string };
    logger.debug('Creating BOD schema', { name: bodData.name, endpoint });

    return withRetry(async () => {
      try {
        await this.axiosInstance.post(endpoint, {
          nounSchemaXsd: bodData.nounSchemaXsd,
          nounMetadataXml: bodData.nounMetadataXml,
        });
        logger.info('Created BOD schema', { name: bodData.name });
      } catch (error) {
        this.handleApiError(error, `Failed to create BOD schema "${bodData.name}"`);
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Creates or updates an Object schema
   * @param data - The Object schema data
   */
  private async createObjectSchema(data: IONComponentDetail): Promise<void> {
    const endpoint = COMPONENT_ENDPOINTS[ComponentType.OBJECT_SCHEMAS];
    logger.debug('Creating Object schema', { name: data.name, endpoint });

    return withRetry(async () => {
      try {
        await this.axiosInstance.post(endpoint, data);
        logger.info('Created Object schema', { name: data.name });
      } catch (error) {
        this.handleApiError(error, `Failed to create Object schema "${data.name}"`);
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Updates an existing component
   * @param type - The component type
   * @param name - The component name
   * @param data - The updated component data
   */
  public async updateComponent(
    type: ComponentType,
    name: string,
    data: IONComponentDetail
  ): Promise<void> {
    // BOD schemas use POST for create/update (same endpoint)
    if (type === ComponentType.BOD_SCHEMAS) {
      return this.createBODSchema(data);
    }
    // Object schemas use PUT for update
    if (type === ComponentType.OBJECT_SCHEMAS) {
      return this.updateObjectSchema(name, data);
    }

    const endpoint = `${COMPONENT_ENDPOINTS[type]}/${encodeURIComponent(name)}`;
    logger.debug('Updating component', { type, name, endpoint });

    // For connection points, preserve existing connection settings (credentials, serviceAccount, etc.)
    const params = type === ComponentType.CONNECTION_POINTS
      ? { keepExistingConnectionSettings: true }
      : undefined;

    return withRetry(async () => {
      try {
        await this.axiosInstance.put(endpoint, data, { params });
        logger.info('Updated component', { type, name });
      } catch (error) {
        this.handleApiError(error, `Failed to update ${type} "${name}"`);
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Updates an Object schema (uses POST like BOD schemas - PUT not allowed)
   * @param _name - The object schema name (unused, kept for interface consistency)
   * @param data - The updated schema data
   */
  private async updateObjectSchema(_name: string, data: IONComponentDetail): Promise<void> {
    // Object schemas use POST for update (same as create) - PUT returns 405
    return this.createObjectSchema(data);
  }

  /**
   * Deletes a component
   * @param type - The component type
   * @param name - The component name
   */
  public async deleteComponent(type: ComponentType, name: string): Promise<void> {
    // BOD schemas have a different delete endpoint
    if (type === ComponentType.BOD_SCHEMAS) {
      return this.deleteBODSchema(name);
    }

    const endpoint = `${COMPONENT_ENDPOINTS[type]}/${encodeURIComponent(name)}`;
    logger.debug('Deleting component', { type, name, endpoint });

    return withRetry(async () => {
      try {
        await this.axiosInstance.delete(endpoint);
        logger.info('Deleted component', { type, name });
      } catch (error) {
        this.handleApiError(error, `Failed to delete ${type} "${name}"`);
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Deletes a BOD schema
   * @param name - The noun/BOD name
   */
  private async deleteBODSchema(name: string): Promise<void> {
    const endpoint = `${COMPONENT_ENDPOINTS[ComponentType.BOD_SCHEMAS]}/${encodeURIComponent(name)}`;
    logger.debug('Deleting BOD schema', { name, endpoint });

    return withRetry(async () => {
      try {
        await this.axiosInstance.delete(endpoint);
        logger.info('Deleted BOD schema', { name });
      } catch (error) {
        this.handleApiError(error, `Failed to delete BOD schema "${name}"`);
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Gets the approved version of a script
   * @param name - The script name
   * @returns The approved script details
   */
  public async getApprovedScript(name: string): Promise<IONComponentDetail> {
    const endpoint = `${COMPONENT_ENDPOINTS[ComponentType.SCRIPTS]}/${encodeURIComponent(name)}?approved=true`;
    logger.debug('Getting approved script', { name, endpoint });

    return withRetry(async () => {
      try {
        const response = await this.axiosInstance.get<IONComponentDetail>(endpoint);
        logger.debug('Got approved script', { name });
        return response.data;
      } catch (error) {
        this.handleApiError(error, `Failed to get approved script "${name}"`);
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Approves a script (makes draft version the approved version)
   * @param name - The script name to approve
   */
  public async approveScript(name: string): Promise<void> {
    const endpoint = `${COMPONENT_ENDPOINTS[ComponentType.SCRIPTS]}/${encodeURIComponent(name)}/approve`;
    logger.debug('Approving script', { name, endpoint });

    return withRetry(async () => {
      try {
        await this.axiosInstance.put(endpoint);
        logger.info('Approved script', { name });
      } catch (error) {
        this.handleApiError(error, `Failed to approve script "${name}"`);
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Approves multiple scripts at once
   * @param names - Array of script names to approve
   */
  public async approveScripts(names: string[]): Promise<void> {
    const endpoint = `${COMPONENT_ENDPOINTS[ComponentType.SCRIPTS]}/approve`;
    logger.debug('Approving multiple scripts', { count: names.length, endpoint });

    return withRetry(async () => {
      try {
        await this.axiosInstance.put(endpoint, names);
        logger.info('Approved scripts', { count: names.length, names });
      } catch (error) {
        this.handleApiError(error, `Failed to approve scripts`);
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Performs a health check on the ION API
   * @returns True if the API is accessible
   */
  public async healthCheck(): Promise<boolean> {
    try {
      await this.ensureValidToken();
      // Try to list a simple component type as health check
      await this.axiosInstance.get(COMPONENT_ENDPOINTS[ComponentType.CONNECTION_POINTS]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Makes a raw request to the ION API
   * Used for GitHub API proxy calls
   * @param method - HTTP method
   * @param path - API path
   * @param data - Request body (optional)
   */
  public async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: unknown
  ): Promise<T> {
    return withRetry(async () => {
      try {
        const response = await this.axiosInstance.request<T>({
          method,
          url: path,
          data,
        });
        return response.data;
      } catch (error) {
        this.handleApiError(error, `Request failed: ${method} ${path}`);
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Handles API errors and throws appropriate custom errors
   */
  private handleApiError(error: unknown, context: string): never {
    const axiosError = error as AxiosError;

    if (axiosError.response) {
      const statusCode = axiosError.response.status;
      const errorData = axiosError.response.data;

      logger.error(context, { statusCode, error: errorData });

      if (statusCode === 401) {
        // Token may have expired, clear it
        this.tokenInfo = null;
        throw new AuthenticationError('Authentication failed', errorData);
      }

      throw new IONApiError(`${context}: ${statusCode}`, statusCode, errorData);
    }

    if (axiosError.request) {
      logger.error(`${context}: No response received`, { error: axiosError.message });
      throw new IONApiError(`${context}: Network error`, undefined, axiosError.message);
    }

    logger.error(`${context}: Request error`, { error: axiosError.message });
    throw new IONApiError(context, undefined, axiosError.message);
  }
}
