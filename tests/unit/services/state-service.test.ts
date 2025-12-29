/**
 * StateService Unit Tests
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { StateService, ComponentState, StateFile } from '../../../src/services/state-service.js';
import { ComponentType } from '../../../src/types/ion.js';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

describe('StateService', () => {
  const testDir = './test-state-dir';
  const testStatePath = join(testDir, 'state.json');
  let service: StateService;

  beforeEach(async () => {
    // Clean up any existing test directory
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true });
    }

    service = new StateService({
      stateDir: testDir,
      fileName: 'state.json',
    });
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true });
    }
  });

  describe('exists', () => {
    it('should return false when state file does not exist', async () => {
      const result = await service.exists();
      expect(result).toBe(false);
    });

    it('should return true when state file exists', async () => {
      await mkdir(testDir, { recursive: true });
      await writeFile(testStatePath, JSON.stringify({ version: '1.0' }));

      const result = await service.exists();
      expect(result).toBe(true);
    });
  });

  describe('load', () => {
    it('should return empty state when file does not exist', async () => {
      const state = await service.load();

      expect(state.version).toBe('1.0');
      expect(state.components).toEqual({});
    });

    it('should load existing state file', async () => {
      const existingState: StateFile = {
        version: '1.0',
        lastSync: '2024-12-01T00:00:00Z',
        components: {
          [ComponentType.DATAFLOWS]: {
            'TestFlow': {
              ionHash: 'abc123',
              gitSha: 'def456',
              lastSynced: '2024-12-01T00:00:00Z',
            },
          },
        },
      };

      await mkdir(testDir, { recursive: true });
      await writeFile(testStatePath, JSON.stringify(existingState));

      const state = await service.load();

      expect(state.version).toBe('1.0');
      expect(state.components[ComponentType.DATAFLOWS]).toBeDefined();
      expect(state.components[ComponentType.DATAFLOWS]['TestFlow'].ionHash).toBe('abc123');
    });

    it('should cache loaded state', async () => {
      const state1 = await service.load();
      const state2 = await service.load();

      expect(state1).toBe(state2);
    });
  });

  describe('save', () => {
    it('should create state directory if it does not exist', async () => {
      await service.load();
      await service.save();

      expect(existsSync(testDir)).toBe(true);
      expect(existsSync(testStatePath)).toBe(true);
    });

    it('should save state to file', async () => {
      const state = await service.load();
      state.components[ComponentType.DATAFLOWS] = {
        'TestFlow': {
          ionHash: 'abc123',
          gitSha: 'def456',
          lastSynced: '2024-12-01T00:00:00Z',
        },
      };

      await service.save();

      const content = await readFile(testStatePath, 'utf-8');
      const savedState = JSON.parse(content) as StateFile;

      expect(savedState.components[ComponentType.DATAFLOWS]).toBeDefined();
      expect(savedState.components[ComponentType.DATAFLOWS]['TestFlow'].ionHash).toBe('abc123');
    });

    it('should update lastSync timestamp', async () => {
      await service.load();
      await service.save();

      const content = await readFile(testStatePath, 'utf-8');
      const savedState = JSON.parse(content) as StateFile;

      expect(savedState.lastSync).toBeDefined();
      const syncDate = new Date(savedState.lastSync);
      expect(syncDate.getTime()).toBeGreaterThan(Date.now() - 5000);
    });
  });

  describe('getComponentState', () => {
    it('should return undefined for non-existent component', async () => {
      const result = await service.getComponentState(ComponentType.DATAFLOWS, 'NonExistent');
      expect(result).toBeUndefined();
    });

    it('should return component state when it exists', async () => {
      const existingState: StateFile = {
        version: '1.0',
        lastSync: '2024-12-01T00:00:00Z',
        components: {
          [ComponentType.DATAFLOWS]: {
            'TestFlow': {
              ionHash: 'abc123',
              gitSha: 'def456',
              lastSynced: '2024-12-01T00:00:00Z',
            },
          },
        },
      };

      await mkdir(testDir, { recursive: true });
      await writeFile(testStatePath, JSON.stringify(existingState));

      const result = await service.getComponentState(ComponentType.DATAFLOWS, 'TestFlow');

      expect(result).toBeDefined();
      expect(result?.ionHash).toBe('abc123');
      expect(result?.gitSha).toBe('def456');
    });
  });

  describe('setComponentState', () => {
    it('should set component state', async () => {
      const componentState: ComponentState = {
        ionHash: 'abc123',
        gitSha: 'def456',
        lastSynced: '2024-12-01T00:00:00Z',
      };

      await service.setComponentState(ComponentType.DATAFLOWS, 'TestFlow', componentState);

      const result = await service.getComponentState(ComponentType.DATAFLOWS, 'TestFlow');

      expect(result).toEqual(componentState);
    });

    it('should create type entry if it does not exist', async () => {
      await service.setComponentState(ComponentType.MAPPINGS, 'TestMapping', {
        ionHash: 'abc123',
        gitSha: 'def456',
        lastSynced: '2024-12-01T00:00:00Z',
      });

      const state = await service.load();
      expect(state.components[ComponentType.MAPPINGS]).toBeDefined();
    });
  });

  describe('recordExport', () => {
    it('should record export with computed hash', async () => {
      const content = JSON.stringify({ name: 'TestFlow', description: 'Test' });

      await service.recordExport(ComponentType.DATAFLOWS, 'TestFlow', content, 'git-sha-123');
      await service.save();

      const result = await service.getComponentState(ComponentType.DATAFLOWS, 'TestFlow');

      expect(result).toBeDefined();
      expect(result?.ionHash).toBeDefined();
      expect(result?.ionHash.length).toBe(64); // SHA256 hex length
      expect(result?.gitSha).toBe('git-sha-123');
    });
  });

  describe('recordImport', () => {
    it('should record import with computed hash', async () => {
      const content = JSON.stringify({ name: 'TestFlow', description: 'Test' });

      await service.recordImport(ComponentType.DATAFLOWS, 'TestFlow', content, 'git-sha-123');

      const result = await service.getComponentState(ComponentType.DATAFLOWS, 'TestFlow');

      expect(result).toBeDefined();
      expect(result?.ionHash.length).toBe(64);
      expect(result?.gitSha).toBe('git-sha-123');
    });

    it('should handle missing git SHA', async () => {
      const content = JSON.stringify({ name: 'TestFlow' });

      await service.recordImport(ComponentType.DATAFLOWS, 'TestFlow', content);

      const result = await service.getComponentState(ComponentType.DATAFLOWS, 'TestFlow');

      expect(result?.gitSha).toBe('');
    });
  });

  describe('removeComponent', () => {
    it('should remove component from state', async () => {
      await service.setComponentState(ComponentType.DATAFLOWS, 'TestFlow', {
        ionHash: 'abc123',
        gitSha: 'def456',
        lastSynced: '2024-12-01T00:00:00Z',
      });

      await service.removeComponent(ComponentType.DATAFLOWS, 'TestFlow');

      const result = await service.getComponentState(ComponentType.DATAFLOWS, 'TestFlow');
      expect(result).toBeUndefined();
    });

    it('should clean up empty type objects', async () => {
      await service.setComponentState(ComponentType.DATAFLOWS, 'TestFlow', {
        ionHash: 'abc123',
        gitSha: 'def456',
        lastSynced: '2024-12-01T00:00:00Z',
      });

      await service.removeComponent(ComponentType.DATAFLOWS, 'TestFlow');

      const state = await service.load();
      expect(state.components[ComponentType.DATAFLOWS]).toBeUndefined();
    });
  });

  describe('hasChanged', () => {
    it('should return true when no previous state exists', async () => {
      const result = await service.hasChanged(
        ComponentType.DATAFLOWS,
        'NewFlow',
        JSON.stringify({ name: 'NewFlow' })
      );

      expect(result).toBe(true);
    });

    it('should return false when content matches', async () => {
      const content = JSON.stringify({ name: 'TestFlow', description: 'Test' });

      await service.recordExport(ComponentType.DATAFLOWS, 'TestFlow', content, 'sha');

      const result = await service.hasChanged(ComponentType.DATAFLOWS, 'TestFlow', content);

      expect(result).toBe(false);
    });

    it('should return true when content differs', async () => {
      const originalContent = JSON.stringify({ name: 'TestFlow', description: 'Original' });
      const newContent = JSON.stringify({ name: 'TestFlow', description: 'Updated' });

      await service.recordExport(ComponentType.DATAFLOWS, 'TestFlow', originalContent, 'sha');

      const result = await service.hasChanged(ComponentType.DATAFLOWS, 'TestFlow', newContent);

      expect(result).toBe(true);
    });
  });

  describe('getTypeStates', () => {
    it('should return empty map for non-existent type', async () => {
      const result = await service.getTypeStates(ComponentType.DATAFLOWS);
      expect(result.size).toBe(0);
    });

    it('should return all states for a type', async () => {
      await service.setComponentState(ComponentType.DATAFLOWS, 'Flow1', {
        ionHash: 'hash1',
        gitSha: 'sha1',
        lastSynced: '2024-12-01T00:00:00Z',
      });
      await service.setComponentState(ComponentType.DATAFLOWS, 'Flow2', {
        ionHash: 'hash2',
        gitSha: 'sha2',
        lastSynced: '2024-12-01T00:00:00Z',
      });

      const result = await service.getTypeStates(ComponentType.DATAFLOWS);

      expect(result.size).toBe(2);
      expect(result.get('Flow1')?.ionHash).toBe('hash1');
      expect(result.get('Flow2')?.ionHash).toBe('hash2');
    });
  });

  describe('getStats', () => {
    it('should return zero stats when no state exists', async () => {
      const stats = await service.getStats();

      expect(stats.totalComponents).toBe(0);
      expect(stats.byType).toEqual({});
      expect(stats.lastSync).toBeUndefined();
    });

    it('should return correct stats', async () => {
      await service.setComponentState(ComponentType.DATAFLOWS, 'Flow1', {
        ionHash: 'hash1',
        gitSha: 'sha1',
        lastSynced: '2024-12-01T00:00:00Z',
      });
      await service.setComponentState(ComponentType.DATAFLOWS, 'Flow2', {
        ionHash: 'hash2',
        gitSha: 'sha2',
        lastSynced: '2024-12-01T00:00:00Z',
      });
      await service.setComponentState(ComponentType.MAPPINGS, 'Map1', {
        ionHash: 'hash3',
        gitSha: 'sha3',
        lastSynced: '2024-12-01T00:00:00Z',
      });
      await service.save();

      const stats = await service.getStats();

      expect(stats.totalComponents).toBe(3);
      expect(stats.byType[ComponentType.DATAFLOWS]).toBe(2);
      expect(stats.byType[ComponentType.MAPPINGS]).toBe(1);
      expect(stats.lastSync).toBeDefined();
    });
  });

  describe('clear', () => {
    it('should clear all state', async () => {
      await service.setComponentState(ComponentType.DATAFLOWS, 'Flow1', {
        ionHash: 'hash1',
        gitSha: 'sha1',
        lastSynced: '2024-12-01T00:00:00Z',
      });
      await service.save();

      await service.clear();

      const stats = await service.getStats();
      expect(stats.totalComponents).toBe(0);
    });
  });

  describe('getStatePath', () => {
    it('should return the state file path', () => {
      const path = service.getStatePath();
      expect(path).toBe(testStatePath);
    });
  });
});
