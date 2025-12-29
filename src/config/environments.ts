/**
 * Environment Configuration
 * Handles loading and managing environment configurations
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { AppConfig, IONApiConfig, DEFAULT_SETTINGS, GlobalSettings } from '../types/config.js';
import { ConfigurationError, FileNotFoundError } from '../utils/errors.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('Config');

/**
 * Default configuration file name
 */
export const DEFAULT_CONFIG_FILE = 'ion-cicd.config.json';

/**
 * Loads an ION API configuration from a .ionapi file
 * @param path - Path to the .ionapi file
 * @returns Parsed ION API configuration
 */
export function loadIonApiConfig(path: string): IONApiConfig {
  const resolvedPath = resolve(path);

  if (!existsSync(resolvedPath)) {
    throw new FileNotFoundError(resolvedPath);
  }

  try {
    const content = readFileSync(resolvedPath, 'utf8');
    const config = JSON.parse(content) as IONApiConfig;

    // Validate required fields
    const requiredFields: (keyof IONApiConfig)[] = [
      'ti',
      'ci',
      'cs',
      'pu',
      'iu',
      'ot',
      'saak',
      'sask',
    ];
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
 * Loads the application configuration from a config file
 * @param configPath - Path to the config file (optional)
 * @returns Parsed application configuration
 */
export function loadAppConfig(configPath?: string): AppConfig {
  const path = configPath ?? DEFAULT_CONFIG_FILE;
  const resolvedPath = resolve(path);

  if (!existsSync(resolvedPath)) {
    logger.debug('Config file not found, using defaults', { path: resolvedPath });
    return createDefaultConfig();
  }

  try {
    const content = readFileSync(resolvedPath, 'utf8');
    const config = JSON.parse(content) as AppConfig;

    // Merge with defaults
    config.settings = { ...DEFAULT_SETTINGS, ...config.settings };

    logger.debug('Loaded app config', { path: resolvedPath });
    return config;
  } catch (error) {
    throw new ConfigurationError(`Failed to parse config file: ${(error as Error).message}`);
  }
}

/**
 * Creates a default configuration
 */
function createDefaultConfig(): AppConfig {
  return {
    version: '1.0',
    defaultEnvironment: 'tst',
    environments: {},
    settings: DEFAULT_SETTINGS,
  };
}

/**
 * Gets the ION API configuration for a specific environment
 * @param appConfig - The application configuration
 * @param envName - Environment name
 * @param basePath - Base path for resolving relative ionapi paths
 * @returns ION API configuration
 */
export function getEnvironmentConfig(
  appConfig: AppConfig,
  envName?: string,
  basePath?: string
): IONApiConfig {
  const env = envName ?? appConfig.defaultEnvironment;
  const envConfig = appConfig.environments[env];

  if (!envConfig) {
    throw new ConfigurationError(`Environment "${env}" not found in configuration`);
  }

  // Resolve ionapi path relative to config file or basePath
  const ionapiPath = basePath
    ? resolve(basePath, envConfig.ionapi)
    : resolve(dirname(envConfig.ionapi), envConfig.ionapi);

  return loadIonApiConfig(ionapiPath);
}

/**
 * Loads configuration from environment variables
 * Useful for CI/CD environments where config is injected
 * @returns ION API configuration or null if not set
 */
export function loadConfigFromEnv(): IONApiConfig | null {
  const encodedConfig = process.env.IONAPI_CONFIG;

  if (!encodedConfig) {
    return null;
  }

  try {
    const decoded = Buffer.from(encodedConfig, 'base64').toString('utf8');
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
 * Gets the log level from settings or environment
 */
export function getLogLevel(settings?: GlobalSettings): 'debug' | 'info' | 'warn' | 'error' {
  const envLevel = process.env.ION_CICD_LOG_LEVEL;
  if (envLevel && ['debug', 'info', 'warn', 'error'].includes(envLevel)) {
    return envLevel as 'debug' | 'info' | 'warn' | 'error';
  }
  return settings?.logLevel ?? 'info';
}
