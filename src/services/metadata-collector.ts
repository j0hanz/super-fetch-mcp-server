import type { ExtractedMetadata } from '../config/types/content.js';

type MetaSource = 'og' | 'twitter' | 'standard';
type MetaField = keyof ExtractedMetadata;

interface MetaCollectorState {
  title: Partial<Record<MetaSource, string>>;
  description: Partial<Record<MetaSource, string>>;
  author: Partial<Record<MetaSource, string>>;
}

function createMetaCollectorState(): MetaCollectorState {
  return {
    title: {},
    description: {},
    author: {},
  };
}

function resolveMetaField(
  state: MetaCollectorState,
  field: MetaField
): string | undefined {
  const sources = state[field];
  return sources.og ?? sources.twitter ?? sources.standard;
}

type ParsedMetaKey = 'title' | 'description' | 'author';

function parseOpenGraphKey(
  property: string | null
): Exclude<ParsedMetaKey, 'author'> | null {
  if (!property?.startsWith('og:')) return null;
  const key = property.replace('og:', '');
  return key === 'title' || key === 'description' ? key : null;
}

function parseTwitterKey(
  name: string | null
): Exclude<ParsedMetaKey, 'author'> | null {
  if (!name?.startsWith('twitter:')) return null;
  const key = name.replace('twitter:', '');
  return key === 'title' || key === 'description' ? key : null;
}

function parseStandardKey(name: string | null): ParsedMetaKey | null {
  if (name === 'description') return 'description';
  if (name === 'author') return 'author';
  return null;
}

function collectMetaTag(state: MetaCollectorState, tag: HTMLMetaElement): void {
  const content = tag.getAttribute('content')?.trim();
  if (!content) return;

  const ogKey = parseOpenGraphKey(tag.getAttribute('property'));
  if (ogKey) {
    state[ogKey].og = content;
    return;
  }

  const name = tag.getAttribute('name');
  const twitterKey = parseTwitterKey(name);
  if (twitterKey) {
    state[twitterKey].twitter = content;
    return;
  }

  const standardKey = parseStandardKey(name);
  if (standardKey) {
    state[standardKey].standard = content;
  }
}

function scanMetaTags(document: Document, state: MetaCollectorState): void {
  const metaTags = document.querySelectorAll('meta');
  for (const tag of metaTags) {
    collectMetaTag(state, tag);
  }
}

function ensureTitleFallback(
  document: Document,
  state: MetaCollectorState
): void {
  if (state.title.standard) return;
  const titleEl = document.querySelector('title');
  if (titleEl?.textContent) {
    state.title.standard = titleEl.textContent.trim();
  }
}

export function extractMetadata(document: Document): ExtractedMetadata {
  const state = createMetaCollectorState();

  scanMetaTags(document, state);
  ensureTitleFallback(document, state);

  const metadata: ExtractedMetadata = {};
  const title = resolveMetaField(state, 'title');
  const description = resolveMetaField(state, 'description');
  const author = resolveMetaField(state, 'author');

  if (title !== undefined) metadata.title = title;
  if (description !== undefined) metadata.description = description;
  if (author !== undefined) metadata.author = author;

  return metadata;
}
