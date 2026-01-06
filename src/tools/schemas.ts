import { z } from 'zod';

export const fetchUrlInputSchema = z.strictObject({
  url: z.url({ protocol: /^https?$/i }).describe('The URL to fetch'),
});

export const fetchUrlOutputSchema = z.strictObject({
  url: z.string().describe('The fetched URL'),
  title: z.string().optional().describe('Page title'),
  markdown: z
    .string()
    .optional()
    .describe('The extracted content in Markdown format'),
  error: z.string().optional().describe('Error message if the request failed'),
});
