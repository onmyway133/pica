#!/usr/bin/env bun
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { fetchRepo } from './fetch.js'
import { detect } from './detect.js'
import { installItems } from './install.js'
import { uninstallItems, filterInstalled } from './uninstall.js'
import type { DetectedItem, ItemType, InstallMode, InstallScope } from './types.js'

const TYPE_LABELS: Record<ItemType, string> = {
  agent: 'Agent',
  skill: 'Skill',
  command: 'Command',
  hook: 'Hook',
  rule: 'Rule',
}

function cancel(msg = 'Cancelled'): never {
  p.cancel(msg)
  process.exit(0)
}

function plural(n: number, word: string) {
  return `${n} ${word}${n !== 1 ? 's' : ''}`
}

function printUsage(): never {
  console.error([
    'Usage:',
    '  pica <repo>                   Install from repo',
    '  pica install <repo>           Install from repo',
    '  pica uninstall <repo>         Uninstall items from repo',
    '',
    'Repo formats:',
    '  owner/repo                    GitHub shorthand',
    '  https://github.com/owner/repo Full URL',
    '  ./local/path                  Local directory',
  ].join('\n'))
  process.exit(1)
}

async function fetchAndDetect(url: string): Promise<{ repoDir: string; allItems: DetectedItem[] }> {
  const spinner = p.spinner()
  spinner.start('Fetching repository…')
  let repoDir: string
  try {
    repoDir = await fetchRepo(url)
    spinner.stop('Repository ready')
  } catch (err) {
    spinner.stop('Failed to fetch repository')
    p.log.error(String(err))
    process.exit(1)
  }

  const detected = detect(repoDir)
  const allItems: DetectedItem[] = [
    ...detected.agents,
    ...detected.skills,
    ...detected.commands,
    ...detected.hooks,
    ...detected.rules,
  ]

  if (allItems.length === 0) {
    p.outro('Nothing detected in this repository')
    process.exit(0)
  }

  const summary = (
    [
      detected.agents.length && plural(detected.agents.length, 'agent'),
      detected.skills.length && plural(detected.skills.length, 'skill'),
      detected.commands.length && plural(detected.commands.length, 'command'),
      detected.hooks.length && plural(detected.hooks.length, 'hook'),
      detected.rules.length && plural(detected.rules.length, 'rule'),
    ] as (string | false)[]
  ).filter(Boolean).join(', ')

  p.log.success(`Detected: ${summary}`)
  return { repoDir, allItems }
}

function itemOptions(items: DetectedItem[]) {
  return items.map(item => ({
    value: item,
    label: `${pc.dim(TYPE_LABELS[item.type].padEnd(8))}  ${item.name}`,
    hint: item.description,
  }))
}

// ── Install ────────────────────────────────────────────────────────────────────

async function runInstall(url: string) {
  const { allItems } = await fetchAndDetect(url)

  // Step 1: choose types
  const typesSeen = [...new Set(allItems.map(i => i.type))]
  const typeOptions = typesSeen.map(t => ({
    value: t,
    label: `${TYPE_LABELS[t]}s  (${allItems.filter(i => i.type === t).length})`,
  }))

  const selectedTypes = await p.multiselect<ItemType>({
    message: 'What do you want to install?',
    options: typeOptions,
    required: true,
  })
  if (p.isCancel(selectedTypes)) cancel()

  // Step 2: choose individual items
  const filtered = allItems.filter(i => (selectedTypes as ItemType[]).includes(i.type))
  const selectedItems = await p.multiselect<DetectedItem>({
    message: 'Choose items:',
    options: itemOptions(filtered),
    initialValues: filtered,
    required: true,
  })
  if (p.isCancel(selectedItems)) cancel()

  // Step 3: scope
  const scope = await p.select<InstallScope>({
    message: 'Install scope:',
    options: [
      { value: 'local', label: 'Local  (.claude/)' },
      { value: 'global', label: 'Global  (~/.claude/)' },
    ],
    initialValue: 'local',
  })
  if (p.isCancel(scope)) cancel()

  // Step 4: mode
  const mode = await p.select<InstallMode>({
    message: 'Install mode:',
    options: [
      { value: 'symlink', label: 'Symlink  (store in ~/.claude/, link from .claude/)' },
      { value: 'copy', label: 'Copy  (copy directly to target)' },
    ],
    initialValue: 'symlink',
  })
  if (p.isCancel(mode)) cancel()

  const s = p.spinner()
  s.start('Installing…')
  const results = await installItems(selectedItems as DetectedItem[], {
    scope: scope as InstallScope,
    mode: mode as InstallMode,
  })
  s.stop('Done')

  for (const r of results) {
    if (r.success) p.log.success(`${r.item.name}  →  ${r.dest}`)
    else p.log.error(`${r.item.name}: ${r.error}`)
  }

  p.outro(pc.green('All done!'))
}

// ── Uninstall ──────────────────────────────────────────────────────────────────

async function runUninstall(url: string) {
  const { allItems } = await fetchAndDetect(url)

  // Only show items that are actually installed
  const installed = filterInstalled(allItems)
  if (installed.length === 0) {
    p.outro('Nothing from this repo appears to be installed')
    process.exit(0)
  }

  const selectedItems = await p.multiselect<DetectedItem>({
    message: 'Choose items to remove:',
    options: itemOptions(installed),
    initialValues: installed,
    required: true,
  })
  if (p.isCancel(selectedItems)) cancel()

  // Scope — determines where to look for installed files
  const scope = await p.select<InstallScope>({
    message: 'Uninstall from:',
    options: [
      { value: 'local', label: 'Local + Global  (removes both .claude/ and ~/.claude/)' },
      { value: 'global', label: 'Global only  (~/.claude/)' },
    ],
    initialValue: 'local',
  })
  if (p.isCancel(scope)) cancel()

  const confirm = await p.confirm({
    message: `Remove ${(selectedItems as DetectedItem[]).length} item(s)?`,
    initialValue: false,
  })
  if (p.isCancel(confirm) || !confirm) cancel('Aborted')

  const s = p.spinner()
  s.start('Removing…')
  const results = await uninstallItems(selectedItems as DetectedItem[], scope as InstallScope)
  s.stop('Done')

  for (const r of results) {
    if (r.success) {
      if (r.removed.length > 0) {
        for (const path of r.removed) p.log.success(`removed  ${path}`)
      } else {
        p.log.warn(`${r.item.name}: nothing found to remove`)
      }
    } else {
      p.log.error(`${r.item.name}: ${r.error}`)
    }
  }

  p.outro(pc.green('Done!'))
}

// ── Entry ──────────────────────────────────────────────────────────────────────

function repoLabel(input: string): string {
  // Strip trailing .git
  const s = input.replace(/\.git$/, '')
  // Extract last two path segments for GitHub-style "owner/repo"
  const match = s.match(/([^/]+\/[^/]+)$/)
  return match ? match[1] : s
}

async function main() {
  const [, , first, second] = process.argv

  if (!first) printUsage()

  const url = first === 'uninstall' || first === 'remove' || first === 'install' ? second : first
  p.intro(pc.bold(` ${url ? repoLabel(url) : '@onmyway133/pica'} `))

  if (first === 'uninstall' || first === 'remove') {
    if (!second) printUsage()
    await runUninstall(second)
  } else if (first === 'install') {
    if (!second) printUsage()
    await runInstall(second)
  } else {
    // bare: pica <repo>
    await runInstall(first)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
