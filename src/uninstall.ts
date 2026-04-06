import {
  existsSync, rmSync, readFileSync, writeFileSync, readdirSync, lstatSync,
} from 'fs'
import { join, basename, dirname } from 'path'
import { homedir } from 'os'
import type { Bases } from './install.js'
import type { DetectedItem, InstallScope } from './types.js'

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

export interface UninstallResult {
  item: DetectedItem
  removed: string[]
  success: boolean
  error?: string
}

export async function uninstallItems(
  items: DetectedItem[],
  scope: InstallScope,
  bases: Bases = DEFAULT_BASES
): Promise<UninstallResult[]> {
  return Promise.all(items.map(item => uninstallItem(item, scope, bases)))
}

async function uninstallItem(
  item: DetectedItem,
  scope: InstallScope,
  bases: Bases
): Promise<UninstallResult> {
  try {
    const removed = doUninstall(item, scope, bases)
    return { item, removed, success: true }
  } catch (err) {
    return { item, removed: [], success: false, error: String(err) }
  }
}

function doUninstall(item: DetectedItem, scope: InstallScope, bases: Bases): string[] {
  if (item.type === 'hook') return uninstallHook(item, scope, bases)
  if (item.type === 'skill') return uninstallDir(item, scope, bases)
  return uninstallFile(item, scope, bases)
}

/** Agents, commands, rules — single .md files */
function uninstallFile(item: DetectedItem, scope: InstallScope, bases: Bases): string[] {
  const name = basename(item.path)
  const subdir = TYPE_SUBDIR[item.type]
  const removed: string[] = []

  // local scope tries both — symlink mode writes to both
  const targets = scope === 'local'
    ? [join(bases.local, subdir, name), join(bases.global, subdir, name)]
    : [join(bases.global, subdir, name)]

  for (const t of targets) {
    if (existsSync(t)) { rmSync(t); removed.push(t) }
  }
  return removed
}

/** Skills — directories */
function uninstallDir(item: DetectedItem, scope: InstallScope, bases: Bases): string[] {
  const name = basename(dirname(item.path))  // parent of SKILL.md
  const removed: string[] = []

  const targets = scope === 'local'
    ? [join(bases.local, 'skills', name), join(bases.global, 'skills', name)]
    : [join(bases.global, 'skills', name)]

  for (const t of targets) {
    if (existsSync(t)) {
      const stat = lstatSync(t)
      rmSync(t, stat.isSymbolicLink() ? undefined : { recursive: true })
      removed.push(t)
    }
  }
  return removed
}

/**
 * Hooks — two steps:
 *   1. Delete script files from {base}/hooks/
 *   2. Remove matching entries from {base}/settings.json
 */
export function uninstallHook(item: DetectedItem, scope: InstallScope, bases: Bases): string[] {
  const base = scope === 'global' ? bases.global : bases.local
  const srcHooksDir = item.path
  const manifestPath = join(srcHooksDir, 'hooks.json')
  const removed: string[] = []

  for (const f of readdirSync(srcHooksDir)) {
    if (f === 'hooks.json' || f.startsWith('.')) continue
    const dest = join(base, 'hooks', f)
    if (existsSync(dest)) { rmSync(dest); removed.push(dest) }
  }

  const settingsPath = join(base, 'settings.json')
  if (!existsSync(settingsPath) || !existsSync(manifestPath)) return removed

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const hooksConfig: Record<string, unknown[]> = manifest.hooks ?? {}
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    if (!settings.hooks) return removed

    for (const [event, handlers] of Object.entries(hooksConfig)) {
      if (!settings.hooks[event]) continue
      const manifestCmds = extractCommands(handlers, base)
      settings.hooks[event] = (settings.hooks[event] as unknown[]).filter(h =>
        !extractCommands([h], base).some(c => manifestCmds.includes(c))
      )
      if ((settings.hooks[event] as unknown[]).length === 0) delete settings.hooks[event]
    }

    if (Object.keys(settings.hooks).length === 0) delete settings.hooks
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    removed.push(`${settingsPath}  (hook entries removed)`)
  } catch {
    // best effort
  }

  return removed
}

function extractCommands(handlers: unknown[], base: string): string[] {
  const parsed = JSON.parse(
    JSON.stringify(handlers).replaceAll('${CLAUDE_PLUGIN_ROOT}', base)
  ) as unknown[]
  const cmds: string[] = []

  function walk(obj: unknown): void {
    if (!obj || typeof obj !== 'object') return
    const rec = obj as Record<string, unknown>
    if (typeof rec.command === 'string') cmds.push(rec.command)
    for (const v of Object.values(rec)) {
      Array.isArray(v) ? v.forEach(walk) : walk(v)
    }
  }

  parsed.forEach(walk)
  return cmds
}

/** Returns items that appear to be installed (checked against both local and global) */
export function filterInstalled(items: DetectedItem[], bases: Bases = DEFAULT_BASES): DetectedItem[] {
  return items.filter(item => {
    if (item.type === 'skill') {
      const name = basename(dirname(item.path))
      return existsSync(join(bases.local, 'skills', name)) ||
             existsSync(join(bases.global, 'skills', name))
    }
    if (item.type === 'hook') {
      return existsSync(join(bases.local, 'settings.json')) ||
             existsSync(join(bases.global, 'settings.json'))
    }
    const name = basename(item.path)
    const subdir = TYPE_SUBDIR[item.type]
    return existsSync(join(bases.local, subdir, name)) ||
           existsSync(join(bases.global, subdir, name))
  })
}
