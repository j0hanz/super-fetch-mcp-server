export const config = {
  server: {
    name: 'superFetch',
    version: '1.0.0',
    port: process.env.PORT ? parseInt(process.env.PORT, 10) || 3000 : 3000,
    host: process.env.HOST ?? '127.0.0.1',
  },
  fetcher: {
    timeout: 30000,
    maxRedirects: 5,
    userAgent: 'superFetch-MCP/1.0',
    maxContentLength: 10485760,
  },
  cache: {
    enabled: process.env.CACHE_ENABLED !== 'false',
    ttl: 3600,
    maxKeys: 100,
  },
  extraction: {
    extractMainContent: true,
    includeMetadata: true,
    maxBlockLength: 5000,
    minParagraphLength: 10,
  },
  logging: {
    level: process.env.LOG_LEVEL ?? 'info',
    enabled: process.env.ENABLE_LOGGING !== 'false',
  },
  constants: {
    maxHtmlSize: 10 * 1024 * 1024,
    maxContentSize: 5 * 1024 * 1024,
    maxUrlLength: 2048,
  },
} as const;
