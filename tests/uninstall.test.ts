import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { installItems, installHooks, type Bases } from '../src/install.js'
import { uninstallItems, uninstallHook } from '../src/uninstall.js'
import type { DetectedItem } from '../src/types.js'

let srcDir: string
let globalDir: string
let localDir: string
let bases: Bases

beforeEach(() => {
  srcDir    = mkdtempSync(join(tmpdir(), 'pica-src-'))
  globalDir = mkdtempSync(join(tmpdir(), 'pica-global-'))
  localDir  = mkdtempSync(join(tmpdir(), 'pica-local-'))
  bases = { global: globalDir, local: localDir }
})

afterEach(() => {
  for (const d of [srcDir, globalDir, localDir]) {
    rmSync(d, { recursive: true, force: true })
  }
})

// ── Helpers ────────────────────────────────────────────────────────────────────

function writeFile(base: string, rel: string, content = 'content') {
  const abs = join(base, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
  return abs
}

function agentItem(name: string): DetectedItem {
  const path = writeFile(srcDir, `.claude/agents/${name}.md`, `---\nname: ${name}\n---\n`)
  return { type: 'agent', name, path }
}

function skillItem(name: string): DetectedItem {
  const path = writeFile(srcDir, `skills/${name}/SKILL.md`, `---\nname: ${name}\n---\n`)
  return { type: 'skill', name, path }
}

function makeHooksDir(event = 'Stop') {
  const hooksDir = join(srcDir, 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(join(hooksDir, 'hooks.json'), JSON.stringify({
    description: 'test hook',
    hooks: {
      [event]: [{ hooks: [{ type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh"' }] }],
    },
  }))
  writeFileSync(join(hooksDir, 'stop.sh'), '#!/bin/bash')
  return hooksDir
}

// ── File items (agent / command / rule) ────────────────────────────────────────

describe('uninstall file item', () => {
  it('removes agent from global', async () => {
    const item = agentItem('helper')
    await installItems([item], { scope: 'global', mode: 'copy' }, bases)
    expect(existsSync(join(globalDir, 'agents', 'helper.md'))).toBe(true)

    await uninstallItems([item], 'global', bases)
    expect(existsSync(join(globalDir, 'agents', 'helper.md'))).toBe(false)
  })

  it('removes agent from both local and global (symlink mode)', async () => {
    const item = agentItem('helper')
    await installItems([item], { scope: 'local', mode: 'symlink' }, bases)

    await uninstallItems([item], 'local', bases)
    expect(existsSync(join(localDir,  'agents', 'helper.md'))).toBe(false)
    expect(existsSync(join(globalDir, 'agents', 'helper.md'))).toBe(false)
  })

  it('reports success even when file was never installed', async () => {
    const item = agentItem('ghost')
    const [result] = await uninstallItems([item], 'global', bases)
    expect(result.success).toBe(true)
    expect(result.removed).toHaveLength(0)
  })
})

// ── Skill directory ────────────────────────────────────────────────────────────

describe('uninstall skill', () => {
  it('removes skill directory from global', async () => {
    const item = skillItem('react')
    await installItems([item], { scope: 'global', mode: 'copy' }, bases)
    expect(existsSync(join(globalDir, 'skills', 'react'))).toBe(true)

    await uninstallItems([item], 'global', bases)
    expect(existsSync(join(globalDir, 'skills', 'react'))).toBe(false)
  })

  it('removes symlink and global directory', async () => {
    const item = skillItem('react')
    await installItems([item], { scope: 'local', mode: 'symlink' }, bases)

    await uninstallItems([item], 'local', bases)
    expect(existsSync(join(localDir,  'skills', 'react'))).toBe(false)
    expect(existsSync(join(globalDir, 'skills', 'react'))).toBe(false)
  })
})

// ── Hooks ──────────────────────────────────────────────────────────────────────

describe('uninstall hook', () => {
  it('removes script files', () => {
    const hooksDir = makeHooksDir()
    installHooks(hooksDir, globalDir)
    expect(existsSync(join(globalDir, 'hooks', 'stop.sh'))).toBe(true)

    const item: DetectedItem = { type: 'hook', name: 'test', path: hooksDir }
    uninstallHook(item, 'global', bases)
    expect(existsSync(join(globalDir, 'hooks', 'stop.sh'))).toBe(false)
  })

  it('removes hook entries from settings.json', () => {
    const hooksDir = makeHooksDir('Stop')
    installHooks(hooksDir, globalDir)

    const item: DetectedItem = { type: 'hook', name: 'test', path: hooksDir }
    uninstallHook(item, 'global', bases)

    const settings = JSON.parse(readFileSync(join(globalDir, 'settings.json'), 'utf8'))
    expect(settings.hooks).toBeUndefined()
  })

  it('leaves other hook events intact', () => {
    // Pre-existing hook for a different event
    writeFileSync(join(globalDir, 'settings.json'), JSON.stringify({
      hooks: { PreToolUse: [{ existing: true }] },
    }))

    const hooksDir = makeHooksDir('Stop')
    installHooks(hooksDir, globalDir)

    const item: DetectedItem = { type: 'hook', name: 'test', path: hooksDir }
    uninstallHook(item, 'global', bases)

    const settings = JSON.parse(readFileSync(join(globalDir, 'settings.json'), 'utf8'))
    expect(settings.hooks?.PreToolUse).toHaveLength(1)
    expect(settings.hooks?.Stop).toBeUndefined()
  })

  it('leaves other handlers in the same event intact', () => {
    const hooksDir = makeHooksDir('Stop')
    installHooks(hooksDir, globalDir)

    // Add another Stop handler manually
    const settings = JSON.parse(readFileSync(join(globalDir, 'settings.json'), 'utf8'))
    settings.hooks.Stop.push({ other: true })
    writeFileSync(join(globalDir, 'settings.json'), JSON.stringify(settings))

    const item: DetectedItem = { type: 'hook', name: 'test', path: hooksDir }
    uninstallHook(item, 'global', bases)

    const updated = JSON.parse(readFileSync(join(globalDir, 'settings.json'), 'utf8'))
    expect(updated.hooks.Stop).toHaveLength(1)
    expect((updated.hooks.Stop[0] as Record<string, unknown>).other).toBe(true)
  })
})
