import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, isAbsolute } from 'path'

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
  const result = Bun.spawnSync(
    ['git', 'clone', '--depth', '1', normalized, tmpDir],
    { stderr: 'pipe' }
  )

  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr)
    throw new Error(`git clone failed:\n${stderr.trim()}`)
  }

  return tmpDir
}
