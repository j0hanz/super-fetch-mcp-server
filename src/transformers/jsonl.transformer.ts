import { config } from '../config/index.js';
import type { ContentBlockUnion, MetadataBlock } from '../config/types.js';

import { truncateText } from '../utils/sanitizer.js';

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

function serializeBlock(block: ContentBlockUnion): string | null {
  try {
    return JSON.stringify(truncateBlock(block));
  } catch {
    return null;
  }
}

export function toJsonl(
  blocks: readonly ContentBlockUnion[],
  metadata?: MetadataBlock
): string {
  const lines: string[] = [];

  if (metadata) {
    try {
      const minimalMetadata = {
        type: metadata.type,
        title: metadata.title,
        url: metadata.url,
      };
      lines.push(JSON.stringify(minimalMetadata));
    } catch {
      /* skip */
    }
  }

  for (const block of blocks) {
    const serialized = serializeBlock(block);
    if (serialized) {
      lines.push(serialized);
    }
  }

  return lines.join('\n');
}
