/**
 * GitHub API Client
 * Handles GitHub operations through the ION API Gateway proxy
 */

import {
  GitHubUser,
  GitHubRepo,
  GitHubTree,
  GitHubTreeEntry,
  GitHubFileContent,
  GitHubFileResult,
  GitHubFilePayload,
  GitHubCommit,
  GITHUB_ENDPOINTS,
} from '../types/github.js';
import { IONClient } from './ion-client.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('GitHubClient');

/**
 * GitHub API Client that operates through the ION API Gateway proxy
 * All GitHub API calls MUST go through the ION proxy at /CustomerApi/GitHubAPI/github
 */
export class GitHubClient {
  private ionClient: IONClient;
  private username: string | null = null;
  private treeCache: Map<string, GitHubTree> = new Map();
  private shaCache: Map<string, string> = new Map();
  private defaultOwner: string | null = null;
  private defaultRepo: string | null = null;

  /**
   * Creates a new GitHubClient instance
   * @param ionClient - An authenticated IONClient instance
   * @param options - Optional configuration
   */
  constructor(
    ionClient: IONClient,
    options?: {
      /** Default owner for repo operations (e.g., 'PedalGroup') */
      owner?: string;
      /** Default repo name (e.g., 'Infor') */
      repo?: string;
    }
  ) {
    this.ionClient = ionClient;
    if (options?.owner) {
      this.defaultOwner = options.owner;
    }
    if (options?.repo) {
      this.defaultRepo = options.repo;
    }
  }

  /**
   * Sets the default repository for operations
   * Useful when working with org repos where username detection doesn't apply
   * @param owner - Repository owner (user or organisation)
   * @param repo - Repository name
   */
  public setDefaultRepo(owner: string, repo: string): void {
    this.defaultOwner = owner;
    this.defaultRepo = repo;
    logger.debug('Set default repo', { owner, repo });
  }

  /**
   * Gets the default repo full name (owner/repo)
   */
  public getDefaultRepoFullName(): string | null {
    if (this.defaultOwner && this.defaultRepo) {
      return `${this.defaultOwner}/${this.defaultRepo}`;
    }
    return null;
  }

  /**
   * Generates a cache key for the tree cache
   */
  private getTreeCacheKey(repo: string, branch: string): string {
    return `${repo}:${branch}`;
  }

  /**
   * Generates a cache key for the SHA cache
   */
  private getShaCacheKey(repo: string, path: string): string {
    return `${repo}:${path}`;
  }

  /**
   * Clears all caches
   */
  public clearCache(): void {
    this.treeCache.clear();
    this.shaCache.clear();
  }

  /**
   * Gets the authenticated GitHub user
   * Note: Some ION configurations with limited repo access may not support /user endpoint.
   * In that case, we fall back to extracting username from the repos list.
   * @returns GitHub user information
   */
  public async getUser(): Promise<GitHubUser> {
    logger.debug('Fetching GitHub user');

    try {
      const user = await this.ionClient.request<GitHubUser>('GET', GITHUB_ENDPOINTS.user);
      this.username = user.login;
      logger.info('Got GitHub user', { username: user.login });
      return user;
    } catch (error) {
      // Fallback: extract username from repos list (works with limited org access)
      logger.debug('Falling back to extracting username from repos list');
      const repos = await this.listRepos();
      if (repos.length > 0 && repos[0].owner) {
        // Find a repo where we're likely the owner or have access
        const ownedRepo = repos.find((r) => r.owner.login);
        if (ownedRepo) {
          this.username = ownedRepo.owner.login;
          logger.info('Got GitHub user from repos', { username: this.username });
          return {
            login: ownedRepo.owner.login,
            id: ownedRepo.owner.id,
          };
        }
      }
      throw error;
    }
  }

  /**
   * Gets the owner for repo operations
   * Uses defaultOwner if set, otherwise falls back to username
   */
  private async getOwner(): Promise<string> {
    if (this.defaultOwner) {
      return this.defaultOwner;
    }
    if (!this.username) {
      await this.getUser();
    }
    return this.username!;
  }

  /**
   * Lists all repositories for the authenticated user
   * @returns Array of repositories
   */
  public async listRepos(): Promise<GitHubRepo[]> {
    logger.debug('Listing repositories');

    const repos = await this.ionClient.request<GitHubRepo[]>('GET', GITHUB_ENDPOINTS.repos);

    logger.info('Listed repositories', { count: repos.length });
    return repos;
  }

  /**
   * Lists private repositories owned by the authenticated user
   * @returns Array of private repositories
   */
  public async listPrivateRepos(): Promise<GitHubRepo[]> {
    const repos = await this.listRepos();
    const owner = await this.getOwner();

    return repos.filter((repo) => repo.private && repo.owner.login === owner);
  }

  /**
   * Creates a new private repository
   * @param name - Repository name
   * @param description - Repository description
   * @returns The created repository
   */
  public async createRepo(
    name: string,
    description = 'Created by ION CI/CD Toolkit'
  ): Promise<GitHubRepo> {
    logger.debug('Creating repository', { name });

    const repo = await this.ionClient.request<GitHubRepo>('POST', GITHUB_ENDPOINTS.createRepo, {
      name,
      description,
      homepage: 'https://github.com',
      private: true,
    });

    logger.info('Created repository', { name, fullName: repo.full_name });
    return repo;
  }

  /**
   * Gets the tree structure of a repository
   * @param repo - Repository name
   * @param branch - Branch name
   * @returns Repository tree structure
   */
  public async getTree(repo: string, branch: string): Promise<GitHubTree> {
    const cacheKey = this.getTreeCacheKey(repo, branch);

    // Check cache first
    const cached = this.treeCache.get(cacheKey);
    if (cached) {
      logger.debug('Using cached tree', { repo, branch });
      return cached;
    }

    const owner = await this.getOwner();
    const endpoint = GITHUB_ENDPOINTS.repoTree(owner, repo, branch);

    logger.debug('Fetching repository tree', { repo, branch, endpoint });

    const tree = await this.ionClient.request<GitHubTree>('GET', endpoint);

    // Cache the tree
    this.treeCache.set(cacheKey, tree);

    // Also cache all file SHAs from the tree
    for (const entry of tree.tree) {
      if (entry.type === 'blob') {
        const shaKey = this.getShaCacheKey(repo, entry.path);
        this.shaCache.set(shaKey, entry.sha);
      }
    }

    logger.info('Got repository tree', { repo, branch, fileCount: tree.tree.length });
    return tree;
  }

  /**
   * Finds a file in the tree structure
   * @param repo - Repository name
   * @param path - File path
   * @param branch - Branch name
   * @returns Tree entry if found, undefined otherwise
   */
  public async findFile(
    repo: string,
    path: string,
    branch: string
  ): Promise<GitHubTreeEntry | undefined> {
    const tree = await this.getTree(repo, branch);
    return tree.tree.find((entry) => entry.path === path && entry.type === 'blob');
  }

  /**
   * Gets the SHA of a file from cache or by finding it in the tree
   * @param repo - Repository name
   * @param path - File path
   * @param branch - Branch name
   * @returns File SHA or undefined if not found
   */
  public async getFileSha(repo: string, path: string, branch: string): Promise<string | undefined> {
    const shaKey = this.getShaCacheKey(repo, path);

    // Check cache first
    const cached = this.shaCache.get(shaKey);
    if (cached) {
      return cached;
    }

    // Find in tree
    const file = await this.findFile(repo, path, branch);
    if (file) {
      this.shaCache.set(shaKey, file.sha);
      return file.sha;
    }

    return undefined;
  }

  /**
   * Gets the content of a file
   * @param repo - Repository name
   * @param path - File path
   * @param branch - Branch name
   * @returns File content (decoded from base64)
   */
  public async getFileContent(repo: string, path: string, branch: string): Promise<string> {
    const owner = await this.getOwner();
    const endpoint = `${GITHUB_ENDPOINTS.repoContents(owner, repo, path)}?ref=${branch}`;

    logger.debug('Fetching file content', { repo, path, branch });

    const file = await this.ionClient.request<GitHubFileContent>('GET', endpoint);

    // Decode base64 content
    const content = Buffer.from(file.content, 'base64').toString('utf8');

    logger.debug('Got file content', { repo, path, size: file.size });
    return content;
  }

  /**
   * Creates or updates a file in the repository
   * @param repo - Repository name
   * @param path - File path
   * @param content - File content (will be base64 encoded)
   * @param message - Commit message
   * @param branch - Branch name
   * @param sha - Existing file SHA (required for updates)
   * @returns File operation result
   */
  public async createOrUpdateFile(
    repo: string,
    path: string,
    content: string,
    message: string,
    branch: string,
    sha?: string
  ): Promise<GitHubFileResult> {
    const owner = await this.getOwner();
    const endpoint = GITHUB_ENDPOINTS.repoContents(owner, repo, path);

    // If no SHA provided, try to get it from cache/tree
    let existingSha = sha;
    if (!existingSha) {
      existingSha = await this.getFileSha(repo, path, branch);
    }

    const payload: GitHubFilePayload = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
    };

    // SHA is required for updates
    if (existingSha) {
      payload.sha = existingSha;
      logger.debug('Updating file', { repo, path, sha: existingSha });
    } else {
      logger.debug('Creating file', { repo, path });
    }

    const result = await this.ionClient.request<GitHubFileResult>('PUT', endpoint, payload);

    // Update SHA cache with new SHA
    const shaKey = this.getShaCacheKey(repo, path);
    this.shaCache.set(shaKey, result.content.sha);

    // Invalidate tree cache since structure changed
    const treeCacheKey = this.getTreeCacheKey(repo, branch);
    this.treeCache.delete(treeCacheKey);

    logger.info(existingSha ? 'Updated file' : 'Created file', {
      repo,
      path,
      newSha: result.content.sha,
    });

    return result;
  }

  /**
   * Deletes a file from the repository
   * @param repo - Repository name
   * @param path - File path
   * @param message - Commit message
   * @param branch - Branch name
   * @param sha - File SHA (required)
   */
  public async deleteFile(
    repo: string,
    path: string,
    message: string,
    branch: string,
    sha: string
  ): Promise<void> {
    const owner = await this.getOwner();
    const endpoint = GITHUB_ENDPOINTS.repoContents(owner, repo, path);

    logger.debug('Deleting file', { repo, path, sha });

    await this.ionClient.request('DELETE', endpoint, {
      message,
      sha,
      branch,
    });

    // Remove from SHA cache
    const shaKey = this.getShaCacheKey(repo, path);
    this.shaCache.delete(shaKey);

    // Invalidate tree cache
    const treeCacheKey = this.getTreeCacheKey(repo, branch);
    this.treeCache.delete(treeCacheKey);

    logger.info('Deleted file', { repo, path });
  }

  /**
   * Refreshes the SHA cache for a repository
   * @param repo - Repository name
   * @param branch - Branch name
   */
  public async refreshShaCache(repo: string, branch: string): Promise<void> {
    // Clear tree cache to force refresh
    const treeCacheKey = this.getTreeCacheKey(repo, branch);
    this.treeCache.delete(treeCacheKey);

    // Fetch fresh tree (which also populates SHA cache)
    await this.getTree(repo, branch);

    logger.debug('Refreshed SHA cache', { repo, branch });
  }

  /**
   * Gets the list of component folders in a repository
   * @param repo - Repository name
   * @param branch - Branch name
   * @returns Array of folder names that match ION component types
   */
  public async getComponentFolders(repo: string, branch: string): Promise<string[]> {
    const tree = await this.getTree(repo, branch);

    const componentFolders = [
      'Document flow',
      'Connection point',
      'File template',
      'Enterprise Connector',
      'Mapping',
      'Workflow',
      'Activation policy',
    ];

    return tree.tree
      .filter((entry) => entry.type === 'tree' && componentFolders.includes(entry.path))
      .map((entry) => entry.path);
  }

  /**
   * Lists all files in a component folder
   * @param repo - Repository name
   * @param branch - Branch name
   * @param componentFolder - The component folder name
   * @returns Array of file names (without .json extension)
   */
  public async listComponentFiles(
    repo: string,
    branch: string,
    componentFolder: string
  ): Promise<string[]> {
    const tree = await this.getTree(repo, branch);
    const prefix = `${componentFolder}/`;

    return tree.tree
      .filter(
        (entry) =>
          entry.type === 'blob' && entry.path.startsWith(prefix) && entry.path.endsWith('.json')
      )
      .map((entry) => {
        const fileName = entry.path.substring(prefix.length);
        return fileName.substring(0, fileName.length - 5); // Remove .json
      });
  }

  /**
   * Lists commits for a repository, optionally filtered by path
   * @param repo - Repository name
   * @param options - Optional filters (sha for branch, path for specific file/folder)
   * @returns Array of commits
   */
  public async listCommits(
    repo: string,
    options?: { sha?: string; path?: string }
  ): Promise<GitHubCommit[]> {
    const owner = await this.getOwner();
    const endpoint = GITHUB_ENDPOINTS.repoCommits(owner, repo, options);

    logger.debug('Listing commits', { repo, options });

    const commits = await this.ionClient.request<GitHubCommit[]>('GET', endpoint);

    logger.info('Listed commits', { repo, count: commits.length });
    return commits;
  }

  /**
   * Finds the commit at or before a specific date
   * @param repo - Repository name
   * @param date - Target date (YYYY-MM-DD format)
   * @param branch - Branch name
   * @returns The commit SHA, or undefined if none found
   */
  public async findCommitAtDate(
    repo: string,
    date: string,
    branch: string
  ): Promise<string | undefined> {
    const targetDate = new Date(date);
    targetDate.setHours(23, 59, 59, 999); // End of day

    const commits = await this.listCommits(repo, { sha: branch });

    // Find the first commit on or before the target date
    for (const commit of commits) {
      const commitDate = new Date(commit.commit.committer.date);
      if (commitDate <= targetDate) {
        logger.info('Found commit at date', { date, sha: commit.sha.substring(0, 7) });
        return commit.sha;
      }
    }

    logger.warn('No commit found at or before date', { date });
    return undefined;
  }

  /**
   * Gets the tree at a specific commit
   * @param repo - Repository name
   * @param commitSha - Commit SHA
   * @returns Repository tree at that commit
   */
  public async getTreeAtCommit(repo: string, commitSha: string): Promise<GitHubTree> {
    const owner = await this.getOwner();
    const endpoint = `/CustomerApi/GitHubAPI/github/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`;

    logger.debug('Fetching tree at commit', { repo, commit: commitSha.substring(0, 7) });

    const tree = await this.ionClient.request<GitHubTree>('GET', endpoint);

    logger.info('Got tree at commit', { repo, commit: commitSha.substring(0, 7), fileCount: tree.tree.length });
    return tree;
  }

  /**
   * Gets file content at a specific commit
   * @param repo - Repository name
   * @param path - File path
   * @param commitSha - Commit SHA
   * @returns File content (decoded from base64)
   */
  public async getFileContentAtCommit(
    repo: string,
    path: string,
    commitSha: string
  ): Promise<string> {
    const owner = await this.getOwner();
    const endpoint = GITHUB_ENDPOINTS.repoContentsAtRef(owner, repo, path, commitSha);

    logger.debug('Fetching file at commit', { repo, path, commit: commitSha.substring(0, 7) });

    const file = await this.ionClient.request<GitHubFileContent>('GET', endpoint);

    // Decode base64 content
    const content = Buffer.from(file.content, 'base64').toString('utf8');

    logger.debug('Got file at commit', { repo, path, size: file.size });
    return content;
  }
}
