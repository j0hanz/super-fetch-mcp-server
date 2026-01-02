import { z } from 'zod';

import { config } from '../config/index.js';

const MAX_HEADER_NAME_LENGTH = 128;
const MAX_HEADER_VALUE_LENGTH = 2048;
const MAX_HEADER_COUNT = 50;
const MAX_CONTENT_LENGTH = config.constants.maxContentSize;

const customHeadersSchema = z
  .record(
    z.string().max(MAX_HEADER_NAME_LENGTH),
    z.string().max(MAX_HEADER_VALUE_LENGTH)
  )
  .refine((headers) => Object.keys(headers).length <= MAX_HEADER_COUNT, {
    error: `customHeaders must have at most ${MAX_HEADER_COUNT} entries`,
  });

const requestOptionsSchema = z.object({
  customHeaders: customHeadersSchema
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
    .max(MAX_CONTENT_LENGTH)
    .optional()
    .describe('Maximum content length in characters'),
});

const formatOptionsSchema = z.object({
  format: z
    .enum(['jsonl', 'markdown'])
    .default('jsonl')
    .describe('Output format'),
  includeContentBlocks: z
    .boolean()
    .optional()
    .describe('Include content block counts when format=markdown'),
});

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

const fileDownloadSchema = z.object({
  downloadUrl: z.string().describe('Relative URL to download the .md file'),
  fileName: z.string().describe('Suggested filename for download'),
  expiresAt: z.string().describe('ISO timestamp when download expires'),
});

export const fetchUrlInputSchema = z.strictObject({
  ...requestOptionsSchema.shape,
  url: z.url({ protocol: /^https?:$/i }).describe('The URL to fetch'),
  ...extractionOptionsSchema.shape,
  ...formatOptionsSchema.shape,
});

export const fetchMarkdownInputSchema = z.strictObject({
  ...requestOptionsSchema.shape,
  url: z.url({ protocol: /^https?:$/i }).describe('The URL to fetch'),
  ...extractionOptionsSchema.shape,
});

export const fetchUrlOutputSchema = z.strictObject({
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
  ...resourceFieldsSchema.shape,
});

export const fetchMarkdownOutputSchema = z.strictObject({
  url: z.string().describe('The fetched URL'),
  title: z.string().optional().describe('Page title'),
  fetchedAt: z
    .string()
    .describe('ISO timestamp of when the content was fetched'),
  markdown: z
    .string()
    .optional()
    .describe('The extracted content in Markdown format'),
  file: fileDownloadSchema
    .optional()
    .describe('Download information when content is cached'),
  ...resourceFieldsSchema.shape,
});
