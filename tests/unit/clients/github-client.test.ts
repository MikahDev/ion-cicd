/**
 * GitHubClient Unit Tests
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { GitHubClient } from '../../../src/clients/github-client.js';
import { IONClient } from '../../../src/clients/ion-client.js';
import { GitHubUser, GitHubRepo, GitHubTree, GitHubFileResult } from '../../../src/types/github.js';

// Create typed mock
type MockRequestFn = jest.Mock<(method: string, path: string, data?: unknown) => Promise<unknown>>;

describe('GitHubClient', () => {
  let client: GitHubClient;
  let mockRequest: MockRequestFn;

  beforeEach(() => {
    mockRequest = jest.fn() as MockRequestFn;
    const mockIONClient = {
      request: mockRequest,
      getToken: jest.fn().mockReturnValue('test-token'),
      getBaseUrl: jest.fn().mockReturnValue('https://api.example.com/TEST_TENANT'),
    } as unknown as IONClient;

    client = new GitHubClient(mockIONClient);
  });

  describe('getUser', () => {
    it('should fetch and cache GitHub username', async () => {
      const mockUser: GitHubUser = {
        login: 'testuser',
        id: 12345,
        name: 'Test User',
      };

      mockRequest.mockResolvedValueOnce(mockUser);

      const result = await client.getUser();

      expect(result.login).toBe('testuser');
      expect(mockRequest).toHaveBeenCalledWith('GET', '/CustomerApi/GitHubAPI/github/user');
    });
  });

  describe('listRepos', () => {
    it('should return list of repositories', async () => {
      const mockRepos: GitHubRepo[] = [
        {
          id: 1,
          name: 'repo1',
          full_name: 'testuser/repo1',
          private: true,
          default_branch: 'main',
          owner: { login: 'testuser', id: 12345 },
        },
        {
          id: 2,
          name: 'repo2',
          full_name: 'testuser/repo2',
          private: false,
          default_branch: 'master',
          owner: { login: 'testuser', id: 12345 },
        },
      ];

      mockRequest.mockResolvedValueOnce(mockRepos);

      const result = await client.listRepos();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('repo1');
    });
  });

  describe('createRepo', () => {
    it('should create a private repository', async () => {
      const mockRepo: GitHubRepo = {
        id: 1,
        name: 'new-repo',
        full_name: 'testuser/new-repo',
        private: true,
        default_branch: 'main',
        owner: { login: 'testuser', id: 12345 },
      };

      mockRequest.mockResolvedValueOnce(mockRepo);

      const result = await client.createRepo('new-repo', 'Test description');

      expect(result.name).toBe('new-repo');
      expect(result.private).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/CustomerApi/GitHubAPI/github/user/repos', {
        name: 'new-repo',
        description: 'Test description',
        homepage: 'https://github.com',
        private: true,
      });
    });
  });

  describe('getTree', () => {
    it('should fetch and cache repository tree', async () => {
      const mockUser: GitHubUser = { login: 'testuser', id: 12345 };
      const mockTree: GitHubTree = {
        sha: 'tree-sha',
        url: 'https://api.github.com/...',
        tree: [
          { path: 'Document flow', mode: '040000', type: 'tree', sha: 'folder-sha' },
          { path: 'Document flow/Flow1.json', mode: '100644', type: 'blob', sha: 'file-sha-1' },
          { path: 'Document flow/Flow2.json', mode: '100644', type: 'blob', sha: 'file-sha-2' },
        ],
        truncated: false,
      };

      mockRequest.mockResolvedValueOnce(mockUser); // getUser
      mockRequest.mockResolvedValueOnce(mockTree); // getTree

      const result = await client.getTree('test-repo', 'main');

      expect(result.tree).toHaveLength(3);
      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/CustomerApi/GitHubAPI/github/repos/testuser/test-repo/git/trees/main?recursive=1'
      );

      // Second call should use cache
      const cachedResult = await client.getTree('test-repo', 'main');
      expect(cachedResult).toBe(result);
      expect(mockRequest).toHaveBeenCalledTimes(2); // No additional calls
    });
  });

  describe('getFileSha', () => {
    it('should return SHA from tree', async () => {
      const mockUser: GitHubUser = { login: 'testuser', id: 12345 };
      const mockTree: GitHubTree = {
        sha: 'tree-sha',
        url: 'https://api.github.com/...',
        tree: [{ path: 'Document flow/Flow1.json', mode: '100644', type: 'blob', sha: 'file-sha-123' }],
        truncated: false,
      };

      mockRequest.mockResolvedValueOnce(mockUser);
      mockRequest.mockResolvedValueOnce(mockTree);

      const sha = await client.getFileSha('test-repo', 'Document flow/Flow1.json', 'main');

      expect(sha).toBe('file-sha-123');
    });

    it('should return undefined for non-existent file', async () => {
      const mockUser: GitHubUser = { login: 'testuser', id: 12345 };
      const mockTree: GitHubTree = {
        sha: 'tree-sha',
        url: 'https://api.github.com/...',
        tree: [],
        truncated: false,
      };

      mockRequest.mockResolvedValueOnce(mockUser);
      mockRequest.mockResolvedValueOnce(mockTree);

      const sha = await client.getFileSha('test-repo', 'nonexistent.json', 'main');

      expect(sha).toBeUndefined();
    });
  });

  describe('createOrUpdateFile', () => {
    it('should create new file without SHA', async () => {
      const mockUser: GitHubUser = { login: 'testuser', id: 12345 };
      const mockTree: GitHubTree = {
        sha: 'tree-sha',
        url: 'https://api.github.com/...',
        tree: [],
        truncated: false,
      };
      const mockResult: GitHubFileResult = {
        content: { name: 'Flow1.json', path: 'Document flow/Flow1.json', sha: 'new-sha', size: 100 },
        commit: { sha: 'commit-sha', message: 'Add Flow1' },
      };

      mockRequest.mockResolvedValueOnce(mockUser); // getUsername
      mockRequest.mockResolvedValueOnce(mockTree); // getTree (for SHA check)
      mockRequest.mockResolvedValueOnce(mockResult); // createOrUpdateFile

      const result = await client.createOrUpdateFile(
        'test-repo',
        'Document flow/Flow1.json',
        '{"name": "Flow1"}',
        'Add Flow1',
        'main'
      );

      expect(result.content.sha).toBe('new-sha');
    });

    it('should update existing file with SHA', async () => {
      const mockUser: GitHubUser = { login: 'testuser', id: 12345 };
      const mockTree: GitHubTree = {
        sha: 'tree-sha',
        url: 'https://api.github.com/...',
        tree: [{ path: 'Document flow/Flow1.json', mode: '100644', type: 'blob', sha: 'existing-sha' }],
        truncated: false,
      };
      const mockResult: GitHubFileResult = {
        content: { name: 'Flow1.json', path: 'Document flow/Flow1.json', sha: 'updated-sha', size: 150 },
        commit: { sha: 'commit-sha', message: 'Update Flow1' },
      };

      mockRequest.mockResolvedValueOnce(mockUser);
      mockRequest.mockResolvedValueOnce(mockTree);
      mockRequest.mockResolvedValueOnce(mockResult);

      await client.createOrUpdateFile(
        'test-repo',
        'Document flow/Flow1.json',
        '{"name": "Flow1", "updated": true}',
        'Update Flow1',
        'main'
      );

      // Verify SHA was included in the request
      expect(mockRequest).toHaveBeenLastCalledWith(
        'PUT',
        expect.any(String),
        expect.objectContaining({
          sha: 'existing-sha',
        })
      );
    });
  });

  describe('getComponentFolders', () => {
    it('should return list of component folders', async () => {
      const mockUser: GitHubUser = { login: 'testuser', id: 12345 };
      const mockTree: GitHubTree = {
        sha: 'tree-sha',
        url: 'https://api.github.com/...',
        tree: [
          { path: 'Document flow', mode: '040000', type: 'tree', sha: 'sha1' },
          { path: 'Connection point', mode: '040000', type: 'tree', sha: 'sha2' },
          { path: 'Mapping', mode: '040000', type: 'tree', sha: 'sha3' },
          { path: 'README.md', mode: '100644', type: 'blob', sha: 'sha4' },
        ],
        truncated: false,
      };

      mockRequest.mockResolvedValueOnce(mockUser);
      mockRequest.mockResolvedValueOnce(mockTree);

      const folders = await client.getComponentFolders('test-repo', 'main');

      expect(folders).toHaveLength(3);
      expect(folders).toContain('Document flow');
      expect(folders).toContain('Connection point');
      expect(folders).toContain('Mapping');
    });
  });

  describe('listComponentFiles', () => {
    it('should return list of component names', async () => {
      const mockUser: GitHubUser = { login: 'testuser', id: 12345 };
      const mockTree: GitHubTree = {
        sha: 'tree-sha',
        url: 'https://api.github.com/...',
        tree: [
          { path: 'Document flow', mode: '040000', type: 'tree', sha: 'sha1' },
          { path: 'Document flow/Flow1.json', mode: '100644', type: 'blob', sha: 'sha2' },
          { path: 'Document flow/Flow2.json', mode: '100644', type: 'blob', sha: 'sha3' },
          { path: 'Document flow/Flow3.json', mode: '100644', type: 'blob', sha: 'sha4' },
        ],
        truncated: false,
      };

      mockRequest.mockResolvedValueOnce(mockUser);
      mockRequest.mockResolvedValueOnce(mockTree);

      const files = await client.listComponentFiles('test-repo', 'main', 'Document flow');

      expect(files).toHaveLength(3);
      expect(files).toContain('Flow1');
      expect(files).toContain('Flow2');
      expect(files).toContain('Flow3');
    });
  });

  describe('clearCache', () => {
    it('should clear tree cache so next call fetches fresh data', async () => {
      const mockUser: GitHubUser = { login: 'testuser', id: 12345 };
      const mockTree: GitHubTree = {
        sha: 'tree-sha',
        url: 'https://api.github.com/...',
        tree: [],
        truncated: false,
      };

      mockRequest.mockResolvedValueOnce(mockUser);
      mockRequest.mockResolvedValueOnce(mockTree);

      // Populate cache
      const result1 = await client.getTree('test-repo', 'main');
      expect(result1.sha).toBe('tree-sha');

      // Clear cache (only clears tree and SHA cache, not username)
      client.clearCache();

      // Set up for second call - username is still cached, so only tree is fetched
      const mockTree2: GitHubTree = {
        sha: 'tree-sha-2',
        url: 'https://api.github.com/...',
        tree: [{ path: 'new-file.json', mode: '100644', type: 'blob', sha: 'new-sha' }],
        truncated: false,
      };
      mockRequest.mockResolvedValueOnce(mockTree2);

      // This should make new request for tree (username is still cached)
      const result2 = await client.getTree('test-repo', 'main');

      // Should have the new tree data
      expect(result2.sha).toBe('tree-sha-2');
      expect(result2.tree).toHaveLength(1);
    });
  });
});
