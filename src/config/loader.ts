/**
 * Configuration Loader
 * Unified config loading with multi-environment support and CLI integration
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { AppConfig, IONApiConfig, EnvironmentConfig, GlobalSettings, DEFAULT_SETTINGS } from '../types/config.js';
import { ConfigurationError, FileNotFoundError } from '../utils/errors.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('ConfigLoader');

/**
 * Configuration file search paths (in order of precedence)
 */
const CONFIG_SEARCH_PATHS = [
  './ion-cicd.config.json',
  './.ion-cicd/config.json',
  './config/ion-cicd.json',
];

/**
 * Resolved configuration with all settings merged
 */
export interface ResolvedConfig {
  /** The loaded ION API config */
  ionApi: IONApiConfig;
  /** The environment config */
  environment: EnvironmentConfig;
  /** The environment name */
  environmentName: string;
  /** Global settings */
  settings: GlobalSettings;
  /** Path to the config file used */
  configPath: string;
  /** Resolved absolute path to ion-components folder */
  componentsPath: string;
}

/**
 * Options for loading configuration
 */
export interface LoadConfigOptions {
  /** Explicit path to config file */
  configPath?: string;
  /** Environment name to use */
  env?: string;
  /** Direct path to ionapi file (overrides config file) */
  ionapiPath?: string;
  /** Repository override */
  repo?: string;
  /** Branch override */
  branch?: string;
}

/**
 * Configuration Loader class
 * Provides a unified interface for loading ION CI/CD configuration
 */
export class ConfigLoader {
  private _cachedAppConfig: AppConfig | null = null;
  private configPath: string | null = null;

  /**
   * Gets the cached app config if available
   */
  public get cachedAppConfig(): AppConfig | null {
    return this._cachedAppConfig;
  }

  /**
   * Finds the configuration file in the search paths
   * @returns Path to the config file, or null if not found
   */
  public findConfigFile(): string | null {
    for (const searchPath of CONFIG_SEARCH_PATHS) {
      const resolvedPath = resolve(searchPath);
      if (existsSync(resolvedPath)) {
        logger.debug('Found config file', { path: resolvedPath });
        return resolvedPath;
      }
    }
    return null;
  }

  /**
   * Loads the application config file
   * @param configPath - Path to the config file
   * @returns The loaded AppConfig
   */
  public async loadAppConfig(configPath?: string): Promise<AppConfig> {
    const path = configPath ?? this.findConfigFile();

    if (!path) {
      logger.debug('No config file found, using defaults');
      return this.createDefaultAppConfig();
    }

    const resolvedPath = resolve(path);

    if (!existsSync(resolvedPath)) {
      throw new FileNotFoundError(resolvedPath);
    }

    try {
      const content = await readFile(resolvedPath, 'utf-8');
      const config = JSON.parse(content) as AppConfig;

      // Merge with defaults
      config.settings = { ...DEFAULT_SETTINGS, ...config.settings };

      this._cachedAppConfig = config;
      this.configPath = resolvedPath;

      logger.debug('Loaded app config', { path: resolvedPath });
      return config;
    } catch (error) {
      if (error instanceof FileNotFoundError) {
        throw error;
      }
      throw new ConfigurationError(`Failed to parse config file: ${(error as Error).message}`);
    }
  }

  /**
   * Loads an ION API config from a .ionapi file
   * @param path - Path to the .ionapi file
   * @returns The loaded IONApiConfig
   */
  public async loadIonApiConfig(path: string): Promise<IONApiConfig> {
    const resolvedPath = resolve(path);

    if (!existsSync(resolvedPath)) {
      throw new FileNotFoundError(resolvedPath);
    }

    try {
      const content = await readFile(resolvedPath, 'utf-8');
      const config = JSON.parse(content) as IONApiConfig;

      // Validate required fields
      const requiredFields: (keyof IONApiConfig)[] = ['ti', 'ci', 'cs', 'pu', 'iu', 'ot', 'saak', 'sask'];
      for (const field of requiredFields) {
        if (!config[field]) {
          throw new ConfigurationError(`Missing required field "${field}" in ION API config`);
        }
      }

      logger.debug('Loaded ION API config', { path: resolvedPath, tenant: config.ti });
      return config;
    } catch (error) {
      if (error instanceof ConfigurationError || error instanceof FileNotFoundError) {
        throw error;
      }
      throw new ConfigurationError(`Failed to parse ION API config: ${(error as Error).message}`);
    }
  }

  /**
   * Loads ION API config from the IONAPI_CONFIG environment variable
   * @returns The loaded config, or null if not set
   */
  public loadFromEnv(): IONApiConfig | null {
    const encodedConfig = process.env.IONAPI_CONFIG;

    if (!encodedConfig) {
      return null;
    }

    try {
      const decoded = Buffer.from(encodedConfig, 'base64').toString('utf-8');
      const config = JSON.parse(decoded) as IONApiConfig;

      logger.debug('Loaded config from IONAPI_CONFIG environment variable');
      return config;
    } catch (error) {
      throw new ConfigurationError(
        `Failed to parse IONAPI_CONFIG environment variable: ${(error as Error).message}`
      );
    }
  }

  /**
   * Gets the environment name from options or environment variable
   * @param options - Load options
   * @returns Environment name
   */
  private getEnvironmentName(options: LoadConfigOptions, appConfig: AppConfig): string {
    // Priority: CLI option > env var > default from config
    if (options.env) {
      return options.env;
    }

    const envVar = process.env.ION_CICD_ENV;
    if (envVar) {
      return envVar;
    }

    return appConfig.defaultEnvironment;
  }

  /**
   * Resolves the complete configuration from all sources
   * @param options - Load options
   * @returns Resolved configuration
   */
  public async resolve(options: LoadConfigOptions = {}): Promise<ResolvedConfig> {
    // Check for IONAPI_CONFIG env var first
    const envConfig = this.loadFromEnv();
    if (envConfig && !options.ionapiPath && !options.configPath) {
      logger.info('Using ION API config from environment variable');
      return {
        ionApi: envConfig,
        environment: {
          ionapi: 'IONAPI_CONFIG env var',
          repository: options.repo ?? 'PedalGroup/Infor',
          branch: options.branch ?? 'main',
        },
        environmentName: 'env',
        settings: DEFAULT_SETTINGS,
        configPath: 'IONAPI_CONFIG',
        componentsPath: resolve(process.cwd(), DEFAULT_SETTINGS.componentsPath),
      };
    }

    // If direct ionapi path provided, use it
    if (options.ionapiPath) {
      const ionApi = await this.loadIonApiConfig(options.ionapiPath);
      return {
        ionApi,
        environment: {
          ionapi: options.ionapiPath,
          repository: options.repo ?? 'PedalGroup/Infor',
          branch: options.branch ?? 'main',
        },
        environmentName: 'direct',
        settings: DEFAULT_SETTINGS,
        configPath: options.ionapiPath,
        componentsPath: resolve(process.cwd(), DEFAULT_SETTINGS.componentsPath),
      };
    }

    // Load app config
    const appConfig = await this.loadAppConfig(options.configPath);
    const envName = this.getEnvironmentName(options, appConfig);

    // Get environment config
    const envConfig2 = appConfig.environments[envName];
    if (!envConfig2) {
      // If no environments defined and no config file, create a default
      if (Object.keys(appConfig.environments).length === 0) {
        throw new ConfigurationError(
          `No environments configured. Use --config to specify an .ionapi file directly.`
        );
      }
      throw new ConfigurationError(
        `Environment "${envName}" not found. Available: ${Object.keys(appConfig.environments).join(', ')}`
      );
    }

    // Resolve ionapi path relative to config file location
    const configDir = this.configPath ? dirname(this.configPath) : process.cwd();
    const ionapiPath = resolve(configDir, envConfig2.ionapi);
    const ionApi = await this.loadIonApiConfig(ionapiPath);

    // Apply overrides
    const environment: EnvironmentConfig = {
      ...envConfig2,
      repository: options.repo ?? envConfig2.repository,
      branch: options.branch ?? envConfig2.branch,
    };

    // Resolve components path relative to config file location
    const componentsPath = resolve(configDir, appConfig.settings.componentsPath);

    return {
      ionApi,
      environment,
      environmentName: envName,
      settings: appConfig.settings,
      configPath: this.configPath ?? ionapiPath,
      componentsPath,
    };
  }

  /**
   * Lists available environments from the config
   * @param configPath - Optional config file path
   * @returns Array of environment names
   */
  public async listEnvironments(configPath?: string): Promise<string[]> {
    const appConfig = await this.loadAppConfig(configPath);
    return Object.keys(appConfig.environments);
  }

  /**
   * Gets environment details
   * @param envName - Environment name
   * @param configPath - Optional config file path
   * @returns Environment config, or null if not found
   */
  public async getEnvironment(
    envName: string,
    configPath?: string
  ): Promise<EnvironmentConfig | null> {
    const appConfig = await this.loadAppConfig(configPath);
    return appConfig.environments[envName] ?? null;
  }

  /**
   * Creates a default app config (used when no config file exists)
   */
  private createDefaultAppConfig(): AppConfig {
    return {
      version: '1.0',
      defaultEnvironment: 'tst',
      environments: {},
      settings: DEFAULT_SETTINGS,
    };
  }
}

/**
 * Convenience function to quickly resolve configuration
 * @param options - Load options
 * @returns Resolved configuration
 */
export async function resolveConfig(options: LoadConfigOptions = {}): Promise<ResolvedConfig> {
  const loader = new ConfigLoader();
  return loader.resolve(options);
}
