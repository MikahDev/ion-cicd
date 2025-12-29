/**
 * Retry Utility
 * Provides retry logic with exponential backoff
 */

import { AxiosError } from 'axios';
import { Logger } from './logger.js';

const logger = new Logger('Retry');

/**
 * Configuration for retry behaviour
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds */
  baseDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay?: number;
  /** Whether to use exponential backoff */
  exponential?: boolean;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  exponential: true,
};

/**
 * Delays execution for a specified time
 * @param ms - Milliseconds to delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculates delay for a given attempt number
 * @param attempt - Current attempt number (1-based)
 * @param config - Retry configuration
 */
export function calculateDelay(attempt: number, config: RetryConfig): number {
  const { baseDelay, maxDelay = 30000, exponential = true } = config;

  if (exponential) {
    // Exponential backoff: baseDelay * 2^(attempt-1)
    const calculatedDelay = baseDelay * Math.pow(2, attempt - 1);
    return Math.min(calculatedDelay, maxDelay);
  }

  return baseDelay;
}

/**
 * Checks if an error is retryable
 * @param error - The error to check
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AxiosError) {
    // Retry on network errors
    if (!error.response) {
      return true;
    }

    // Retry on 5xx server errors
    if (error.response.status >= 500) {
      return true;
    }

    // Retry on 429 (rate limited)
    if (error.response.status === 429) {
      return true;
    }

    // Retry on 408 (request timeout)
    if (error.response.status === 408) {
      return true;
    }
  }

  return false;
}

/**
 * Executes a function with retry logic
 * @param fn - The async function to execute
 * @param config - Retry configuration
 * @returns The result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // If this was the last attempt or the error isn't retryable, throw
      if (attempt > config.maxRetries || !isRetryableError(error)) {
        throw error;
      }

      const delayMs = calculateDelay(attempt, config);
      logger.warn(`Attempt ${attempt} failed, retrying in ${delayMs}ms`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        attempt,
        maxRetries: config.maxRetries,
      });

      await delay(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Creates a retry wrapper for a function
 * @param fn - The async function to wrap
 * @param config - Retry configuration
 * @returns A wrapped function with retry logic
 */
export function createRetryWrapper<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), config);
}
