/**
 * Error Classes
 * Custom error types for the ION CI/CD toolkit
 */

import { ErrorCode } from '../types/result.js';

/**
 * Base error class for ION CI/CD toolkit
 */
export class IONCICDError extends Error {
  public readonly code: ErrorCode;
  public readonly retryable: boolean;
  public readonly details?: unknown;

  constructor(message: string, code: ErrorCode, retryable = false, details?: unknown) {
    super(message);
    this.name = 'IONCICDError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;

    // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends IONCICDError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.AUTH_FAILED, false, details);
    this.name = 'AuthenticationError';
  }
}

/**
 * Token expired error
 */
export class TokenExpiredError extends IONCICDError {
  constructor(message = 'Authentication token has expired', details?: unknown) {
    super(message, ErrorCode.TOKEN_EXPIRED, true, details);
    this.name = 'TokenExpiredError';
  }
}

/**
 * Token refresh failed error
 */
export class TokenRefreshError extends IONCICDError {
  constructor(message = 'Failed to refresh authentication token', details?: unknown) {
    super(message, ErrorCode.TOKEN_REFRESH_FAILED, false, details);
    this.name = 'TokenRefreshError';
  }
}

/**
 * ION API error
 */
export class IONApiError extends IONCICDError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number, details?: unknown) {
    const retryable = statusCode ? statusCode >= 500 : false;
    super(message, ErrorCode.ION_API_ERROR, retryable, details);
    this.name = 'IONApiError';
    this.statusCode = statusCode;
  }
}

/**
 * GitHub API error
 */
export class GitHubApiError extends IONCICDError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number, details?: unknown) {
    const retryable = statusCode ? statusCode >= 500 || statusCode === 429 : false;
    super(message, ErrorCode.GITHUB_API_ERROR, retryable, details);
    this.name = 'GitHubApiError';
    this.statusCode = statusCode;
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends IONCICDError {
  public readonly retryAfter?: number;

  constructor(retryAfter?: number) {
    const message = retryAfter
      ? `Rate limited. Retry after ${retryAfter} seconds`
      : 'Rate limited. Please try again later';
    super(message, ErrorCode.RATE_LIMITED, true);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Invalid configuration error
 */
export class ConfigurationError extends IONCICDError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.INVALID_CONFIG, false, details);
    this.name = 'ConfigurationError';
  }
}

/**
 * Invalid component error
 */
export class InvalidComponentError extends IONCICDError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.INVALID_COMPONENT, false, details);
    this.name = 'InvalidComponentError';
  }
}

/**
 * Missing dependency error
 */
export class MissingDependencyError extends IONCICDError {
  constructor(component: string, dependency: string) {
    super(
      `Component "${component}" requires "${dependency}" which was not found`,
      ErrorCode.MISSING_DEPENDENCY,
      false,
      { component, dependency }
    );
    this.name = 'MissingDependencyError';
  }
}

/**
 * Export failed error
 */
export class ExportError extends IONCICDError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.EXPORT_FAILED, false, details);
    this.name = 'ExportError';
  }
}

/**
 * Import failed error
 */
export class ImportError extends IONCICDError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.IMPORT_FAILED, false, details);
    this.name = 'ImportError';
  }
}

/**
 * Duplicate name error
 */
export class DuplicateNameError extends IONCICDError {
  constructor(name: string, componentType: string) {
    super(
      `Component "${name}" of type "${componentType}" already exists`,
      ErrorCode.DUPLICATE_NAME,
      false,
      { name, componentType }
    );
    this.name = 'DuplicateNameError';
  }
}

/**
 * File not found error
 */
export class FileNotFoundError extends IONCICDError {
  constructor(path: string) {
    super(`File not found: ${path}`, ErrorCode.FILE_NOT_FOUND, false, { path });
    this.name = 'FileNotFoundError';
  }
}

/**
 * Network error
 */
export class NetworkError extends IONCICDError {
  constructor(message = 'Network error occurred', details?: unknown) {
    super(message, ErrorCode.NETWORK_ERROR, true, details);
    this.name = 'NetworkError';
  }
}
