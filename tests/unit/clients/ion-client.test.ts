/**
 * IONClient Unit Tests
 */

import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { IONClient } from '../../../src/clients/ion-client.js';
import { ComponentType, IONApiConfig } from '../../../src/types/index.js';
import { AuthenticationError, IONApiError } from '../../../src/utils/errors.js';

// Mock axios
const mockAxios = new MockAdapter(axios);

// Test configuration
const mockConfig: IONApiConfig = {
  ti: 'TEST_TENANT',
  ci: 'client-id',
  cs: 'client-secret',
  pu: 'https://sso.example.com',
  iu: 'https://api.example.com',
  ot: '/token.oauth2',
  saak: 'access-key',
  sask: 'secret-key',
};

describe('IONClient', () => {
  let client: IONClient;

  beforeEach(() => {
    mockAxios.reset();
    client = new IONClient(mockConfig, {
      retryConfig: { maxRetries: 1, baseDelay: 10 },
      tokenRefreshBufferSeconds: 60,
    });
  });

  afterAll(() => {
    mockAxios.restore();
  });

  describe('authenticate', () => {
    it('should obtain access token with valid credentials', async () => {
      mockAxios.onPost('https://sso.example.com/token.oauth2').reply(200, {
        access_token: 'test-token-123',
        expires_in: 7200,
      });

      await client.authenticate();

      expect(client.getToken()).toBe('test-token-123');
    });

    it('should throw AuthenticationError on 401 response', async () => {
      mockAxios.onPost('https://sso.example.com/token.oauth2').reply(401, {
        error: 'invalid_client',
        error_description: 'Invalid credentials',
      });

      await expect(client.authenticate()).rejects.toThrow(AuthenticationError);
    });

    it('should send correct request body', async () => {
      mockAxios.onPost('https://sso.example.com/token.oauth2').reply((config) => {
        const data = config.data as string;
        expect(data).toContain('grant_type=password');
        expect(data).toContain('client_id=client-id');
        expect(data).toContain('client_secret=client-secret');
        expect(data).toContain('username=access-key');
        expect(data).toContain('password=secret-key');
        return [200, { access_token: 'token', expires_in: 3600 }];
      });

      await client.authenticate();
    });
  });

  describe('getBaseUrl', () => {
    it('should return correct base URL', () => {
      expect(client.getBaseUrl()).toBe('https://api.example.com/TEST_TENANT');
    });
  });

  describe('listComponents', () => {
    beforeEach(async () => {
      // Set up authentication
      mockAxios.onPost('https://sso.example.com/token.oauth2').reply(200, {
        access_token: 'test-token',
        expires_in: 7200,
      });
    });

    it('should return list of components', async () => {
      const mockComponents = [{ name: 'Flow1' }, { name: 'Flow2' }, { name: 'Flow3' }];

      mockAxios
        .onGet('https://api.example.com/TEST_TENANT/IONSERVICES/connect/model/v1/dataflows')
        .reply(200, mockComponents);

      const result = await client.listComponents(ComponentType.DATAFLOWS);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Flow1');
      expect(result[1].name).toBe('Flow2');
    });

    it('should throw IONApiError on 500 response', async () => {
      mockAxios
        .onGet('https://api.example.com/TEST_TENANT/IONSERVICES/connect/model/v1/dataflows')
        .reply(500, { error: 'Internal Server Error' });

      await expect(client.listComponents(ComponentType.DATAFLOWS)).rejects.toThrow(IONApiError);
    });
  });

  describe('getComponent', () => {
    beforeEach(async () => {
      mockAxios.onPost('https://sso.example.com/token.oauth2').reply(200, {
        access_token: 'test-token',
        expires_in: 7200,
      });
    });

    it('should return component details', async () => {
      const mockComponent = {
        name: 'TestFlow',
        description: 'A test dataflow',
        nodes: [],
      };

      mockAxios
        .onGet('https://api.example.com/TEST_TENANT/IONSERVICES/connect/model/v1/dataflows/TestFlow')
        .reply(200, mockComponent);

      const result = await client.getComponent(ComponentType.DATAFLOWS, 'TestFlow');

      expect(result.name).toBe('TestFlow');
      expect(result.description).toBe('A test dataflow');
    });

    it('should URL-encode component name', async () => {
      const mockComponent = { name: 'Flow With Spaces' };

      mockAxios
        .onGet(
          'https://api.example.com/TEST_TENANT/IONSERVICES/connect/model/v1/dataflows/Flow%20With%20Spaces'
        )
        .reply(200, mockComponent);

      const result = await client.getComponent(ComponentType.DATAFLOWS, 'Flow With Spaces');
      expect(result.name).toBe('Flow With Spaces');
    });
  });

  describe('componentExists', () => {
    beforeEach(async () => {
      mockAxios.onPost('https://sso.example.com/token.oauth2').reply(200, {
        access_token: 'test-token',
        expires_in: 7200,
      });
    });

    it('should return true when component exists', async () => {
      mockAxios
        .onGet('https://api.example.com/TEST_TENANT/IONSERVICES/connect/model/v1/dataflows/TestFlow')
        .reply(200, { name: 'TestFlow' });

      const result = await client.componentExists(ComponentType.DATAFLOWS, 'TestFlow');

      expect(result).toBe(true);
    });

    it('should return false when component does not exist (404)', async () => {
      mockAxios
        .onGet('https://api.example.com/TEST_TENANT/IONSERVICES/connect/model/v1/dataflows/NonExistent')
        .reply(404, { error: 'Not found' });

      const result = await client.componentExists(ComponentType.DATAFLOWS, 'NonExistent');

      expect(result).toBe(false);
    });
  });

  describe('createComponent', () => {
    beforeEach(async () => {
      mockAxios.onPost('https://sso.example.com/token.oauth2').reply(200, {
        access_token: 'test-token',
        expires_in: 7200,
      });
    });

    it('should create component successfully', async () => {
      const componentData = {
        name: 'NewFlow',
        description: 'A new dataflow',
      };

      mockAxios
        .onPost('https://api.example.com/TEST_TENANT/IONSERVICES/connect/model/v1/dataflows')
        .reply(201);

      await expect(client.createComponent(ComponentType.DATAFLOWS, componentData)).resolves.not.toThrow();
    });
  });

  describe('token refresh', () => {
    it('should automatically refresh token when expired', async () => {
      // First authentication
      mockAxios.onPost('https://sso.example.com/token.oauth2').replyOnce(200, {
        access_token: 'token-1',
        expires_in: 1, // Expires in 1 second
      });

      await client.authenticate();
      expect(client.getToken()).toBe('token-1');

      // Wait for token to expire (considering buffer)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second authentication (refresh)
      mockAxios.onPost('https://sso.example.com/token.oauth2').reply(200, {
        access_token: 'token-2',
        expires_in: 7200,
      });

      // This should trigger token refresh
      mockAxios
        .onGet('https://api.example.com/TEST_TENANT/IONSERVICES/connect/model/v1/connectionpoints')
        .reply(200, []);

      await client.listComponents(ComponentType.CONNECTION_POINTS);
    });
  });

  describe('healthCheck', () => {
    it('should return true when API is accessible', async () => {
      mockAxios.onPost('https://sso.example.com/token.oauth2').reply(200, {
        access_token: 'test-token',
        expires_in: 7200,
      });

      mockAxios
        .onGet('https://api.example.com/TEST_TENANT/IONSERVICES/connect/model/v1/connectionpoints')
        .reply(200, []);

      const result = await client.healthCheck();
      expect(result).toBe(true);
    });

    it('should return false when API is not accessible', async () => {
      mockAxios.onPost('https://sso.example.com/token.oauth2').reply(500);

      const result = await client.healthCheck();
      expect(result).toBe(false);
    });
  });
});
