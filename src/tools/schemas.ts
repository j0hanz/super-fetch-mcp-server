import { z } from 'zod';

import { config } from '../config/index.js';

const requestOptionsSchema = z.object({
  customHeaders: z
    .record(z.string())
    .optional()
    .describe('Custom HTTP headers for the request'),
  timeout: z
    .number()
    .min(1000)
    .max(120000)
    .default(config.fetcher.timeout)
    .describe('Request timeout in milliseconds (1000-120000)'),
  retries: z
    .number()
    .min(1)
    .max(10)
    .default(3)
    .describe('Number of retry attempts (1-10)'),
});

const extractionOptionsSchema = z.object({
  extractMainContent: z
    .boolean()
    .default(true)
    .describe('Use Readability to extract main article content'),
  includeMetadata: z
    .boolean()
    .default(true)
    .describe('Include page metadata (title, description, etc.)'),
  maxContentLength: z
    .number()
    .positive()
    .optional()
    .describe('Maximum content length in characters'),
});

const formatOptionsSchema = z.object({
  format: z
    .enum(['jsonl', 'markdown'])
    .default('jsonl')
    .describe('Output format'),
});

const linkEntrySchema = z
  .object({
    href: z.string().describe('The link URL'),
    text: z.string().describe('The link anchor text'),
    type: z.enum(['internal', 'external', 'image']).describe('Link type'),
  })
  .strict();

const resourceFieldsSchema = z.object({
  contentSize: z.number().optional().describe('Content length in characters'),
  resourceUri: z
    .string()
    .optional()
    .describe('Resource URI when content is too large to inline'),
  resourceMimeType: z
    .string()
    .optional()
    .describe('MIME type for the resource URI'),
  cached: z.boolean().describe('Whether the result was served from cache'),
  truncated: z
    .boolean()
    .optional()
    .describe('Whether content was truncated by maxContentLength'),
  error: z.string().optional().describe('Error message if the request failed'),
  errorCode: z.string().optional().describe('Error code if the request failed'),
});

const batchResourceFieldsSchema = resourceFieldsSchema.extend({
  cached: z.boolean().optional().describe('Whether served from cache'),
});

const batchResultSchema = z
  .object({
    url: z.string().describe('The fetched URL'),
    success: z.boolean().describe('Whether the fetch was successful'),
    title: z.string().optional().describe('Page title'),
    content: z.string().optional().describe('The extracted content'),
    contentBlocks: z
      .number()
      .optional()
      .describe('Number of content blocks (JSONL only)'),
  })
  .merge(batchResourceFieldsSchema)
  .strict();

export const fetchUrlInputSchema = requestOptionsSchema
  .extend({
    url: z.string().min(1).describe('The URL to fetch'),
  })
  .merge(extractionOptionsSchema)
  .merge(formatOptionsSchema)
  .strict();

export const fetchLinksInputSchema = requestOptionsSchema
  .extend({
    url: z.string().min(1).describe('The URL to extract links from'),
    includeExternal: z
      .boolean()
      .default(true)
      .describe('Include external links'),
    includeInternal: z
      .boolean()
      .default(true)
      .describe('Include internal links'),
    maxLinks: z
      .number()
      .positive()
      .max(1000)
      .optional()
      .describe('Maximum number of links to return (1-1000)'),
    filterPattern: z
      .string()
      .optional()
      .describe('Regex pattern to filter links (matches against href)'),
    includeImages: z
      .boolean()
      .default(false)
      .describe('Include image links (img src attributes)'),
  })
  .strict();

export const fetchMarkdownInputSchema = requestOptionsSchema
  .extend({
    url: z.string().min(1).describe('The URL to fetch'),
  })
  .merge(extractionOptionsSchema)
  .strict();

export const fetchUrlsInputSchema = requestOptionsSchema
  .extend({
    urls: z
      .array(z.string().min(1))
      .min(1)
      .max(10)
      .describe('Array of URLs to fetch (1-10 URLs)'),
    format: z
      .enum(['jsonl', 'markdown'])
      .default('jsonl')
      .describe('Output format for all URLs'),
    concurrency: z
      .number()
      .min(1)
      .max(5)
      .default(3)
      .describe('Maximum concurrent requests (1-5)'),
    continueOnError: z
      .boolean()
      .default(true)
      .describe('Continue processing if some URLs fail'),
  })
  .merge(extractionOptionsSchema)
  .strict();

export const fetchUrlOutputSchema = z
  .object({
    url: z.string().describe('The fetched URL'),
    title: z.string().optional().describe('Page title'),
    contentBlocks: z
      .number()
      .describe('Number of content blocks extracted (JSONL only)'),
    fetchedAt: z
      .string()
      .describe('ISO timestamp of when the content was fetched'),
    format: z.enum(['jsonl', 'markdown']).describe('Output format used'),
    content: z
      .string()
      .optional()
      .describe('The extracted content in JSONL or Markdown format'),
  })
  .merge(resourceFieldsSchema)
  .strict();

export const fetchLinksOutputSchema = z
  .object({
    url: z.string().describe('The source URL'),
    linkCount: z.number().describe('Total number of links extracted'),
    links: z.array(linkEntrySchema).describe('Array of extracted links'),
    filtered: z
      .number()
      .optional()
      .describe('Number of links filtered out by pattern'),
    truncated: z
      .boolean()
      .optional()
      .describe('Whether results were truncated by maxLinks'),
    error: z
      .string()
      .optional()
      .describe('Error message if the request failed'),
    errorCode: z
      .string()
      .optional()
      .describe('Error code if the request failed'),
  })
  .strict();

export const fetchMarkdownOutputSchema = z
  .object({
    url: z.string().describe('The fetched URL'),
    title: z.string().optional().describe('Page title'),
    fetchedAt: z
      .string()
      .describe('ISO timestamp of when the content was fetched'),
    markdown: z
      .string()
      .optional()
      .describe('The extracted content in Markdown format'),
  })
  .merge(resourceFieldsSchema)
  .strict();

export const fetchUrlsOutputSchema = z
  .object({
    results: z
      .array(batchResultSchema)
      .describe('Array of results for each URL'),
    summary: z
      .object({
        total: z.number().describe('Total URLs processed'),
        successful: z.number().describe('Number of successful fetches'),
        failed: z.number().describe('Number of failed fetches'),
        cached: z.number().describe('Number served from cache'),
        totalContentBlocks: z
          .number()
          .describe('Total content blocks extracted'),
      })
      .strict()
      .describe('Summary statistics'),
    fetchedAt: z.string().describe('ISO timestamp of batch completion'),
  })
  .strict();
