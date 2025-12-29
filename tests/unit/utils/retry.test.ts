/**
 * Retry Utility Unit Tests
 */

import { jest, describe, it, expect } from '@jest/globals';
import { AxiosError } from 'axios';
import {
  delay,
  calculateDelay,
  isRetryableError,
  withRetry,
  createRetryWrapper,
  RetryConfig,
} from '../../../src/utils/retry.js';

describe('Retry Utilities', () => {
  describe('delay', () => {
    it('should delay for specified milliseconds', async () => {
      const start = Date.now();
      await delay(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some tolerance
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('calculateDelay', () => {
    it('should calculate exponential delay', () => {
      const config: RetryConfig = {
        maxRetries: 3,
        baseDelay: 1000,
        exponential: true,
      };

      expect(calculateDelay(1, config)).toBe(1000); // 1000 * 2^0
      expect(calculateDelay(2, config)).toBe(2000); // 1000 * 2^1
      expect(calculateDelay(3, config)).toBe(4000); // 1000 * 2^2
    });

    it('should cap delay at maxDelay', () => {
      const config: RetryConfig = {
        maxRetries: 5,
        baseDelay: 1000,
        maxDelay: 5000,
        exponential: true,
      };

      expect(calculateDelay(1, config)).toBe(1000);
      expect(calculateDelay(5, config)).toBe(5000); // Capped at maxDelay
    });

    it('should return constant delay when not exponential', () => {
      const config: RetryConfig = {
        maxRetries: 3,
        baseDelay: 1000,
        exponential: false,
      };

      expect(calculateDelay(1, config)).toBe(1000);
      expect(calculateDelay(2, config)).toBe(1000);
      expect(calculateDelay(3, config)).toBe(1000);
    });
  });

  describe('isRetryableError', () => {
    it('should return true for network errors (no response)', () => {
      const error = new AxiosError('Network Error');
      error.response = undefined;

      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for 5xx errors', () => {
      const error = new AxiosError('Internal Server Error');
      error.response = { status: 500 } as never;

      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for 429 rate limit errors', () => {
      const error = new AxiosError('Too Many Requests');
      error.response = { status: 429 } as never;

      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for 408 timeout errors', () => {
      const error = new AxiosError('Request Timeout');
      error.response = { status: 408 } as never;

      expect(isRetryableError(error)).toBe(true);
    });

    it('should return false for 4xx client errors', () => {
      const error = new AxiosError('Not Found');
      error.response = { status: 404 } as never;

      expect(isRetryableError(error)).toBe(false);
    });

    it('should return false for 401 authentication errors', () => {
      const error = new AxiosError('Unauthorized');
      error.response = { status: 401 } as never;

      expect(isRetryableError(error)).toBe(false);
    });

    it('should return false for non-Axios errors', () => {
      const error = new Error('Generic error');

      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('withRetry', () => {
    it('should succeed on first try', async () => {
      const fn = jest.fn<() => Promise<string>>().mockResolvedValue('success');

      const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error and eventually succeed', async () => {
      const networkError = new AxiosError('Network Error');
      networkError.response = undefined;

      const fn = jest.fn<() => Promise<string>>()
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValue('success');

      const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries exceeded', async () => {
      const serverError = new AxiosError('Server Error');
      serverError.response = { status: 500 } as never;

      const fn = jest.fn<() => Promise<string>>().mockRejectedValue(serverError);

      await expect(withRetry(fn, { maxRetries: 2, baseDelay: 10 })).rejects.toThrow('Server Error');

      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should not retry non-retryable errors', async () => {
      const clientError = new AxiosError('Not Found');
      clientError.response = { status: 404 } as never;

      const fn = jest.fn<() => Promise<string>>().mockRejectedValue(clientError);

      await expect(withRetry(fn, { maxRetries: 3, baseDelay: 10 })).rejects.toThrow('Not Found');

      expect(fn).toHaveBeenCalledTimes(1); // No retries
    });
  });

  describe('createRetryWrapper', () => {
    it('should create a function that retries', async () => {
      const networkError = new AxiosError('Network Error');
      networkError.response = undefined;

      const fn = jest.fn<(a: string, b: string) => Promise<string>>()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValue('success');

      const wrappedFn = createRetryWrapper(fn, { maxRetries: 2, baseDelay: 10 });

      const result = await wrappedFn('arg1', 'arg2');

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });
});
