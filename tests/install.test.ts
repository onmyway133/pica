import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, lstatSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { installItems, installHooks, type Bases } from '../src/install.js'
import type { DetectedItem } from '../src/types.js'

let srcDir: string   // simulates the cloned repo
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

function commandItem(name: string): DetectedItem {
  const path = writeFile(srcDir, `.claude/commands/${name}.md`, `---\nname: ${name}\n---\n`)
  return { type: 'command', name, path }
}

function ruleItem(name: string): DetectedItem {
  const path = writeFile(srcDir, `.claude/rules/${name}.md`, `---\nname: ${name}\n---\n`)
  return { type: 'rule', name, path }
}

// ── Copy mode ──────────────────────────────────────────────────────────────────

describe('copy mode — global scope', () => {
  it('installs agent to global/agents/', async () => {
    const item = agentItem('helper')
    const [result] = await installItems([item], { scope: 'global', mode: 'copy' }, bases)
    expect(result.success).toBe(true)
    expect(existsSync(join(globalDir, 'agents', 'helper.md'))).toBe(true)
  })

  it('installs skill directory to global/skills/', async () => {
    const item = skillItem('react')
    await installItems([item], { scope: 'global', mode: 'copy' }, bases)
    expect(existsSync(join(globalDir, 'skills', 'react', 'SKILL.md'))).toBe(true)
  })

  it('installs command to global/commands/', async () => {
    const item = commandItem('commit')
    await installItems([item], { scope: 'global', mode: 'copy' }, bases)
    expect(existsSync(join(globalDir, 'commands', 'commit.md'))).toBe(true)
  })

  it('installs rule to global/rules/', async () => {
    const item = ruleItem('style')
    await installItems([item], { scope: 'global', mode: 'copy' }, bases)
    expect(existsSync(join(globalDir, 'rules', 'style.md'))).toBe(true)
  })
})

describe('copy mode — local scope', () => {
  it('installs agent to local/agents/', async () => {
    const item = agentItem('helper')
    await installItems([item], { scope: 'local', mode: 'copy' }, bases)
    expect(existsSync(join(localDir, 'agents', 'helper.md'))).toBe(true)
    expect(existsSync(join(globalDir, 'agents', 'helper.md'))).toBe(false)
  })
})

// ── Symlink mode ───────────────────────────────────────────────────────────────

describe('symlink mode', () => {
  it('copies agent to global and symlinks from local', async () => {
    const item = agentItem('helper')
    const [result] = await installItems([item], { scope: 'local', mode: 'symlink' }, bases)

    const globalPath = join(globalDir, 'agents', 'helper.md')
    const localPath  = join(localDir,  'agents', 'helper.md')

    expect(existsSync(globalPath)).toBe(true)
    expect(lstatSync(localPath).isSymbolicLink()).toBe(true)
    expect(result.dest).toBe(localPath)
  })

  it('global scope symlink: copies to global, no local link', async () => {
    const item = agentItem('helper')
    await installItems([item], { scope: 'global', mode: 'symlink' }, bases)

    expect(existsSync(join(globalDir, 'agents', 'helper.md'))).toBe(true)
    expect(existsSync(join(localDir,  'agents', 'helper.md'))).toBe(false)
  })

  it('symlinks skill directory', async () => {
    const item = skillItem('react')
    await installItems([item], { scope: 'local', mode: 'symlink' }, bases)

    expect(lstatSync(join(localDir, 'skills', 'react')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(globalDir, 'skills', 'react', 'SKILL.md'))).toBe(true)
  })
})

// ── Hooks ──────────────────────────────────────────────────────────────────────

describe('installHooks', () => {
  function makeHooksDir(event = 'Stop') {
    const hooksDir = join(srcDir, 'hooks')
    mkdirSync(hooksDir)
    writeFileSync(join(hooksDir, 'hooks.json'), JSON.stringify({
      description: 'test hook',
      hooks: {
        [event]: [{ hooks: [{ type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh"' }] }],
      },
    }))
    writeFileSync(join(hooksDir, 'stop.sh'), '#!/bin/bash\necho done')
    return hooksDir
  }

  it('copies script files to {base}/hooks/', () => {
    const hooksDir = makeHooksDir()
    installHooks(hooksDir, globalDir)
    expect(existsSync(join(globalDir, 'hooks', 'stop.sh'))).toBe(true)
  })

  it('does not copy hooks.json itself', () => {
    const hooksDir = makeHooksDir()
    installHooks(hooksDir, globalDir)
    expect(existsSync(join(globalDir, 'hooks', 'hooks.json'))).toBe(false)
  })

  it('creates settings.json with resolved hook command', () => {
    const hooksDir = makeHooksDir()
    installHooks(hooksDir, globalDir)

    const settings = JSON.parse(readFileSync(join(globalDir, 'settings.json'), 'utf8'))
    const cmd: string = settings.hooks.Stop[0].hooks[0].command
    expect(cmd).toContain(globalDir)
    expect(cmd).not.toContain('${CLAUDE_PLUGIN_ROOT}')
  })

  it('merges into existing settings.json without overwriting other hooks', () => {
    const existing = { hooks: { PreToolUse: [{ existing: true }] } }
    writeFileSync(join(globalDir, 'settings.json'), JSON.stringify(existing))

    const hooksDir = makeHooksDir('Stop')
    installHooks(hooksDir, globalDir)

    const settings = JSON.parse(readFileSync(join(globalDir, 'settings.json'), 'utf8'))
    expect(settings.hooks.PreToolUse).toHaveLength(1)
    expect(settings.hooks.Stop).toHaveLength(1)
  })

  it('appends to existing hook event handlers', () => {
    const existing = { hooks: { Stop: [{ existing: true }] } }
    writeFileSync(join(globalDir, 'settings.json'), JSON.stringify(existing))

    const hooksDir = makeHooksDir('Stop')
    installHooks(hooksDir, globalDir)

    const settings = JSON.parse(readFileSync(join(globalDir, 'settings.json'), 'utf8'))
    expect(settings.hooks.Stop).toHaveLength(2)
  })
})

// ── Multiple items ─────────────────────────────────────────────────────────────

describe('multiple items', () => {
  it('installs all items and reports results', async () => {
    const items = [agentItem('a'), commandItem('b'), ruleItem('c')]
    const results = await installItems(items, { scope: 'global', mode: 'copy' }, bases)

    expect(results).toHaveLength(3)
    expect(results.every(r => r.success)).toBe(true)
  })
})
