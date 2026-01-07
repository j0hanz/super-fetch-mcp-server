import { logDebug } from '../services/logger.js';

export interface TransformResult {
  readonly url: string;
  readonly transformed: boolean;
  readonly platform?: string;
}

interface TransformRule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly transform: (match: RegExpExecArray) => string;
}

const GITHUB_BLOB_RULE: TransformRule = {
  name: 'github',
  pattern:
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i,
  transform: (match) => {
    const owner = match[1] ?? '';
    const repo = match[2] ?? '';
    const branch = match[3] ?? '';
    const path = match[4] ?? '';
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  },
};

const GITHUB_GIST_RULE: TransformRule = {
  name: 'github-gist',
  pattern:
    /^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)(?:#file-(.+)|\/raw\/([^/]+))?$/i,
  transform: (match) => {
    const user = match[1] ?? '';
    const gistId = match[2] ?? '';
    const hashFile = match[3];
    const rawFile = match[4];
    const filename = rawFile ?? hashFile?.replace(/-/g, '.');
    const filePath = filename ? `/${filename}` : '';
    return `https://gist.githubusercontent.com/${user}/${gistId}/raw${filePath}`;
  },
};

const GITLAB_BLOB_RULE: TransformRule = {
  name: 'gitlab',
  pattern:
    /^(https?:\/\/(?:[^/]+\.)?gitlab\.com\/[^/]+\/[^/]+)\/-\/blob\/([^/]+)\/(.+)$/i,
  transform: (match) => {
    const baseUrl = match[1] ?? '';
    const branch = match[2] ?? '';
    const path = match[3] ?? '';
    return `${baseUrl}/-/raw/${branch}/${path}`;
  },
};

const BITBUCKET_SRC_RULE: TransformRule = {
  name: 'bitbucket',
  pattern:
    /^(https?:\/\/(?:www\.)?bitbucket\.org\/[^/]+\/[^/]+)\/src\/([^/]+)\/(.+)$/i,
  transform: (match) => {
    const baseUrl = match[1] ?? '';
    const branch = match[2] ?? '';
    const path = match[3] ?? '';
    return `${baseUrl}/raw/${branch}/${path}`;
  },
};

const TRANSFORM_RULES: readonly TransformRule[] = [
  GITHUB_BLOB_RULE,
  GITHUB_GIST_RULE,
  GITLAB_BLOB_RULE,
  BITBUCKET_SRC_RULE,
];

function isRawUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return (
    lowerUrl.includes('raw.githubusercontent.com') ||
    lowerUrl.includes('gist.githubusercontent.com') ||
    lowerUrl.includes('/-/raw/') ||
    /bitbucket\.org\/[^/]+\/[^/]+\/raw\//.test(lowerUrl)
  );
}

function getUrlWithoutParams(url: string): {
  base: string;
  hash: string;
} {
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  let endIndex = url.length;
  if (queryIndex !== -1) {
    if (hashIndex !== -1) {
      endIndex = Math.min(queryIndex, hashIndex);
    } else {
      endIndex = queryIndex;
    }
  } else if (hashIndex !== -1) {
    endIndex = hashIndex;
  }

  const hash = hashIndex !== -1 ? url.slice(hashIndex) : '';

  return {
    base: url.slice(0, endIndex),
    hash,
  };
}

function resolveUrlToMatch(
  rule: TransformRule,
  base: string,
  hash: string
): string {
  if (rule.name !== 'github-gist') return base;
  if (!hash.startsWith('#file-')) return base;
  return base + hash;
}

function applyTransformRules(
  base: string,
  hash: string
): { url: string; platform: string } | null {
  for (const rule of TRANSFORM_RULES) {
    const urlToMatch = resolveUrlToMatch(rule, base, hash);

    const match = rule.pattern.exec(urlToMatch);
    if (match) {
      return { url: rule.transform(match), platform: rule.name };
    }
  }

  return null;
}

export function transformToRawUrl(url: string): TransformResult {
  if (!url) return { url, transformed: false };
  if (isRawUrl(url)) {
    return { url, transformed: false };
  }

  const { base, hash } = getUrlWithoutParams(url);
  const result = applyTransformRules(base, hash);
  if (!result) return { url, transformed: false };

  logDebug('URL transformed to raw content URL', {
    platform: result.platform,
    original: url.substring(0, 100),
    transformed: result.url.substring(0, 100),
  });
  return {
    url: result.url,
    transformed: true,
    platform: result.platform,
  };
}

const RAW_TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  '.rst',
  '.adoc',
  '.org',
]);

export function isRawTextContentUrl(url: string): boolean {
  if (!url) return false;
  if (isRawUrl(url)) return true;

  const { base } = getUrlWithoutParams(url);
  const lowerBase = base.toLowerCase();

  return hasKnownRawTextExtension(lowerBase);
}

function hasKnownRawTextExtension(urlBaseLower: string): boolean {
  for (const ext of RAW_TEXT_EXTENSIONS) {
    if (urlBaseLower.endsWith(ext)) return true;
  }
  return false;
}
