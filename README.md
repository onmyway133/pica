# pica

<p align="center">
  <img src="images/pica.png" width="200" alt="pica" />
</p>

CLI to detect and install Claude Code agents, skills, commands, hooks, and rules from any GitHub repo or local path.

Named after *Pica pica* — the magpie, known for collecting shiny things.

```
npx @onmyway133/pica <repo>
npx @onmyway133/pica uninstall <repo>
```

## Usage

```sh
# Install — GitHub shorthand
pica onmyway133/cmon

# Install — full URL
pica https://github.com/onmyway133/cmon

# Install — local path
pica ./my-claude-setup

# Uninstall
pica uninstall onmyway133/cmon
pica remove onmyway133/cmon
```

pica clones the repo, scans it, and walks you through an interactive prompt to pick what to install or remove, the scope (local vs global), and the mode (symlink vs copy).

## Install

Prompts for:
1. Which types to install (Agents, Skills, Commands, Hooks, Rules)
2. Which individual items within those types
3. Scope — local (`.claude/`) or global (`~/.claude/`)
4. Mode — symlink or copy

## Uninstall

```sh
pica uninstall <repo>
```

pica fetches the same repo, detects what it contains, and shows only the items that are actually installed on your machine. Select what to remove and confirm.

For **hooks**, uninstall surgically removes only the matching entries from `settings.json`, leaving any other hooks you have configured untouched. Script files in `.claude/hooks/` are deleted.

Scope options at uninstall time:
- **Local + Global** — removes from both `.claude/` and `~/.claude/` (use this if you installed with symlink mode)
- **Global only** — removes only from `~/.claude/`

## What gets detected

pica looks for five types of Claude Code config in a repo:

| Type | Detected from |
|------|--------------|
| Agent | `.claude/agents/*.md` |
| Skill | `skills/{name}/SKILL.md` or `.claude/skills/{name}/SKILL.md` or root `SKILL.md` |
| Command | `.claude/commands/*.md` or `commands/*.md` |
| Hook | `hooks/hooks.json` or `.claude/hooks/hooks.json` |
| Rule | `.claude/rules/*.md` |

## What gets installed

### Agent

An agent is a `.md` file that defines a Claude Code sub-agent with a specific persona and tools.

**Installed to:**
```
# local
.claude/agents/my-agent.md

# global
~/.claude/agents/my-agent.md
```

Claude Code picks up any `.md` file in `agents/` automatically. No further setup needed.

---

### Skill

A skill is a directory containing a `SKILL.md` file with instructions for Claude.

**Installed to:**
```
# local
.claude/skills/my-skill/SKILL.md

# global
~/.claude/skills/my-skill/SKILL.md
```

The whole directory is installed (not just the `.md`), so skills can bundle supporting files alongside their instructions.

---

### Command

A command is a `.md` file that defines a Claude Code slash command (e.g. `/commit`, `/review`).

**Installed to:**
```
# local
.claude/commands/my-command.md

# global
~/.claude/commands/my-command.md
```

Once installed, the command is available in Claude Code as `/my-command`.

---

### Hook

A hook repo must have a `hooks/hooks.json` that declares which Claude Code lifecycle events to intercept, and the scripts that handle them. The format of `hooks.json` mirrors the `hooks` block in `settings.json`:

```json
{
  "description": "...",
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/stop-hook.sh\""
          }
        ]
      }
    ]
  }
}
```

**Installing a hook does two things:**

1. **Copies scripts** to `.claude/hooks/` (and makes `.sh` files executable):
   ```
   .claude/hooks/stop-hook.sh
   ```

2. **Merges the hooks config** into `.claude/settings.json`, replacing `${CLAUDE_PLUGIN_ROOT}` with the real path:
   ```json
   {
     "hooks": {
       "Stop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "bash \"/your/project/.claude/hooks/stop-hook.sh\""
             }
           ]
         }
       ]
     }
   }
   ```

Claude Code reads `settings.json` on startup and runs registered hooks at the matching lifecycle events. If `settings.json` already has hooks for that event, pica appends rather than overwrites.

---

### Rule

A rule is a `.md` file placed in `.claude/rules/`. Claude Code loads all files in this directory as persistent instructions that apply to every session.

**Installed to:**
```
# local
.claude/rules/my-rule.md

# global
~/.claude/rules/my-rule.md
```

---

## Symlink vs Copy

| Mode | What happens |
|------|-------------|
| **Symlink** | Files are copied to `~/.claude/` (global store), then a symlink is created from `.claude/` → `~/.claude/`. One source of truth — updating the global copy is reflected everywhere. |
| **Copy** | Files are copied directly to the chosen scope (local `.claude/` or global `~/.claude/`). Independent copy, no link. |

## Local vs Global scope

| Scope | Base directory | Committed to repo? |
|-------|---------------|-------------------|
| Local | `.claude/` in current project | Yes (if you commit it) |
| Global | `~/.claude/` | No — available in all projects |

## Repo format

To make your repo work with pica, follow these conventions:

```
my-repo/
├── .claude/
│   ├── agents/
│   │   └── my-agent.md        # sub-agent
│   ├── commands/
│   │   └── my-command.md      # slash command
│   ├── rules/
│   │   └── my-rule.md         # persistent rule
│   └── skills/
│       └── my-skill/
│           └── SKILL.md       # skill
├── hooks/
│   ├── hooks.json             # hook manifest
│   └── my-hook.sh             # hook script
└── skills/
    └── my-skill/
        └── SKILL.md           # alternative skills location
```

A repo can contain any combination of these. pica detects whatever is present and lets you choose what to install.
