import {
  mkdirSync, copyFileSync, symlinkSync, unlinkSync,
  existsSync, readFileSync, writeFileSync, readdirSync, statSync,
} from 'fs'
import { join, basename, dirname, resolve } from 'path'
import { homedir } from 'os'
import type { DetectedItem, InstallOptions, InstallResult } from './types.js'

export interface Bases {
  global: string
  local: string
}

const DEFAULT_BASES: Bases = {
  global: join(homedir(), '.claude'),
  local: join(process.cwd(), '.claude'),
}

const TYPE_SUBDIR: Record<DetectedItem['type'], string> = {
  agent: 'agents',
  skill: 'skills',
  command: 'commands',
  hook: 'hooks',
  rule: 'rules',
}

export async function installItems(
  items: DetectedItem[],
  options: InstallOptions,
  bases: Bases = DEFAULT_BASES
): Promise<InstallResult[]> {
  return Promise.all(items.map(item => installItem(item, options, bases)))
}

async function installItem(
  item: DetectedItem,
  options: InstallOptions,
  bases: Bases
): Promise<InstallResult> {
  try {
    const dest = doInstall(item, options, bases)
    return { item, dest, success: true }
  } catch (err) {
    return { item, dest: '', success: false, error: String(err) }
  }
}

function doInstall(item: DetectedItem, { scope, mode }: InstallOptions, bases: Bases): string {
  const base = scope === 'global' ? bases.global : bases.local

  if (item.type === 'skill') {
    const skillDir = dirname(item.path)
    return installDir(skillDir, basename(skillDir), 'skills', scope, mode, bases)
  }

  if (item.type === 'hook') {
    return installHooks(item.path, base)
  }

  return installFile(item.path, basename(item.path), TYPE_SUBDIR[item.type], scope, mode, bases)
}

/**
 * Hooks:
 *   1. Copy script files to {base}/hooks/
 *   2. Merge "hooks" block from hooks.json into {base}/settings.json,
 *      replacing ${CLAUDE_PLUGIN_ROOT} with the real base path.
 */
export function installHooks(srcHooksDir: string, base: string): string {
  const destHooksDir = join(base, 'hooks')
  ensureDir(destHooksDir)

  for (const entry of readdirSync(srcHooksDir, { withFileTypes: true })) {
    if (entry.name === 'hooks.json' || entry.name.startsWith('.')) continue
    copyFileSync(join(srcHooksDir, entry.name), join(destHooksDir, entry.name))
    if (entry.name.endsWith('.sh')) {
      Bun.spawnSync(['chmod', '+x', join(destHooksDir, entry.name)])
    }
  }

  const manifest = JSON.parse(readFileSync(join(srcHooksDir, 'hooks.json'), 'utf8'))
  const hooksConfig: Record<string, unknown[]> = manifest.hooks ?? {}

  const settingsPath = join(base, 'settings.json')
  const settings = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, 'utf8'))
    : {}
  if (!settings.hooks) settings.hooks = {}

  const resolved: Record<string, unknown[]> = JSON.parse(
    JSON.stringify(hooksConfig).replaceAll('${CLAUDE_PLUGIN_ROOT}', base)
  )

  for (const [event, handlers] of Object.entries(resolved)) {
    settings.hooks[event] = [...(settings.hooks[event] ?? []), ...handlers]
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  return settingsPath
}

/**
 * Symlink: copy to global, symlink local → global
 * Copy: write directly to chosen scope
 */
function installFile(
  src: string,
  name: string,
  subdir: string,
  scope: InstallOptions['scope'],
  mode: InstallOptions['mode'],
  bases: Bases
): string {
  if (mode === 'symlink') {
    const globalDest = join(bases.global, subdir, name)
    ensureDir(dirname(globalDest))
    copyFileSync(src, globalDest)

    if (scope === 'local') {
      const localDest = join(bases.local, subdir, name)
      ensureDir(dirname(localDest))
      createSymlink(globalDest, localDest)
      return localDest
    }
    return globalDest
  }

  const dest = join(scope === 'global' ? bases.global : bases.local, subdir, name)
  ensureDir(dirname(dest))
  copyFileSync(src, dest)
  return dest
}

function installDir(
  src: string,
  name: string,
  subdir: string,
  scope: InstallOptions['scope'],
  mode: InstallOptions['mode'],
  bases: Bases
): string {
  if (mode === 'symlink') {
    const globalDest = join(bases.global, subdir, name)
    ensureDir(dirname(globalDest))
    copyDir(src, globalDest)

    if (scope === 'local') {
      const localDest = join(bases.local, subdir, name)
      ensureDir(dirname(localDest))
      createSymlink(globalDest, localDest)
      return localDest
    }
    return globalDest
  }

  const dest = join(scope === 'global' ? bases.global : bases.local, subdir, name)
  ensureDir(dirname(dest))
  copyDir(src, dest)
  return dest
}

function createSymlink(target: string, linkPath: string): void {
  if (existsSync(linkPath)) unlinkSync(linkPath)
  try {
    symlinkSync(resolve(target), linkPath)
  } catch {
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
    entry.isDirectory() ? copyDir(srcPath, destPath) : copyFileSync(srcPath, destPath)
  }
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}
