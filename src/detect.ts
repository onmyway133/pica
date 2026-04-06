import { readdirSync, existsSync, readFileSync } from 'fs'
import { join, basename } from 'path'
import type { DetectedItem, DetectionResult } from './types.js'

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim()
    if (key) result[key] = val
  }
  return result
}

function readMd(filePath: string): { name: string; description?: string } {
  try {
    const content = readFileSync(filePath, 'utf8')
    const fm = parseFrontmatter(content)
    return { name: fm.name || basename(filePath, '.md'), description: fm.description }
  } catch {
    return { name: basename(filePath, '.md') }
  }
}

/** .claude/agents/*.md — Claude Code sub-agents */
function detectAgents(dir: string): DetectedItem[] {
  const agentsDir = join(dir, '.claude', 'agents')
  if (!existsSync(agentsDir)) return []

  return readdirSync(agentsDir)
    .filter(f => f.endsWith('.md') && !f.startsWith('.'))
    .map(f => {
      const path = join(agentsDir, f)
      const { name, description } = readMd(path)
      return { type: 'agent' as const, name, path, description }
    })
}

/** skills/{name}/SKILL.md or .claude/skills/{name}/SKILL.md */
function detectSkills(dir: string): DetectedItem[] {
  // Single-skill repo: root SKILL.md
  const rootSkill = join(dir, 'SKILL.md')
  if (existsSync(rootSkill)) {
    const { name, description } = readMd(rootSkill)
    return [{ type: 'skill', name, path: rootSkill, description }]
  }

  const results: DetectedItem[] = []
  for (const base of [join(dir, 'skills'), join(dir, '.claude', 'skills')]) {
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const skillMd = join(base, entry.name, 'SKILL.md')
      if (existsSync(skillMd)) {
        const { name, description } = readMd(skillMd)
        results.push({ type: 'skill', name, path: skillMd, description })
      }
    }
  }

  // Fallback: scan root-level directories for a SKILL.md inside them
  if (results.length === 0) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const skillMd = join(dir, entry.name, 'SKILL.md')
      if (existsSync(skillMd)) {
        const { name, description } = readMd(skillMd)
        results.push({ type: 'skill', name, path: skillMd, description })
      }
    }
  }

  return results
}

/** .claude/commands/*.md — slash commands */
function detectCommands(dir: string): DetectedItem[] {
  // Support both .claude/commands and top-level commands/ (e.g. claude-plugin style repos)
  for (const commandsDir of [join(dir, '.claude', 'commands'), join(dir, 'commands')]) {
    if (!existsSync(commandsDir)) continue
    const files = readdirSync(commandsDir).filter(f => f.endsWith('.md') && !f.startsWith('.'))
    if (files.length > 0) {
      return files.map(f => {
        const path = join(commandsDir, f)
        const { name, description } = readMd(path)
        return { type: 'command' as const, name, path, description }
      })
    }
  }
  return []
}

/**
 * Looks for hooks.json in hooks/ or .claude/hooks/.
 * hooks.json mirrors the Claude Code settings.json "hooks" format,
 * so pica can merge it into .claude/settings.json on install.
 */
function detectHooks(dir: string): DetectedItem[] {
  for (const hooksDir of [join(dir, '.claude', 'hooks'), join(dir, 'hooks')]) {
    const manifest = join(hooksDir, 'hooks.json')
    if (!existsSync(manifest)) continue
    try {
      const json = JSON.parse(readFileSync(manifest, 'utf8'))
      const description: string = json.description ?? Object.keys(json.hooks ?? {}).join(', ')
      return [{
        type: 'hook' as const,
        name: basename(dir),   // repo/plugin name
        path: hooksDir,        // whole hooks dir (scripts + manifest)
        description,
      }]
    } catch {
      // malformed hooks.json — skip
    }
  }
  return []
}

/** .claude/rules/*.md — Claude Code rules */
function detectRules(dir: string): DetectedItem[] {
  const rulesDir = join(dir, '.claude', 'rules')
  if (!existsSync(rulesDir)) return []

  return readdirSync(rulesDir)
    .filter(f => f.endsWith('.md') && !f.startsWith('.'))
    .map(f => {
      const path = join(rulesDir, f)
      const { name, description } = readMd(path)
      return { type: 'rule' as const, name, path, description }
    })
}

export function detect(dir: string): DetectionResult {
  return {
    agents: detectAgents(dir),
    skills: detectSkills(dir),
    commands: detectCommands(dir),
    hooks: detectHooks(dir),
    rules: detectRules(dir),
  }
}
