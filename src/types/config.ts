/**
 * Configuration Type Definitions
 * Defines configuration structures for ION API and environments
 */

/**
 * ION API configuration from .ionapi file
 */
export interface IONApiConfig {
  /** Tenant ID */
  ti: string;
  /** Client ID */
  ci: string;
  /** Client Secret */
  cs: string;
  /** Token endpoint base URL */
  pu: string;
  /** ION API base URL */
  iu: string;
  /** OAuth token path */
  ot: string;
  /** Service Account Access Key */
  saak: string;
  /** Service Account Secret Key */
  sask: string;
  /** Connection name (optional) */
  cn?: string;
  /** Data type (optional) */
  dt?: string;
  /** OAuth authorisation path (optional) */
  oa?: string;
  /** OAuth revoke path (optional) */
  or?: string;
  /** Environment version (optional) */
  ev?: string;
  /** API version */
  v?: string;
}

/**
 * Environment-specific configuration
 */
export interface EnvironmentConfig {
  /** Path to ionapi file (relative or absolute) */
  ionapi: string;
  /** GitHub repository (owner/repo format) */
  repository: string;
  /** Default branch for this environment */
  branch: string;
  /** Optional display name */
  displayName?: string;
  /** If true, direct deploys are blocked - must deploy via CI/CD pipeline */
  protected?: boolean;
}

/**
 * Global settings for the toolkit
 */
export interface GlobalSettings {
  /** Number of retry attempts for failed requests */
  retryAttempts: number;
  /** Base delay between retries in milliseconds */
  retryDelayMs: number;
  /** Seconds before token expiry to trigger refresh */
  tokenRefreshBufferSeconds: number;
  /** Directory for state files (checksums, etc.) */
  stateDirectory: string;
  /** Log level: debug, info, warn, error */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Path to ion-components folder (relative to config file) */
  componentsPath: string;
}

/**
 * Main application configuration file structure
 */
export interface AppConfig {
  /** Schema version */
  version: '1.0';
  /** Default environment to use when --env not specified */
  defaultEnvironment: string;
  /** Environment configurations */
  environments: Record<string, EnvironmentConfig>;
  /** Global settings */
  settings: GlobalSettings;
}

/**
 * Default global settings
 */
export const DEFAULT_SETTINGS: GlobalSettings = {
  retryAttempts: 3,
  retryDelayMs: 1000,
  tokenRefreshBufferSeconds: 300,
  stateDirectory: '.infor-cicd',
  logLevel: 'info',
  componentsPath: './ion-components',
};
