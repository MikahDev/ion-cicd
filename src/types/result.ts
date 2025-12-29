/**
 * Operation Result Type Definitions
 * Defines result structures for operations and error handling
 */

/**
 * Error codes for classification
 */
export enum ErrorCode {
  // Authentication errors (1xx)
  AUTH_FAILED = 100,
  TOKEN_EXPIRED = 101,
  TOKEN_REFRESH_FAILED = 102,

  // API errors (2xx)
  ION_API_ERROR = 200,
  GITHUB_API_ERROR = 201,
  RATE_LIMITED = 202,

  // Validation errors (3xx)
  INVALID_CONFIG = 300,
  INVALID_COMPONENT = 301,
  MISSING_DEPENDENCY = 302,

  // Operation errors (4xx)
  EXPORT_FAILED = 400,
  IMPORT_FAILED = 401,
  DUPLICATE_NAME = 402,

  // System errors (5xx)
  FILE_NOT_FOUND = 500,
  NETWORK_ERROR = 501,
  UNEXPECTED_ERROR = 599,
}

/**
 * Operation error structure
 */
export interface OperationError {
  /** Error code for classification */
  code: ErrorCode;
  /** Human-readable error message */
  message: string;
  /** Additional error details */
  details?: unknown;
  /** Whether the operation can be retried */
  retryable: boolean;
}

/**
 * Generic operation result
 */
export interface OperationResult<T = void> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Result data (if successful) */
  data?: T;
  /** Error information (if failed) */
  error?: OperationError;
}

/**
 * Individual item result in a batch operation
 */
export interface BatchItemResult<T = void> {
  /** Item identifier (e.g., component name) */
  item: string;
  /** Operation result for this item */
  result: OperationResult<T>;
}

/**
 * Batch operation result (for operations on multiple items)
 */
export interface BatchResult<T = void> {
  /** Total number of items processed */
  total: number;
  /** Number of successful operations */
  succeeded: number;
  /** Number of failed operations */
  failed: number;
  /** Number of skipped operations */
  skipped: number;
  /** Individual results for each item */
  results: BatchItemResult<T>[];
}

/**
 * Export operation result
 */
export interface ExportResult {
  /** Component name */
  name: string;
  /** Component type */
  type: string;
  /** Export status */
  status: 'exported' | 'skipped' | 'failed';
  /** GitHub file SHA (if exported) */
  sha?: string;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Import operation result
 */
export interface ImportResult {
  /** Original component name */
  originalName: string;
  /** Final component name (may differ if renamed) */
  finalName: string;
  /** Component type */
  type: string;
  /** Import status */
  status: 'created' | 'updated' | 'skipped' | 'failed';
  /** Error message (if failed) */
  error?: string;
}

/**
 * JSON output format for CLI
 */
export interface CLIOutput {
  /** Whether the overall operation succeeded */
  success: boolean;
  /** Operation type */
  operation: 'export' | 'import' | 'sync' | 'rollback' | 'deploy';
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Operation summary */
  summary: {
    exported?: number;
    imported?: number;
    deployed?: number;
    skipped?: number;
    failed?: number;
    pruned?: number;
  };
  /** Component details */
  components: (ExportResult | ImportResult)[];
  /** Error messages */
  errors: string[];
  /** Pruned file paths (for export --prune) */
  pruned?: string[];
}
