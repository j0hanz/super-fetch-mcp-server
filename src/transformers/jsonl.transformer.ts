import { config } from '../config/index.js';
import type { ContentBlockUnion, MetadataBlock } from '../config/types.js';

import { truncateText } from '../utils/sanitizer.js';

/**
 * Truncates text content within a content block to configured maximum length.
 * Returns original block unchanged if no truncation needed.
 */
function truncateBlock(block: ContentBlockUnion): ContentBlockUnion {
  const maxLength = config.extraction.maxBlockLength;

  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'code':
    case 'blockquote': {
      const truncated = truncateText(block.text, maxLength);
      return truncated === block.text ? block : { ...block, text: truncated };
    }

    case 'list': {
      const truncatedItems = block.items.map((item) =>
        truncateText(item, maxLength)
      );
      const hasChanges = truncatedItems.some(
        (item, index) => item !== block.items[index]
      );
      return hasChanges ? { ...block, items: truncatedItems } : block;
    }

    default:
      return block;
  }
}

/**
 * Serializes a single block to JSON, returning null on serialization failure.
 */
function serializeBlock(block: ContentBlockUnion): string | null {
  try {
    return JSON.stringify(truncateBlock(block));
  } catch {
    return null;
  }
}

/**
 * Transforms content blocks into JSONL (JSON Lines) format.
 * Each line contains a single JSON object representing a content block.
 *
 * @param blocks - Array of parsed content blocks
 * @param metadata - Optional metadata block to prepend
 * @returns JSONL string with one block per line
 */
export function toJsonl(
  blocks: readonly ContentBlockUnion[],
  metadata?: MetadataBlock
): string {
  const lines: string[] = [];

  // Add minimal metadata (title and URL for context)
  if (metadata) {
    try {
      const minimalMetadata = {
        type: metadata.type,
        title: metadata.title,
        url: metadata.url,
      };
      lines.push(JSON.stringify(minimalMetadata));
    } catch {
      // Skip invalid metadata
    }
  }

  // Serialize each content block
  for (const block of blocks) {
    const serialized = serializeBlock(block);
    if (serialized) {
      lines.push(serialized);
    }
  }

  return lines.join('\n');
}
