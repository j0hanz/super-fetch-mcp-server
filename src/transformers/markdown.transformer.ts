import type { MetadataBlock } from '../config/types/content.js';

import { buildFrontmatter } from './markdown/frontmatter.js';
import { getTurndown } from './markdown/turndown-instance.js';

export function htmlToMarkdown(html: string, metadata?: MetadataBlock): string {
  const frontmatter = buildFrontmatter(metadata);
  if (!html) return frontmatter;

  try {
    const content = getTurndown().turndown(html).trim();
    return frontmatter ? `${frontmatter}\n${content}` : content;
  } catch {
    return frontmatter;
  }
}
