import TurndownService from 'turndown';

import { addFencedCodeRule } from './fenced-code-rule.js';
import { addNoiseRule } from './noise-rule.js';

let turndownInstance: TurndownService | null = null;

function createTurndownInstance(): TurndownService {
  const instance = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    bulletListMarker: '-',
  });
  addNoiseRule(instance);
  addFencedCodeRule(instance);
  return instance;
}

export function getTurndown(): TurndownService {
  turndownInstance ??= createTurndownInstance();
  return turndownInstance;
}
