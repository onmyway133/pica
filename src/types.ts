export type ItemType = 'agent' | 'skill' | 'command' | 'hook' | 'rule'
export type InstallMode = 'symlink' | 'copy'
export type InstallScope = 'global' | 'local'

export interface DetectedItem {
  type: ItemType
  name: string
  path: string       // absolute path in temp/local dir
  description?: string
}

export interface DetectionResult {
  agents: DetectedItem[]
  skills: DetectedItem[]
  commands: DetectedItem[]
  hooks: DetectedItem[]
  rules: DetectedItem[]
}

export interface InstallOptions {
  scope: InstallScope
  mode: InstallMode
}

export interface InstallResult {
  item: DetectedItem
  dest: string
  success: boolean
  error?: string
}
