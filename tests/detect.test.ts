import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { detect } from '../src/detect.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pica-detect-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// ── Helpers ────────────────────────────────────────────────────────────────────

function write(rel: string, content: string) {
  const abs = join(dir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
}

function frontmatter(name: string, description?: string) {
  return `---\nname: ${name}${description ? `\ndescription: ${description}` : ''}\n---\n`
}

// ── Agents ─────────────────────────────────────────────────────────────────────

describe('agents', () => {
  it('detects agents from .claude/agents/', () => {
    write('.claude/agents/helper.md', frontmatter('helper', 'A helper agent'))
    const { agents } = detect(dir)
    expect(agents).toHaveLength(1)
    expect(agents[0]).toMatchObject({ type: 'agent', name: 'helper', description: 'A helper agent' })
  })

  it('uses filename as name when frontmatter has none', () => {
    write('.claude/agents/my-agent.md', '# no frontmatter')
    expect(detect(dir).agents[0].name).toBe('my-agent')
  })

  it('detects multiple agents', () => {
    write('.claude/agents/a.md', frontmatter('a'))
    write('.claude/agents/b.md', frontmatter('b'))
    expect(detect(dir).agents).toHaveLength(2)
  })

  it('skips hidden files', () => {
    write('.claude/agents/.hidden.md', frontmatter('hidden'))
    expect(detect(dir).agents).toHaveLength(0)
  })

  it('returns empty when directory is absent', () => {
    expect(detect(dir).agents).toHaveLength(0)
  })
})

// ── Skills ─────────────────────────────────────────────────────────────────────

describe('skills', () => {
  it('detects skills from skills/{name}/SKILL.md', () => {
    write('skills/react/SKILL.md', frontmatter('react', 'React best practices'))
    const { skills } = detect(dir)
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ type: 'skill', name: 'react' })
  })

  it('detects skills from .claude/skills/', () => {
    write('.claude/skills/ts-pro/SKILL.md', frontmatter('ts-pro'))
    expect(detect(dir).skills).toHaveLength(1)
  })

  it('detects root SKILL.md as single-skill repo', () => {
    write('SKILL.md', frontmatter('root-skill'))
    const { skills } = detect(dir)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('root-skill')
  })

  it('root SKILL.md takes priority — does not scan skills/ as well', () => {
    write('SKILL.md', frontmatter('root'))
    write('skills/sub/SKILL.md', frontmatter('sub'))
    expect(detect(dir).skills).toHaveLength(1)
  })

  it('ignores skill subdirs without SKILL.md', () => {
    write('skills/empty/README.md', '# nothing')
    expect(detect(dir).skills).toHaveLength(0)
  })

  it('detects multiple skills', () => {
    write('skills/a/SKILL.md', frontmatter('a'))
    write('skills/b/SKILL.md', frontmatter('b'))
    expect(detect(dir).skills).toHaveLength(2)
  })
})

// ── Commands ───────────────────────────────────────────────────────────────────

describe('commands', () => {
  it('detects commands from .claude/commands/', () => {
    write('.claude/commands/commit.md', frontmatter('commit', 'Git commit'))
    const { commands } = detect(dir)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ type: 'command', name: 'commit' })
  })

  it('detects commands from top-level commands/', () => {
    write('commands/deploy.md', '# deploy')
    expect(detect(dir).commands).toHaveLength(1)
    expect(detect(dir).commands[0].name).toBe('deploy')
  })

  it('prefers .claude/commands/ over commands/ when both exist', () => {
    write('.claude/commands/a.md', frontmatter('a'))
    write('commands/b.md', frontmatter('b'))
    // Returns .claude/commands first (first match wins)
    expect(detect(dir).commands).toHaveLength(1)
    expect(detect(dir).commands[0].name).toBe('a')
  })

  it('skips hidden files', () => {
    write('.claude/commands/.draft.md', frontmatter('draft'))
    expect(detect(dir).commands).toHaveLength(0)
  })
})

// ── Hooks ──────────────────────────────────────────────────────────────────────

describe('hooks', () => {
  const hooksJson = JSON.stringify({
    description: 'stop hook',
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'bash ${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh' }] }],
    },
  })

  it('detects hooks from hooks/hooks.json', () => {
    write('hooks/hooks.json', hooksJson)
    const { hooks } = detect(dir)
    expect(hooks).toHaveLength(1)
    expect(hooks[0]).toMatchObject({ type: 'hook', description: 'stop hook' })
  })

  it('detects hooks from .claude/hooks/hooks.json', () => {
    write('.claude/hooks/hooks.json', hooksJson)
    expect(detect(dir).hooks).toHaveLength(1)
  })

  it('returns empty when hooks/ exists but has no hooks.json', () => {
    write('hooks/stop.sh', '#!/bin/bash')
    expect(detect(dir).hooks).toHaveLength(0)
  })

  it('returns empty for malformed hooks.json', () => {
    write('hooks/hooks.json', '{ bad json }}}')
    expect(detect(dir).hooks).toHaveLength(0)
  })
})

// ── Rules ──────────────────────────────────────────────────────────────────────

describe('rules', () => {
  it('detects rules from .claude/rules/', () => {
    write('.claude/rules/style.md', frontmatter('style', 'Coding style rules'))
    const { rules } = detect(dir)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ type: 'rule', name: 'style' })
  })

  it('detects multiple rules', () => {
    write('.claude/rules/style.md', frontmatter('style'))
    write('.claude/rules/security.md', frontmatter('security'))
    expect(detect(dir).rules).toHaveLength(2)
  })

  it('skips hidden files', () => {
    write('.claude/rules/.draft.md', frontmatter('draft'))
    expect(detect(dir).rules).toHaveLength(0)
  })
})

// ── Mixed ──────────────────────────────────────────────────────────────────────

describe('mixed repo', () => {
  it('detects all types together', () => {
    write('.claude/agents/bot.md', frontmatter('bot'))
    write('skills/react/SKILL.md', frontmatter('react'))
    write('.claude/commands/commit.md', frontmatter('commit'))
    write('hooks/hooks.json', JSON.stringify({ description: 'd', hooks: {} }))
    write('.claude/rules/style.md', frontmatter('style'))

    const result = detect(dir)
    expect(result.agents).toHaveLength(1)
    expect(result.skills).toHaveLength(1)
    expect(result.commands).toHaveLength(1)
    expect(result.hooks).toHaveLength(1)
    expect(result.rules).toHaveLength(1)
  })

  it('returns all-empty for a bare repo', () => {
    const result = detect(dir)
    const total = Object.values(result).flat().length
    expect(total).toBe(0)
  })
})
