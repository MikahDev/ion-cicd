/**
 * Crypto Utility
 * Provides hashing and crypto utilities for change detection
 */

import { createHash } from 'crypto';

/**
 * Generates a SHA256 hash of the given content
 * @param content - The content to hash
 * @returns The hex-encoded SHA256 hash
 */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Normalises a JSON object for consistent hashing
 * Sorts keys alphabetically and removes whitespace
 * @param obj - The object to normalise
 * @returns A normalised JSON string
 */
export function normaliseJson(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

/**
 * Generates a consistent hash for an object
 * Normalises the JSON before hashing to ensure consistent results
 * @param obj - The object to hash
 * @returns The hex-encoded SHA256 hash
 */
export function hashObject(obj: unknown): string {
  const normalised = normaliseJson(obj);
  return sha256(normalised);
}

/**
 * Compares two objects by their hash
 * @param obj1 - First object
 * @param obj2 - Second object
 * @returns True if the objects have the same hash
 */
export function objectsEqual(obj1: unknown, obj2: unknown): boolean {
  return hashObject(obj1) === hashObject(obj2);
}

/**
 * Computes a hash of string content
 * Alias for sha256 for clearer semantic usage
 * @param content - The content to hash
 * @returns The hex-encoded SHA256 hash
 */
export function computeHash(content: string): string {
  return sha256(content);
}
