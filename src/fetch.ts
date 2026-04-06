import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, isAbsolute } from 'path'
import { spawnSync } from 'child_process'

/** Expand shorthand `owner/repo` to a full GitHub URL */
function normalizeUrl(input: string): string {
  if (isAbsolute(input) || input.startsWith('./') || input.startsWith('../')) {
    return input  // local path, handled separately
  }
  // Already a full URL
  if (input.startsWith('http://') || input.startsWith('https://') || input.startsWith('git@')) {
    return input
  }
  // GitHub shorthand: owner/repo
  if (/^[\w.-]+\/[\w.-]+$/.test(input)) {
    return `https://github.com/${input}`
  }
  return input
}

/** Returns the local directory for the repo — clones remote URLs, resolves local paths */
export async function fetchRepo(input: string): Promise<string> {
  const normalized = normalizeUrl(input)

  // Local path — use as-is
  if (isAbsolute(normalized) || normalized.startsWith('./') || normalized.startsWith('../')) {
    return resolve(normalized)
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'agent-'))
  const result = spawnSync('git', ['clone', '--depth', '1', normalized, tmpDir], {
    stdio: ['ignore', 'ignore', 'pipe']
  })

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() ?? ''
    throw new Error(`git clone failed:\n${stderr}`)
  }

  return tmpDir
}
