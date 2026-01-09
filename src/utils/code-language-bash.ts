import { splitLines } from './code-language-parsing.js';

const BASH_PACKAGE_MANAGERS = [
  'npm',
  'yarn',
  'pnpm',
  'npx',
  'brew',
  'apt',
  'pip',
  'cargo',
  'go',
];

const BASH_VERBS = ['install', 'add', 'run', 'build', 'start'];
const BASH_COMMANDS = ['sudo', 'chmod', 'mkdir', 'cd', 'ls', 'cat', 'echo'];

export function detectBash(code: string): boolean {
  const lines = splitLines(code);
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;
    if (isBashIndicator(trimmed)) return true;
  }
  return false;
}

function startsWithCommand(line: string, commands: readonly string[]): boolean {
  return commands.some(
    (command) => line === command || line.startsWith(`${command} `)
  );
}

function isBashIndicator(line: string): boolean {
  return (
    isShebang(line) ||
    isPromptLine(line) ||
    startsWithCommand(line, BASH_COMMANDS) ||
    startsWithPackageManagerCommand(line)
  );
}

function isShebang(line: string): boolean {
  return line.startsWith('#!');
}

function isPromptLine(line: string): boolean {
  return line.startsWith('$ ') || line.startsWith('# ');
}

function startsWithPackageManagerCommand(line: string): boolean {
  return BASH_PACKAGE_MANAGERS.some((manager) => {
    if (!line.startsWith(`${manager} `)) return false;
    const rest = line.slice(manager.length + 1);
    return BASH_VERBS.some(
      (verb) => rest === verb || rest.startsWith(`${verb} `)
    );
  });
}
