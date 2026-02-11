import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCacheKey, parseCacheKey, set } from '../dist/cache.js';
import { createMcpServer } from '../dist/mcp.js';

describe('MCP Server', () => {
  describe('createMcpServer', () => {
    it('creates a server instance', async () => {
      const server = await createMcpServer();
      assert.ok(server, 'Server should be created');
      assert.ok(server.server, 'Server should have underlying server');
      assert.strictEqual(
        typeof server.close,
        'function',
        'Server should have close method'
      );
    });

    it('can set error handler on server', async () => {
      const server = await createMcpServer();
      let errorCaught: Error | null = null;

      server.server.onerror = (error) => {
        errorCaught = error instanceof Error ? error : new Error(String(error));
      };

      assert.strictEqual(
        typeof server.server.onerror,
        'function',
        'Error handler should be settable'
      );

      // Test the handler
      const testError = new Error('test');
      if (server.server.onerror) {
        server.server.onerror(testError);
      }
      assert.strictEqual(
        errorCaught,
        testError,
        'Error handler should receive errors'
      );
    });

    it('publishes extended server info metadata', async () => {
      const server = await createMcpServer();

      const serverInfo = (
        server.server as unknown as {
          _serverInfo?: {
            title?: string;
            description?: string;
            websiteUrl?: string;
          };
        }
      )._serverInfo;

      assert.ok(serverInfo, 'Server info should be available');
      assert.equal(serverInfo?.title, 'superFetch MCP');
      assert.equal(
        serverInfo?.description,
        'Fetch web pages and convert them into clean, AI-readable Markdown.'
      );
      assert.equal(
        serverInfo?.websiteUrl,
        'https://github.com/j0hanz/super-fetch-mcp-server'
      );
    });
  });

  describe('Server lifecycle', () => {
    it('can close server cleanly', async () => {
      const server = await createMcpServer();
      await server.close();
      assert.ok(true, 'Server should close without errors');
    });

    it('can create and close multiple servers', async () => {
      const server1 = await createMcpServer();
      const server2 = await createMcpServer();

      await server1.close();
      await server2.close();

      assert.ok(true, 'Multiple servers should close cleanly');
    });

    it('handles close() called twice gracefully', async () => {
      const server = await createMcpServer();
      await server.close();
      await server.close(); // Should not throw
      assert.ok(true, 'Closing twice should be safe');
    });
  });

  describe('Server error handling', () => {
    it('error handler does not throw when error is passed', async () => {
      const server = await createMcpServer();
      const error = new Error('Test error');

      // Should not throw when error handler is invoked
      assert.doesNotThrow(() => {
        if (server.server.onerror) {
          server.server.onerror(error);
        }
      }, 'Error handler should not throw');
    });

    it('error handler handles non-Error objects', async () => {
      const server = await createMcpServer();

      // Should handle string errors
      assert.doesNotThrow(() => {
        if (server.server.onerror) {
          server.server.onerror('string error' as never);
        }
      }, 'Should handle string errors');

      // Should handle object errors
      assert.doesNotThrow(() => {
        if (server.server.onerror) {
          server.server.onerror({ message: 'object error' } as never);
        }
      }, 'Should handle object errors');
    });
  });

  describe('Resources', () => {
    it('registers and handles internal://config resource', async () => {
      const server = await createMcpServer();
      const resourceName = 'config';
      // Access private property for testing
      // @ts-ignore
      const templates = server._registeredResourceTemplates;
      // @ts-ignore
      const resource = templates[resourceName];

      assert.ok(resource, 'Config resource should be registered');

      const uri = new URL('internal://config');
      // Use the actual internal handler name: readCallback
      const result = await resource.readCallback(uri);

      assert.ok(result.contents, 'Result should have contents');
      assert.strictEqual(result.contents.length, 1);
      assert.strictEqual(result.contents[0].mimeType, 'application/json');

      const configData = JSON.parse(result.contents[0].text);
      assert.ok(configData.server, 'Config should contain server info');
      assert.ok(configData.fetcher, 'Config should contain fetcher info');

      // Verify security measures
      if (configData.auth?.clientSecret) {
        assert.equal(
          configData.auth.clientSecret,
          '<REDACTED>',
          'Client secret should be redacted'
        );
      }
      if (configData.security?.apiKey) {
        assert.equal(
          configData.security.apiKey,
          '<REDACTED>',
          'API key should be redacted'
        );
      }
    });

    it('lists cached resources with title, URL-aware description, and size', async () => {
      const url = `https://example.com/listed-${Date.now()}`;
      const cacheKey = createCacheKey('markdown', url);
      assert.ok(cacheKey);
      set(
        cacheKey,
        JSON.stringify({
          markdown: '# Cached resource content',
          title: 'Listed',
        }),
        { title: 'Listed', url }
      );

      const urlHash = parseCacheKey(cacheKey)?.urlHash;
      assert.ok(urlHash, 'url hash should be generated');

      const server = await createMcpServer();
      const templates = (
        server as unknown as {
          _registeredResourceTemplates: Record<
            string,
            {
              resourceTemplate: {
                listCallback?: () => Promise<{
                  resources: Array<{
                    uri: string;
                    title?: string;
                    description: string;
                    size?: number;
                  }>;
                }>;
              };
            }
          >;
        }
      )._registeredResourceTemplates;

      const cachedContentTemplate = templates['cached-content'];
      assert.ok(cachedContentTemplate, 'cached-content template should exist');

      const listed =
        await cachedContentTemplate.resourceTemplate.listCallback?.();
      assert.ok(listed, 'list callback should return resources');

      const match = listed?.resources.find((resource) =>
        resource.uri.endsWith(`/markdown/${urlHash}`)
      );

      assert.ok(match, 'cached entry should be discoverable');
      assert.equal(match?.title, 'Listed');
      assert.match(
        String(match?.description),
        /https:\/\/example\.com\/listed-/
      );
      assert.equal(typeof match?.size, 'number');
      assert.ok((match?.size ?? 0) > 0);
    });
  });

  describe('Prompts', () => {
    it('registers get-help prompt', async () => {
      const server = await createMcpServer();
      // @ts-ignore Access private prompt registry for validation
      const prompts = server._registeredPrompts;
      const prompt = prompts?.['get-help'];

      assert.ok(prompt, 'get-help prompt should be registered');
      assert.equal(typeof prompt.callback, 'function');
    });

    it('registers bounded URL/instruction prompt schemas', async () => {
      const server = await createMcpServer();
      const prompts = (
        server as unknown as {
          _registeredPrompts?: Record<
            string,
            {
              argsSchema?: {
                def?: {
                  shape?: Record<
                    string,
                    { maxLength?: number; minLength?: number }
                  >;
                };
              };
            }
          >;
        }
      )._registeredPrompts;

      const summarizeArgs = prompts?.['summarize-page']?.argsSchema;
      const extractArgs = prompts?.['extract-data']?.argsSchema;

      assert.ok(summarizeArgs, 'summarize-page args schema should exist');
      assert.ok(extractArgs, 'extract-data args schema should exist');
      assert.equal(summarizeArgs?.def?.shape?.url?.maxLength, 2048);
      assert.equal(extractArgs?.def?.shape?.url?.maxLength, 2048);
      assert.equal(extractArgs?.def?.shape?.instruction?.minLength, 3);
      assert.equal(extractArgs?.def?.shape?.instruction?.maxLength, 1000);
    });
  });

  describe('Protocol handlers', () => {
    it('registers logging/setLevel request handling', async () => {
      const server = await createMcpServer();
      const requestHandlers = (
        server.server as unknown as {
          _requestHandlers: Map<string, unknown>;
        }
      )._requestHandlers;

      assert.ok(
        requestHandlers.has('logging/setLevel'),
        'logging/setLevel handler should be registered'
      );
    });

    it('registers notifications/cancelled handling', async () => {
      const server = await createMcpServer();
      const notificationHandlers = (
        server.server as unknown as {
          _notificationHandlers: Map<string, unknown>;
        }
      )._notificationHandlers;

      assert.ok(
        notificationHandlers.has('notifications/cancelled'),
        'notifications/cancelled handler should be registered'
      );
    });
  });
});
