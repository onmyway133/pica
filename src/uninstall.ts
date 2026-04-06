import {
  existsSync, rmSync, readFileSync, writeFileSync, readdirSync, lstatSync,
} from 'fs'
import { join, basename, dirname } from 'path'
import { homedir } from 'os'
import type { DetectedItem, InstallScope } from './types.js'

const GLOBAL_BASE = join(homedir(), '.claude')
const LOCAL_BASE = join(process.cwd(), '.claude')

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
  scope: InstallScope
): Promise<UninstallResult[]> {
  return Promise.all(items.map(item => uninstallItem(item, scope)))
}

async function uninstallItem(item: DetectedItem, scope: InstallScope): Promise<UninstallResult> {
  try {
    const removed = doUninstall(item, scope)
    return { item, removed, success: true }
  } catch (err) {
    return { item, removed: [], success: false, error: String(err) }
  }
}

function doUninstall(item: DetectedItem, scope: InstallScope): string[] {
  if (item.type === 'hook') return uninstallHook(item, scope)
  if (item.type === 'skill') return uninstallDir(item, scope)
  return uninstallFile(item, scope)
}

/** Agents, commands, rules — single .md files */
function uninstallFile(item: DetectedItem, scope: InstallScope): string[] {
  const name = basename(item.path)
  const subdir = TYPE_SUBDIR[item.type]
  const removed: string[] = []

  // Always try both local and global — symlink mode writes to both
  const targets =
    scope === 'local'
      ? [join(LOCAL_BASE, subdir, name), join(GLOBAL_BASE, subdir, name)]
      : [join(GLOBAL_BASE, subdir, name)]

  for (const t of targets) {
    if (existsSync(t)) {
      rmSync(t)
      removed.push(t)
    }
  }
  return removed
}

/** Skills — directories */
function uninstallDir(item: DetectedItem, scope: InstallScope): string[] {
  const name = basename(dirname(item.path))   // parent of SKILL.md
  const subdir = TYPE_SUBDIR[item.type]
  const removed: string[] = []

  const targets =
    scope === 'local'
      ? [join(LOCAL_BASE, subdir, name), join(GLOBAL_BASE, subdir, name)]
      : [join(GLOBAL_BASE, subdir, name)]

  for (const t of targets) {
    if (existsSync(t)) {
      // If it's a symlink, remove the link only (don't delete the target dir)
      const stat = lstatSync(t)
      rmSync(t, stat.isSymbolicLink() ? undefined : { recursive: true })
      removed.push(t)
    }
  }
  return removed
}

/**
 * Hooks — two steps:
 *   1. Delete copied script files from .claude/hooks/
 *   2. Remove matching entries from .claude/settings.json
 */
function uninstallHook(item: DetectedItem, scope: InstallScope): string[] {
  const base = scope === 'global' ? GLOBAL_BASE : LOCAL_BASE
  const srcHooksDir = item.path
  const manifestPath = join(srcHooksDir, 'hooks.json')
  const removed: string[] = []

  // Remove script files
  for (const f of readdirSync(srcHooksDir)) {
    if (f === 'hooks.json' || f.startsWith('.')) continue
    const dest = join(base, 'hooks', f)
    if (existsSync(dest)) {
      rmSync(dest)
      removed.push(dest)
    }
  }

  // Remove hook entries from settings.json
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
      settings.hooks[event] = (settings.hooks[event] as unknown[]).filter(h => {
        const cmds = extractCommands([h], base)
        return !cmds.some(c => manifestCmds.includes(c))
      })
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

/** Recursively pull all "command" strings out of a hook config, substituting CLAUDE_PLUGIN_ROOT */
function extractCommands(handlers: unknown[], base: string): string[] {
  const json = JSON.stringify(handlers).replaceAll('${CLAUDE_PLUGIN_ROOT}', base)
  const parsed = JSON.parse(json) as unknown[]
  const cmds: string[] = []

  function walk(obj: unknown): void {
    if (!obj || typeof obj !== 'object') return
    if ('command' in (obj as Record<string, unknown>)) {
      const cmd = (obj as Record<string, unknown>).command
      if (typeof cmd === 'string') cmds.push(cmd)
    }
    for (const v of Object.values(obj as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(walk)
      else walk(v)
    }
  }

  parsed.forEach(walk)
  return cmds
}

/** Returns which detected items are actually installed (for showing a relevant list) */
export function filterInstalled(items: DetectedItem[]): DetectedItem[] {
  return items.filter(item => {
    if (item.type === 'skill') {
      const name = basename(dirname(item.path))
      return (
        existsSync(join(LOCAL_BASE, 'skills', name)) ||
        existsSync(join(GLOBAL_BASE, 'skills', name))
      )
    }
    if (item.type === 'hook') {
      const manifest = join(item.path, 'hooks.json')
      if (!existsSync(manifest)) return false
      try {
        const config = JSON.parse(readFileSync(manifest, 'utf8'))
        const event = Object.keys(config.hooks ?? {})[0]
        return (
          existsSync(join(LOCAL_BASE, 'settings.json')) ||
          existsSync(join(GLOBAL_BASE, 'settings.json'))
        )
      } catch { return false }
    }
    const name = basename(item.path)
    const subdir = TYPE_SUBDIR[item.type]
    return (
      existsSync(join(LOCAL_BASE, subdir, name)) ||
      existsSync(join(GLOBAL_BASE, subdir, name))
    )
  })
}
