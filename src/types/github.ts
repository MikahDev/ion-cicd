/**
 * GitHub API Type Definitions
 * Defines types for GitHub API responses via ION proxy
 */

/**
 * GitHub user information
 */
export interface GitHubUser {
  login: string;
  id: number;
  name?: string;
  email?: string;
}

/**
 * GitHub repository information
 */
export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: {
    login: string;
    id: number;
  };
  description?: string;
}

/**
 * GitHub tree entry (file or directory in repository)
 */
export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url?: string;
}

/**
 * GitHub tree structure (repository contents)
 */
export interface GitHubTree {
  sha: string;
  url: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

/**
 * GitHub file content response
 */
export interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file';
  content: string;
  encoding: 'base64';
  download_url: string;
}

/**
 * GitHub file create/update response
 */
export interface GitHubFileResult {
  content: {
    name: string;
    path: string;
    sha: string;
    size: number;
  };
  commit: {
    sha: string;
    message: string;
  };
}

/**
 * Payload for creating/updating a file in GitHub
 */
export interface GitHubFilePayload {
  message: string;
  content: string;
  branch: string;
  sha?: string;
}

/**
 * GitHub commit information
 */
export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
  };
  html_url: string;
}

/**
 * GitHub API endpoints via ION proxy
 */
export const GITHUB_ENDPOINTS = {
  /** Base path for GitHub API through ION proxy */
  BASE: '/CustomerApi/GitHubAPI/github',

  /** Get authenticated user */
  user: '/CustomerApi/GitHubAPI/github/user',

  /** List user repositories */
  repos: '/CustomerApi/GitHubAPI/github/user/repos',

  /** Get repository contents */
  repoContents: (owner: string, repo: string, path: string): string =>
    `/CustomerApi/GitHubAPI/github/repos/${owner}/${repo}/contents/${path}`,

  /** Get repository tree */
  repoTree: (owner: string, repo: string, branch: string): string =>
    `/CustomerApi/GitHubAPI/github/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,

  /** List commits */
  repoCommits: (owner: string, repo: string, options?: { sha?: string; path?: string }): string => {
    let url = `/CustomerApi/GitHubAPI/github/repos/${owner}/${repo}/commits`;
    const params: string[] = [];
    if (options?.sha) params.push(`sha=${options.sha}`);
    if (options?.path) params.push(`path=${encodeURIComponent(options.path)}`);
    if (params.length > 0) url += `?${params.join('&')}`;
    return url;
  },

  /** Get file content at specific commit */
  repoContentsAtRef: (owner: string, repo: string, path: string, ref: string): string =>
    `/CustomerApi/GitHubAPI/github/repos/${owner}/${repo}/contents/${path}?ref=${ref}`,

  /** Create repository */
  createRepo: '/CustomerApi/GitHubAPI/github/user/repos',
};
