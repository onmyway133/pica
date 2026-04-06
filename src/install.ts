import {
  mkdirSync, copyFileSync, symlinkSync, unlinkSync,
  existsSync, readFileSync, writeFileSync, readdirSync, statSync,
} from 'fs'
import { join, basename, dirname, resolve } from 'path'
import { homedir } from 'os'
import type { DetectedItem, InstallOptions, InstallResult } from './types.js'

const GLOBAL_BASE = join(homedir(), '.claude')
const LOCAL_BASE = join(process.cwd(), '.claude')

/** Subdirectory inside .claude/ for each item type */
const TYPE_SUBDIR: Record<DetectedItem['type'], string> = {
  agent: 'agents',
  skill: 'skills',
  command: 'commands',
  hook: 'hooks',
  rule: 'rules',
}

export async function installItems(
  items: DetectedItem[],
  options: InstallOptions
): Promise<InstallResult[]> {
  return Promise.all(items.map(item => installItem(item, options)))
}

async function installItem(item: DetectedItem, options: InstallOptions): Promise<InstallResult> {
  try {
    const dest = doInstall(item, options)
    return { item, dest, success: true }
  } catch (err) {
    return { item, dest: '', success: false, error: String(err) }
  }
}

function doInstall(item: DetectedItem, { scope, mode }: InstallOptions): string {
  const subdir = TYPE_SUBDIR[item.type]
  const base = scope === 'global' ? GLOBAL_BASE : LOCAL_BASE

  if (item.type === 'skill') {
    // item.path is SKILL.md — install the parent directory
    const skillDir = dirname(item.path)
    return installDir(skillDir, basename(skillDir), subdir, scope, mode)
  }

  if (item.type === 'hook') {
    // item.path is the hooks/ directory containing hooks.json + scripts
    return installHooks(item.path, base)
  }

  // Agents, commands, rules — single .md files
  return installFile(item.path, basename(item.path), subdir, scope, mode)
}

/**
 * Hooks need two things:
 *   1. Copy all script files to {base}/hooks/
 *   2. Merge the "hooks" block from hooks.json into {base}/settings.json,
 *      rewriting ${CLAUDE_PLUGIN_ROOT} to the actual installed hooks dir.
 */
function installHooks(srcHooksDir: string, base: string): string {
  const destHooksDir = join(base, 'hooks')
  ensureDir(destHooksDir)

  // Copy all files (scripts etc.), skip hooks.json itself
  for (const entry of readdirSync(srcHooksDir, { withFileTypes: true })) {
    if (entry.name === 'hooks.json' || entry.name.startsWith('.')) continue
    copyFileSync(join(srcHooksDir, entry.name), join(destHooksDir, entry.name))
    // Make shell scripts executable
    if (entry.name.endsWith('.sh')) {
      Bun.spawnSync(['chmod', '+x', join(destHooksDir, entry.name)])
    }
  }

  // Merge hooks config into settings.json
  const manifest = JSON.parse(readFileSync(join(srcHooksDir, 'hooks.json'), 'utf8'))
  const hooksConfig: Record<string, unknown[]> = manifest.hooks ?? {}

  const settingsPath = join(base, 'settings.json')
  const settings = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, 'utf8'))
    : {}
  if (!settings.hooks) settings.hooks = {}

  // Replace ${CLAUDE_PLUGIN_ROOT} with the actual base directory
  const configStr = JSON.stringify(hooksConfig).replaceAll('${CLAUDE_PLUGIN_ROOT}', base)
  const resolvedConfig: Record<string, unknown[]> = JSON.parse(configStr)

  for (const [event, handlers] of Object.entries(resolvedConfig)) {
    const existing: unknown[] = settings.hooks[event] ?? []
    settings.hooks[event] = [...existing, ...handlers]
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  return settingsPath
}

/**
 * Symlink strategy (mirrors the skills CLI pattern):
 *   copy  → ~/.claude/{subdir}/{name}   (canonical global store)
 *   link  → .claude/{subdir}/{name}     → ~/.claude/{subdir}/{name}
 *
 * Copy strategy:
 *   copy directly to the chosen scope (local or global)
 */
function installFile(
  src: string,
  name: string,
  subdir: string,
  scope: InstallOptions['scope'],
  mode: InstallOptions['mode']
): string {
  if (mode === 'symlink') {
    const globalDest = join(GLOBAL_BASE, subdir, name)
    ensureDir(dirname(globalDest))
    copyFileSync(src, globalDest)

    if (scope === 'local') {
      const localDest = join(LOCAL_BASE, subdir, name)
      ensureDir(dirname(localDest))
      createSymlink(globalDest, localDest)
      return localDest
    }
    return globalDest
  } else {
    const base = scope === 'global' ? GLOBAL_BASE : LOCAL_BASE
    const dest = join(base, subdir, name)
    ensureDir(dirname(dest))
    copyFileSync(src, dest)
    return dest
  }
}

function installDir(
  src: string,
  name: string,
  subdir: string,
  scope: InstallOptions['scope'],
  mode: InstallOptions['mode']
): string {
  if (mode === 'symlink') {
    const globalDest = join(GLOBAL_BASE, subdir, name)
    ensureDir(dirname(globalDest))
    copyDir(src, globalDest)

    if (scope === 'local') {
      const localDest = join(LOCAL_BASE, subdir, name)
      ensureDir(dirname(localDest))
      createSymlink(globalDest, localDest)
      return localDest
    }
    return globalDest
  } else {
    const base = scope === 'global' ? GLOBAL_BASE : LOCAL_BASE
    const dest = join(base, subdir, name)
    ensureDir(dirname(dest))
    copyDir(src, dest)
    return dest
  }
}

function createSymlink(target: string, linkPath: string): void {
  if (existsSync(linkPath)) unlinkSync(linkPath)
  try {
    symlinkSync(resolve(target), linkPath)
  } catch {
    // Fallback: copy if symlinks not supported (e.g. Windows)
    const s = statSync(target)
    if (s.isDirectory()) copyDir(target, linkPath)
    else copyFileSync(target, linkPath)
  }
}

function copyDir(src: string, dest: string): void {
  ensureDir(dest)
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}
