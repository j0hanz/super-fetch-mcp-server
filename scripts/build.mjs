/* eslint-disable */
import { spawn } from 'node:child_process';
import { access, chmod, copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

// --- Configuration (Single Source of Truth) ---
const CONFIG = {
  paths: {
    dist: 'dist',
    assets: 'assets',
    distAssets: 'dist/assets',
    instructions: 'src/instructions.md',
    distInstructions: 'dist/instructions.md',
    executable: 'dist/index.js',
    tsBuildInfo: [
      '.tsbuildinfo',
      'tsconfig.tsbuildinfo',
      'tsconfig.build.tsbuildinfo',
      'tsconfig.test.tsbuildinfo',
    ],
  },
  commands: {
    tsc: 'npx tsc -p tsconfig.build.json',
  },
};

// --- Infrastructure Layer (IO & System) ---
const Logger = {
  startGroup: (name) => process.stdout.write(`> ${name}... `),
  endGroupSuccess: (duration) => console.log(`✅ (${duration}s)`),
  endGroupFail: () => console.log(`❌`),
  logShellSuccess: (name, duration) =>
    console.log(`> ${name} ✅ (${duration}s)`),
  logShellFail: (name, code) => console.log(`> ${name} ❌ (exit code ${code})`),
  info: (msg) => console.log(msg),
  error: (err) => console.error(err),
  newLine: () => console.log(),
};

const System = {
  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  async remove(paths) {
    const targets = Array.isArray(paths) ? paths : [paths];
    await Promise.all(
      targets.map((p) => rm(p, { recursive: true, force: true }))
    );
  },
  async copy(src, dest, opts = {}) {
    await cp(src, dest, opts);
  },
  async makeDir(path) {
    await mkdir(path, { recursive: true });
  },
  async changeMode(path, mode) {
    await chmod(path, mode);
  },
  async exec(command, args = []) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: 'inherit', shell: true });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Command failed: ${code}`));
      });
    });
  },
};

// --- Domain Layer (Build Actions) ---
const BuildTasks = {
  async clean() {
    await System.remove(CONFIG.paths.dist);
    await System.remove(CONFIG.paths.tsBuildInfo);
  },

  async compile() {
    await System.exec(CONFIG.commands.tsc);
  },

  async validate() {
    if (!(await System.exists(CONFIG.paths.instructions))) {
      throw new Error(`Missing ${CONFIG.paths.instructions}`);
    }
  },

  async assets() {
    const { rootDir = process.cwd() } = {};
    await System.makeDir(CONFIG.paths.dist);
    await System.copy(CONFIG.paths.instructions, CONFIG.paths.distInstructions);

    const assetsPath = join(rootDir, CONFIG.paths.assets);
    if (await System.exists(assetsPath)) {
      await System.copy(assetsPath, join(rootDir, CONFIG.paths.distAssets), {
        recursive: true,
      });
    }
  },

  async makeExecutable() {
    await System.changeMode(CONFIG.paths.executable, '755');
  },
};

// --- Application Layer (Task Running & Orchestration) ---
class Runner {
  static async runTask(name, fn) {
    Logger.startGroup(name);
    const start = performance.now();
    try {
      await fn();
      const duration = ((performance.now() - start) / 1000).toFixed(2);
      Logger.endGroupSuccess(duration);
    } catch (error) {
      Logger.endGroupFail();
      throw error; // Re-throw to be caught by top-level
    }
  }

  static async runShellTask(name, fn) {
    Logger.startGroup(name);
    Logger.newLine();
    const start = performance.now();
    try {
      await fn(); // execs with stdio inherit
      const duration = ((performance.now() - start) / 1000).toFixed(2);
      Logger.logShellSuccess(name, duration);
    } catch (error) {
      // System.exec throws on non-zero exit
      throw error;
    }
  }
}

const Pipeline = {
  async fullBuild() {
    Logger.info('🚀 Starting build...');
    const startTotal = performance.now();

    await Runner.runTask('Cleaning dist', BuildTasks.clean);
    await Runner.runShellTask('Compiling TypeScript', BuildTasks.compile);
    await Runner.runTask('Validating instructions', BuildTasks.validate);
    await Runner.runTask('Copying assets', BuildTasks.assets);
    await Runner.runTask('Making executable', BuildTasks.makeExecutable);

    const durationTotal = ((performance.now() - startTotal) / 1000).toFixed(2);
    Logger.info(`\n✨ Build completed in ${durationTotal}s`);
  },
};

// --- Interface Layer (CLI) ---
const CLI = {
  routes: {
    clean: () => Runner.runTask('Cleaning', BuildTasks.clean),
    'copy:assets': () => Runner.runTask('Copying assets', BuildTasks.assets),
    'validate:instructions': () =>
      Runner.runTask('Validating instructions', BuildTasks.validate),
    'make-executable': () =>
      Runner.runTask('Making executable', BuildTasks.makeExecutable),
    build: Pipeline.fullBuild,
  },

  async main(args) {
    const taskName = args[2] || 'build';
    const action = this.routes[taskName];

    if (!action) {
      Logger.error(`Unknown task: ${taskName}`);
      Logger.error(`Available tasks: ${Object.keys(this.routes).join(', ')}`);
      process.exit(1);
    }

    try {
      await action();
    } catch (err) {
      Logger.error(err);
      process.exit(1);
    }
  },
};

CLI.main(process.argv);
