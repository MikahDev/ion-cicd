/**
 * ION API Endpoints Configuration
 * Defines all API endpoint paths for ION services
 */

/**
 * ION Services base paths
 */
export const ION_SERVICES = {
  CONNECT: '/IONSERVICES/connect/model/v1',
  PROCESS: '/IONSERVICES/process/model/v1',
};

/**
 * Component endpoints
 */
export const ION_ENDPOINTS = {
  // Connect service endpoints
  dataflows: `${ION_SERVICES.CONNECT}/dataflows`,
  connectionpoints: `${ION_SERVICES.CONNECT}/connectionpoints`,
  mappings: `${ION_SERVICES.CONNECT}/mappings`,
  fileformattemplates: `${ION_SERVICES.CONNECT}/fileformattemplates`,
  enterpriselocations: `${ION_SERVICES.CONNECT}/enterpriselocations`,

  // Process service endpoints
  workflows: `${ION_SERVICES.PROCESS}/workflows`,
  activationpolicies: `${ION_SERVICES.PROCESS}/activationpolicies`,
};

/**
 * GitHub API proxy endpoints
 */
export const GITHUB_PROXY_ENDPOINTS = {
  BASE: '/CustomerApi/GitHubAPI/github',
  USER: '/CustomerApi/GitHubAPI/github/user',
  REPOS: '/CustomerApi/GitHubAPI/github/user/repos',
};
