/**
 * ComponentService Unit Tests
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ComponentService, ConflictResolution } from '../../../src/services/component-service.js';
import { IONClient } from '../../../src/clients/ion-client.js';
import { GitHubClient } from '../../../src/clients/github-client.js';
import {
  ComponentType,
  COMPONENT_DISPLAY_NAMES,
  IONComponent,
  IONComponentDetail,
  MappingComponent,
} from '../../../src/types/ion.js';

describe('ComponentService', () => {
  let service: ComponentService;
  let mockIONClient: jest.Mocked<IONClient>;
  let mockGitHubClient: jest.Mocked<GitHubClient>;

  beforeEach(() => {
    mockIONClient = {
      listComponents: jest.fn(),
      getComponent: jest.fn(),
      createComponent: jest.fn(),
      updateComponent: jest.fn(),
      deleteComponent: jest.fn(),
    } as unknown as jest.Mocked<IONClient>;

    mockGitHubClient = {
      getTree: jest.fn(),
      getFileContent: jest.fn(),
      createOrUpdateFile: jest.fn(),
      getFileSha: jest.fn(),
    } as unknown as jest.Mocked<GitHubClient>;

    service = new ComponentService(mockIONClient, mockGitHubClient);
  });

  describe('getDisplayName', () => {
    it('should return correct display name for dataflows', () => {
      expect(service.getDisplayName(ComponentType.DATAFLOWS)).toBe('Document flow');
    });

    it('should return correct display name for connection points', () => {
      expect(service.getDisplayName(ComponentType.CONNECTION_POINTS)).toBe('Connection point');
    });

    it('should return correct display name for mappings', () => {
      expect(service.getDisplayName(ComponentType.MAPPINGS)).toBe('Mapping');
    });
  });

  describe('getTypeFromDisplayName', () => {
    it('should return correct type for Document flow', () => {
      expect(service.getTypeFromDisplayName('Document flow')).toBe(ComponentType.DATAFLOWS);
    });

    it('should return correct type for Connection point', () => {
      expect(service.getTypeFromDisplayName('Connection point')).toBe(
        ComponentType.CONNECTION_POINTS
      );
    });

    it('should return undefined for invalid display name', () => {
      expect(service.getTypeFromDisplayName('Invalid Type')).toBeUndefined();
    });
  });

  describe('getComponentPath', () => {
    it('should return correct path for dataflow', () => {
      expect(service.getComponentPath(ComponentType.DATAFLOWS, 'MyFlow')).toBe(
        'Document flow/MyFlow.json'
      );
    });

    it('should return correct path for mapping', () => {
      expect(service.getComponentPath(ComponentType.MAPPINGS, 'MyMapping')).toBe(
        'Mapping/MyMapping.json'
      );
    });
  });

  describe('listComponents', () => {
    it('should delegate to ION client', async () => {
      const mockComponents: IONComponent[] = [
        { name: 'Flow1', description: 'First flow' },
        { name: 'Flow2', description: 'Second flow' },
      ];

      mockIONClient.listComponents.mockResolvedValue(mockComponents);

      const result = await service.listComponents(ComponentType.DATAFLOWS);

      expect(result).toEqual(mockComponents);
      expect(mockIONClient.listComponents).toHaveBeenCalledWith(ComponentType.DATAFLOWS);
    });
  });

  describe('prepareForImport', () => {
    it('should update mapperName in mapping components', () => {
      const mapping: MappingComponent = {
        name: 'OldMapping',
        description: 'Test mapping',
        mappingModels: [
          { mapperName: 'OldMapping', field: 'test' },
          { mapperName: 'OldMapping', otherField: 'value' },
        ],
      };

      const result = service.prepareForImport(
        ComponentType.MAPPINGS,
        mapping,
        'NewMapping'
      ) as MappingComponent;

      expect(result.name).toBe('NewMapping');
      expect(result.mappingModels?.[0].mapperName).toBe('NewMapping');
      expect(result.mappingModels?.[1].mapperName).toBe('NewMapping');
    });

    it('should only keep name and description for enterprise connectors', () => {
      const connector: IONComponentDetail = {
        name: 'MyConnector',
        description: 'Test connector',
        otherField: 'should be removed',
        complexData: { nested: 'data' },
      };

      const result = service.prepareForImport(ComponentType.ENTERPRISE_LOCATIONS, connector);

      expect(result.name).toBe('MyConnector');
      expect(result.description).toBe('Test connector');
      expect(result).not.toHaveProperty('otherField');
      expect(result).not.toHaveProperty('complexData');
    });

    it('should preserve all fields for regular components', () => {
      const dataflow: IONComponentDetail = {
        name: 'MyFlow',
        description: 'Test flow',
        sourcePoint: 'Source1',
        targetPoint: 'Target1',
      };

      const result = service.prepareForImport(ComponentType.DATAFLOWS, dataflow);

      expect(result).toEqual(dataflow);
    });

    it('should rename regular components when new name provided', () => {
      const dataflow: IONComponentDetail = {
        name: 'OldFlow',
        description: 'Test flow',
      };

      const result = service.prepareForImport(ComponentType.DATAFLOWS, dataflow, 'NewFlow');

      expect(result.name).toBe('NewFlow');
      expect(result.description).toBe('Test flow');
    });
  });

  describe('componentExists', () => {
    it('should return true when component exists', async () => {
      mockIONClient.getComponent.mockResolvedValue({ name: 'ExistingFlow' });

      const result = await service.componentExists(ComponentType.DATAFLOWS, 'ExistingFlow');

      expect(result).toBe(true);
    });

    it('should return false when component does not exist', async () => {
      mockIONClient.getComponent.mockRejectedValue(new Error('Not found'));

      const result = await service.componentExists(ComponentType.DATAFLOWS, 'NonExistent');

      expect(result).toBe(false);
    });
  });

  describe('generateUniqueName', () => {
    it('should generate unique name with suffix', async () => {
      mockIONClient.getComponent
        .mockResolvedValueOnce({ name: 'Flow_1' }) // First attempt exists
        .mockRejectedValueOnce(new Error('Not found')); // Second attempt doesn't exist

      const result = await service.generateUniqueName(ComponentType.DATAFLOWS, 'Flow');

      expect(result).toBe('Flow_2');
    });

    it('should return first suffix if base name not taken', async () => {
      mockIONClient.getComponent.mockRejectedValue(new Error('Not found'));

      const result = await service.generateUniqueName(ComponentType.DATAFLOWS, 'NewFlow');

      expect(result).toBe('NewFlow_1');
    });
  });

  describe('importComponent', () => {
    const testData: IONComponentDetail = {
      name: 'TestFlow',
      description: 'Test flow',
    };

    it('should create new component when it does not exist', async () => {
      mockIONClient.getComponent.mockRejectedValue(new Error('Not found'));
      mockIONClient.createComponent.mockResolvedValue(undefined);

      const result = await service.importComponent(
        ComponentType.DATAFLOWS,
        testData,
        'rename'
      );

      expect(result.status).toBe('created');
      expect(result.finalName).toBe('TestFlow');
      expect(mockIONClient.createComponent).toHaveBeenCalled();
    });

    it('should skip when component exists and onConflict is skip', async () => {
      mockIONClient.getComponent.mockResolvedValue({ name: 'TestFlow' });

      const result = await service.importComponent(
        ComponentType.DATAFLOWS,
        testData,
        'skip'
      );

      expect(result.status).toBe('skipped');
      expect(mockIONClient.createComponent).not.toHaveBeenCalled();
    });

    it('should fail when component exists and onConflict is fail', async () => {
      mockIONClient.getComponent.mockResolvedValue({ name: 'TestFlow' });

      const result = await service.importComponent(
        ComponentType.DATAFLOWS,
        testData,
        'fail'
      );

      expect(result.status).toBe('failed');
      expect(result.error).toContain('already exists');
      expect(mockIONClient.createComponent).not.toHaveBeenCalled();
    });

    it('should rename when component exists and onConflict is rename', async () => {
      // First call for existence check returns existing
      mockIONClient.getComponent
        .mockResolvedValueOnce({ name: 'TestFlow' }) // exists
        .mockRejectedValueOnce(new Error('Not found')); // TestFlow_1 doesn't exist
      mockIONClient.createComponent.mockResolvedValue(undefined);

      const result = await service.importComponent(
        ComponentType.DATAFLOWS,
        testData,
        'rename'
      );

      expect(result.status).toBe('created');
      expect(result.finalName).toBe('TestFlow_1');
      expect(result.originalName).toBe('TestFlow');
    });
  });

  describe('getImportOrder', () => {
    it('should return types in dependency order', () => {
      const order = service.getImportOrder();

      expect(order[0]).toBe(ComponentType.CONNECTION_POINTS);
      expect(order[1]).toBe(ComponentType.FILE_TEMPLATES);
      expect(order[2]).toBe(ComponentType.ENTERPRISE_LOCATIONS);
      expect(order[3]).toBe(ComponentType.MAPPINGS);
      expect(order[4]).toBe(ComponentType.DATAFLOWS);
      expect(order[5]).toBe(ComponentType.WORKFLOWS);
      expect(order[6]).toBe(ComponentType.ACTIVATION_POLICIES);
    });
  });

  describe('exportToGitHub', () => {
    beforeEach(() => {
      mockGitHubClient.getTree.mockResolvedValue({
        sha: 'tree-sha',
        url: 'https://api.github.com/...',
        tree: [],
        truncated: false,
      });
    });

    it('should export all components of specified type', async () => {
      const mockComponents: IONComponent[] = [
        { name: 'Flow1', description: 'First' },
        { name: 'Flow2', description: 'Second' },
      ];

      mockIONClient.listComponents.mockResolvedValue(mockComponents);
      mockIONClient.getComponent.mockImplementation(async (type, name) => ({
        name,
        description: `Details for ${name}`,
      }));
      mockGitHubClient.getFileContent.mockRejectedValue(new Error('Not found'));
      mockGitHubClient.createOrUpdateFile.mockResolvedValue({
        content: { name: 'test.json', path: 'test.json', sha: 'new-sha', size: 100 },
        commit: { sha: 'commit-sha', message: 'Export' },
      });

      const result = await service.exportToGitHub({
        types: [ComponentType.DATAFLOWS],
        repo: 'test-repo',
        branch: 'main',
      });

      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(mockGitHubClient.createOrUpdateFile).toHaveBeenCalledTimes(2);
    });

    it('should skip unchanged files unless force is true', async () => {
      const mockComponents: IONComponent[] = [{ name: 'Flow1' }];
      const componentData = { name: 'Flow1', description: 'Same content' };

      mockIONClient.listComponents.mockResolvedValue(mockComponents);
      mockIONClient.getComponent.mockResolvedValue(componentData);
      mockGitHubClient.getFileContent.mockResolvedValue(JSON.stringify(componentData, null, 2));

      const result = await service.exportToGitHub({
        types: [ComponentType.DATAFLOWS],
        repo: 'test-repo',
        branch: 'main',
      });

      expect(result.skipped).toBe(1);
      expect(result.succeeded).toBe(0);
      expect(mockGitHubClient.createOrUpdateFile).not.toHaveBeenCalled();
    });

    it('should not make GitHub calls in dry run mode', async () => {
      const mockComponents: IONComponent[] = [{ name: 'Flow1' }];

      mockIONClient.listComponents.mockResolvedValue(mockComponents);
      mockIONClient.getComponent.mockResolvedValue({ name: 'Flow1' });

      const result = await service.exportToGitHub({
        types: [ComponentType.DATAFLOWS],
        repo: 'test-repo',
        branch: 'main',
        dryRun: true,
      });

      expect(result.succeeded).toBe(1);
      expect(mockGitHubClient.createOrUpdateFile).not.toHaveBeenCalled();
    });
  });

  describe('importFromGitHub', () => {
    it('should import components in dependency order', async () => {
      const mockTree = {
        sha: 'tree-sha',
        url: 'https://api.github.com/...',
        tree: [
          { path: 'Connection point/CP1.json', mode: '100644', type: 'blob' as const, sha: 'sha1' },
          { path: 'Document flow/Flow1.json', mode: '100644', type: 'blob' as const, sha: 'sha2' },
        ],
        truncated: false,
      };

      mockGitHubClient.getTree.mockResolvedValue(mockTree);
      mockGitHubClient.getFileContent.mockImplementation(async (repo, path) => {
        if (path.includes('CP1')) {
          return JSON.stringify({ name: 'CP1', description: 'Connection point' });
        }
        return JSON.stringify({ name: 'Flow1', description: 'Dataflow' });
      });
      mockIONClient.getComponent.mockRejectedValue(new Error('Not found'));
      mockIONClient.createComponent.mockResolvedValue(undefined);

      const result = await service.importFromGitHub({
        repo: 'test-repo',
        branch: 'main',
        onConflict: 'rename',
      });

      expect(result.succeeded).toBe(2);

      // Verify connection point was processed before dataflow
      const callOrder = mockIONClient.createComponent.mock.calls.map(
        (call) => (call[1] as IONComponentDetail).name
      );
      expect(callOrder.indexOf('CP1')).toBeLessThan(callOrder.indexOf('Flow1'));
    });

    it('should handle conflict resolution correctly', async () => {
      const mockTree = {
        sha: 'tree-sha',
        url: 'https://api.github.com/...',
        tree: [
          { path: 'Document flow/Flow1.json', mode: '100644', type: 'blob' as const, sha: 'sha1' },
        ],
        truncated: false,
      };

      mockGitHubClient.getTree.mockResolvedValue(mockTree);
      mockGitHubClient.getFileContent.mockResolvedValue(
        JSON.stringify({ name: 'Flow1', description: 'Test' })
      );
      mockIONClient.getComponent.mockResolvedValue({ name: 'Flow1' }); // Already exists

      const result = await service.importFromGitHub({
        repo: 'test-repo',
        branch: 'main',
        onConflict: 'skip',
      });

      expect(result.skipped).toBe(1);
      expect(mockIONClient.createComponent).not.toHaveBeenCalled();
    });
  });
});
