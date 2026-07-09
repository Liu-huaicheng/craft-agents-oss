/**
 * Tests for extractWorkspaceSlug utility and qualifySkillName
 *
 * extractWorkspaceSlug (packages/shared/src/utils/workspace.ts) is used in
 * ClaudeAgent, PiAgent, and renderer components to derive the workspace
 * slug from rootPath for skill qualification.
 *
 * This file tests:
 * 1. The extractWorkspaceSlug utility directly
 * 2. qualifySkillName which consumes the slug
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, statSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { qualifySkillName, AGENTS_PLUGIN_NAME } from '../core/index.ts'
import { extractWorkspaceSlug, readPluginName } from '../../utils/workspace.ts'
import { resolveMarketplacePluginSkill } from '../claude-plugins.ts'

// ============================================================================
// readPluginName — reads SDK plugin name from .claude-plugin/plugin.json
// ============================================================================

describe('readPluginName', () => {
  const testDir = join(tmpdir(), `plugin-name-test-${Date.now()}`)

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('reads plugin name from .claude-plugin/plugin.json', () => {
    const wsDir = join(testDir, 'ws-with-plugin')
    mkdirSync(join(wsDir, '.claude-plugin'), { recursive: true })
    writeFileSync(join(wsDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'craft-workspace-default', version: '1.0.0' }))
    expect(readPluginName(wsDir)).toBe('craft-workspace-default')
  })

  it('returns null when .claude-plugin/plugin.json does not exist', () => {
    const wsDir = join(testDir, 'ws-no-plugin')
    mkdirSync(wsDir, { recursive: true })
    expect(readPluginName(wsDir)).toBeNull()
  })

  it('returns null when plugin.json has no name field', () => {
    const wsDir = join(testDir, 'ws-no-name')
    mkdirSync(join(wsDir, '.claude-plugin'), { recursive: true })
    writeFileSync(join(wsDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '1.0.0' }))
    expect(readPluginName(wsDir)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    const wsDir = join(testDir, 'ws-bad-json')
    mkdirSync(join(wsDir, '.claude-plugin'), { recursive: true })
    writeFileSync(join(wsDir, '.claude-plugin', 'plugin.json'), 'not json')
    expect(readPluginName(wsDir)).toBeNull()
  })
})

// ============================================================================
// extractWorkspaceSlug — reads plugin name, falls back to basename
// ============================================================================

describe('workspace slug extraction', () => {
  const fallback = 'fallback-id'

  it('reads plugin name from plugin.json when available', () => {
    const testDir2 = join(tmpdir(), `slug-plugin-test-${Date.now()}`)
    const wsDir = join(testDir2, 'bd1675ea-4ba1-96e0-3de4-22c803b11e0d')
    mkdirSync(join(wsDir, '.claude-plugin'), { recursive: true })
    writeFileSync(join(wsDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'craft-workspace-default', version: '1.0.0' }))
    expect(extractWorkspaceSlug(wsDir, fallback)).toBe('craft-workspace-default')
    rmSync(testDir2, { recursive: true, force: true })
  })

  it('extracts slug from normal path', () => {
    expect(extractWorkspaceSlug('/Users/foo/my-workspace', fallback)).toBe('my-workspace')
  })

  it('extracts slug from path with trailing slash', () => {
    expect(extractWorkspaceSlug('/path/workspace/', fallback)).toBe('workspace')
  })

  it('extracts slug from deep path', () => {
    expect(extractWorkspaceSlug('/a/b/c/d/workspace', fallback)).toBe('workspace')
  })

  it('extracts slug from single-component path', () => {
    expect(extractWorkspaceSlug('/workspace', fallback)).toBe('workspace')
  })

  it('returns fallback for root path /', () => {
    // split('/').filter(Boolean) on '/' gives []
    // [].at(-1) is undefined, so fallback is used
    expect(extractWorkspaceSlug('/', fallback)).toBe(fallback)
  })

  it('returns fallback for empty string', () => {
    // split('/').filter(Boolean) on '' gives []
    expect(extractWorkspaceSlug('', fallback)).toBe(fallback)
  })

  it('handles Windows-style paths with forward slashes', () => {
    expect(extractWorkspaceSlug('C:/Users/foo/workspace', fallback)).toBe('workspace')
  })

  it('handles Windows-style paths with backslashes', () => {
    expect(extractWorkspaceSlug('C:\\Users\\ghalmos\\.craft-agent\\workspaces\\my-workspace', fallback)).toBe('my-workspace')
  })

  it('handles Windows paths with tilde and backslashes', () => {
    expect(extractWorkspaceSlug('~\\.craft-agent\\workspaces\\my-workspace', fallback)).toBe('my-workspace')
  })

  it('handles hyphenated workspace names', () => {
    expect(extractWorkspaceSlug('/path/to/my-cool-workspace', fallback)).toBe('my-cool-workspace')
  })

  it('handles dotted workspace names', () => {
    expect(extractWorkspaceSlug('/path/to/my.workspace-name', fallback)).toBe('my.workspace-name')
  })

  it('handles workspace names with underscores', () => {
    expect(extractWorkspaceSlug('/path/to/my_workspace', fallback)).toBe('my_workspace')
  })

  it('handles paths with spaces in components', () => {
    expect(extractWorkspaceSlug('/Users/John Smith/My Workspace', fallback)).toBe('My Workspace')
  })

  it('handles multiple trailing slashes', () => {
    // filter(Boolean) removes empty strings from split
    expect(extractWorkspaceSlug('/path/workspace///', fallback)).toBe('workspace')
  })
})

// ============================================================================
// qualifySkillName — uses the workspace slug to prefix skill names
// ============================================================================

describe('qualifySkillName', () => {
  it('qualifies a bare skill name with workspace slug', () => {
    const result = qualifySkillName({ skill: 'commit' }, 'my-workspace')
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my-workspace:commit' })
  })

  it('does not modify already-qualified skill names', () => {
    const result = qualifySkillName({ skill: 'my-workspace:commit' }, 'my-workspace')
    expect(result.modified).toBe(false)
    expect(result.input).toEqual({ skill: 'my-workspace:commit' })
  })

  it('does not modify skill with different workspace prefix', () => {
    const result = qualifySkillName({ skill: 'other-ws:commit' }, 'my-workspace')
    expect(result.modified).toBe(false)
    expect(result.input).toEqual({ skill: 'other-ws:commit' })
  })

  it('handles missing skill field', () => {
    const result = qualifySkillName({ args: 'something' }, 'my-workspace')
    expect(result.modified).toBe(false)
  })

  it('handles undefined skill field', () => {
    const result = qualifySkillName({ skill: undefined }, 'my-workspace')
    expect(result.modified).toBe(false)
  })

  it('preserves other input fields when qualifying', () => {
    const result = qualifySkillName({ skill: 'commit', args: '-m "fix"' }, 'my-workspace')
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my-workspace:commit', args: '-m "fix"' })
  })

  it('calls debug callback when qualifying', () => {
    const messages: string[] = []
    qualifySkillName({ skill: 'commit' }, 'my-workspace', undefined, undefined, (msg) => messages.push(msg))
    expect(messages.length).toBe(1)
    expect(messages[0]).toContain('qualified')
    expect(messages[0]).toContain('commit')
    expect(messages[0]).toContain('my-workspace:commit')
  })

  it('does not call debug callback when skill is missing', () => {
    const messages: string[] = []
    qualifySkillName({ skill: undefined }, 'my-workspace', undefined, undefined, (msg) => messages.push(msg))
    expect(messages.length).toBe(0)
  })

  it('works with dotted workspace slug', () => {
    const result = qualifySkillName({ skill: 'commit' }, 'my.workspace')
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my.workspace:commit' })
  })

  it('works with hyphenated skill names', () => {
    const result = qualifySkillName({ skill: 'review-pr' }, 'workspace')
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'workspace:review-pr' })
  })

  it('handles empty slug from trailing colon', () => {
    const result = qualifySkillName({ skill: 'workspace:' }, 'my-workspace')
    expect(result.modified).toBe(false)
  })
})

// ============================================================================
// qualifySkillName with filesystem resolution (resolveSkillPlugin path)
// ============================================================================

describe('qualifySkillName with filesystem resolution', () => {
  const testDir = join(tmpdir(), `skill-resolve-test-${Date.now()}`)
  const workspaceRoot = join(testDir, 'my-workspace')
  const projectDir = join(testDir, 'my-project')
  const workspaceSlug = 'my-workspace'

  beforeAll(() => {
    // Create workspace skill: my-workspace/skills/ws-only/SKILL.md
    mkdirSync(join(workspaceRoot, 'skills', 'ws-only'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'skills', 'ws-only', 'SKILL.md'), '---\nname: WS Only\ndescription: test\n---\n')

    // Create workspace skill that also exists in project (for priority test)
    mkdirSync(join(workspaceRoot, 'skills', 'shared-skill'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'skills', 'shared-skill', 'SKILL.md'), '---\nname: WS Shared\ndescription: test\n---\n')

    // Create project skill: my-project/.agents/skills/proj-only/SKILL.md
    mkdirSync(join(projectDir, '.agents', 'skills', 'proj-only'), { recursive: true })
    writeFileSync(join(projectDir, '.agents', 'skills', 'proj-only', 'SKILL.md'), '---\nname: Proj Only\ndescription: test\n---\n')

    // Create project skill that also exists in workspace (for priority test)
    mkdirSync(join(projectDir, '.agents', 'skills', 'shared-skill'), { recursive: true })
    writeFileSync(join(projectDir, '.agents', 'skills', 'shared-skill', 'SKILL.md'), '---\nname: Proj Shared\ndescription: test\n---\n')
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('resolves workspace-only skill to workspace plugin', () => {
    const result = qualifySkillName({ skill: 'ws-only' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my-workspace:ws-only' })
  })

  it('resolves project-only skill to .agents plugin', () => {
    const result = qualifySkillName({ skill: 'proj-only' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: `${AGENTS_PLUGIN_NAME}:proj-only` })
  })

  it('workspace skill takes priority over project skill (same slug)', () => {
    const result = qualifySkillName({ skill: 'shared-skill' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(true)
    // The `.agents` namespace is not registered with the SDK, so when a slug
    // also exists in an SDK-known namespace (workspace), that copy must win —
    // resolving to `.agents:` would be rejected as `Unknown command`.
    expect(result.input).toEqual({ skill: 'my-workspace:shared-skill' })
  })

  it('re-qualifies incorrectly qualified skill (workspace prefix for project skill)', () => {
    // UI might send "my-workspace:proj-only" but proj-only only exists in project tier
    const result = qualifySkillName({ skill: 'my-workspace:proj-only' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: `${AGENTS_PLUGIN_NAME}:proj-only` })
  })

  it('does not modify correctly qualified workspace skill', () => {
    const result = qualifySkillName({ skill: 'my-workspace:ws-only' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(false)
  })

  it('falls back to workspace plugin for unknown skill', () => {
    const result = qualifySkillName({ skill: 'nonexistent' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my-workspace:nonexistent' })
  })

  it('resolves without project dir (workspace-only mode)', () => {
    const result = qualifySkillName({ skill: 'ws-only' }, workspaceSlug, workspaceRoot, undefined)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my-workspace:ws-only' })
  })
})

// ============================================================================
// qualifySkillName with marketplace plugin resolution (resolveMarketplacePluginSkill)
//
// Marketplace plugins are Claude Code CLI-installed plugins enabled in
// ~/.claude/settings.json. They are namespaced by the plugin manifest `name`
// (e.g. `jira:jira`), not the workspace slug. Uses a unique CLAUDE_CONFIG_DIR
// and unique slugs so the real ~/.claude and ~/.agents tiers never interfere.
// ============================================================================

describe('qualifySkillName with marketplace plugin resolution', () => {
  const testDir = join(tmpdir(), `skill-marketplace-test-${Date.now()}`)
  const claudeHome = join(testDir, '.claude')
  const workspaceRoot = join(testDir, 'my-workspace')
  const projectDir = join(testDir, 'my-project')
  const workspaceSlug = 'my-workspace'
  const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
  const prevDisable = process.env.CRAFT_DISABLE_CLAUDE_PLUGINS

  beforeAll(() => {
    // Workspace skill whose slug also exists in a marketplace plugin (priority test)
    mkdirSync(join(workspaceRoot, 'skills', 'mkt-overlap'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'skills', 'mkt-overlap', 'SKILL.md'), '---\nname: WS Overlap\ndescription: test\n---\n')

    // Enabled marketplace plugin: install key "mkt-plugin@market", manifest name "mkt-plugin"
    const enabledInstall = join(claudeHome, 'plugins', 'cache', 'market', 'mkt-plugin', '1.0.0')
    mkdirSync(join(enabledInstall, '.claude-plugin'), { recursive: true })
    writeFileSync(join(enabledInstall, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'mkt-plugin', version: '1.0.0', skills: ['./skills/'] }))
    mkdirSync(join(enabledInstall, 'skills', 'mkt-skill'), { recursive: true })
    writeFileSync(join(enabledInstall, 'skills', 'mkt-skill', 'SKILL.md'), '---\nname: Mkt Skill\ndescription: test\n---\n')
    // Same plugin also ships "mkt-overlap" to verify workspace tier wins
    mkdirSync(join(enabledInstall, 'skills', 'mkt-overlap'), { recursive: true })
    writeFileSync(join(enabledInstall, 'skills', 'mkt-overlap', 'SKILL.md'), '---\nname: Plugin Overlap\ndescription: test\n---\n')

    // Project .agents skill with the same slug as the marketplace skill —
    // reproduces the `Unknown command: .agents:db-lens` hijack scenario
    mkdirSync(join(projectDir, '.agents', 'skills', 'mkt-skill'), { recursive: true })
    writeFileSync(join(projectDir, '.agents', 'skills', 'mkt-skill', 'SKILL.md'), '---\nname: Agents Shadow\ndescription: test\n---\n')

    // Disabled marketplace plugin with skill "mkt-hidden"
    const disabledInstall = join(claudeHome, 'plugins', 'cache', 'market', 'mkt-secret', '1.0.0')
    mkdirSync(join(disabledInstall, '.claude-plugin'), { recursive: true })
    writeFileSync(join(disabledInstall, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'mkt-secret', version: '1.0.0', skills: ['./skills/'] }))
    mkdirSync(join(disabledInstall, 'skills', 'mkt-hidden'), { recursive: true })
    writeFileSync(join(disabledInstall, 'skills', 'mkt-hidden', 'SKILL.md'), '---\nname: Hidden\ndescription: test\n---\n')

    writeFileSync(join(claudeHome, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: {
        'mkt-plugin@market': [{ scope: 'user', installPath: enabledInstall, version: '1.0.0' }],
        'mkt-secret@market': [{ scope: 'user', installPath: disabledInstall, version: '1.0.0' }],
      },
    }))
    writeFileSync(join(claudeHome, 'settings.json'), JSON.stringify({
      enabledPlugins: { 'mkt-plugin@market': true, 'mkt-secret@market': false },
    }))

    process.env.CLAUDE_CONFIG_DIR = claudeHome
    delete process.env.CRAFT_DISABLE_CLAUDE_PLUGINS
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
    if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    if (prevDisable === undefined) delete process.env.CRAFT_DISABLE_CLAUDE_PLUGINS
    else process.env.CRAFT_DISABLE_CLAUDE_PLUGINS = prevDisable
  })

  it('resolves an enabled marketplace plugin skill to pluginName:slug', () => {
    const result = qualifySkillName({ skill: 'mkt-skill' }, workspaceSlug, workspaceRoot)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'mkt-plugin:mkt-skill' })
  })

  it('does not modify a correctly qualified marketplace skill', () => {
    const result = qualifySkillName({ skill: 'mkt-plugin:mkt-skill' }, workspaceSlug, workspaceRoot)
    expect(result.modified).toBe(false)
    expect(result.input).toEqual({ skill: 'mkt-plugin:mkt-skill' })
  })

  it('re-qualifies a workspace-prefixed marketplace skill to the plugin namespace', () => {
    // Reproduces the reported bug: a marketplace skill emitted as
    // "{workspaceSlug}:mkt-skill" must be rewritten to "mkt-plugin:mkt-skill",
    // not left as an unknown workspace-namespaced command.
    const result = qualifySkillName({ skill: 'my-workspace:mkt-skill' }, workspaceSlug, workspaceRoot)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'mkt-plugin:mkt-skill' })
  })

  it('prefers an enabled marketplace skill over a same-slug .agents skill', () => {
    // `.agents:` is not an SDK-registered namespace — resolving there when the
    // marketplace copy exists produced `Unknown command: .agents:{slug}`.
    const result = qualifySkillName({ skill: 'mkt-skill' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'mkt-plugin:mkt-skill' })
  })

  it('keeps a correctly qualified marketplace skill despite a same-slug .agents skill', () => {
    const result = qualifySkillName({ skill: 'mkt-plugin:mkt-skill' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(false)
    expect(result.input).toEqual({ skill: 'mkt-plugin:mkt-skill' })
  })

  it('re-qualifies a .agents-prefixed skill to the marketplace namespace', () => {
    const result = qualifySkillName({ skill: `${AGENTS_PLUGIN_NAME}:mkt-skill` }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'mkt-plugin:mkt-skill' })
  })

  it('prefers a workspace skill over a same-named marketplace skill', () => {
    const result = qualifySkillName({ skill: 'mkt-overlap' }, workspaceSlug, workspaceRoot)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my-workspace:mkt-overlap' })
  })

  it('ignores a disabled marketplace plugin skill (falls back to workspace)', () => {
    const result = qualifySkillName({ skill: 'mkt-hidden' }, workspaceSlug, workspaceRoot)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my-workspace:mkt-hidden' })
  })

  it('respects CRAFT_DISABLE_CLAUDE_PLUGINS=1 (skips marketplace tier)', () => {
    process.env.CRAFT_DISABLE_CLAUDE_PLUGINS = '1'
    try {
      const result = qualifySkillName({ skill: 'mkt-skill' }, workspaceSlug, workspaceRoot)
      expect(result.input).toEqual({ skill: 'my-workspace:mkt-skill' })
    } finally {
      delete process.env.CRAFT_DISABLE_CLAUDE_PLUGINS
    }
  })
})

// ============================================================================
// resolveMarketplacePluginSkill — path hardening
//
// Plugin-declared skill roots (`skills` in plugin.json) must stay inside the
// plugin install dir. Absolute paths and `..` traversal are rejected so a
// manifest can't make existence checks probe outside its own directory.
// ============================================================================

describe('resolveMarketplacePluginSkill path hardening', () => {
  const testDir = join(tmpdir(), `mkt-hardening-test-${Date.now()}`)
  const claudeHome = join(testDir, '.claude')
  const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
  const prevDisable = process.env.CRAFT_DISABLE_CLAUDE_PLUGINS

  beforeAll(() => {
    // Control: plugin with a normal relative skills dir → resolves
    const goodInstall = join(claudeHome, 'plugins', 'cache', 'm', 'good', '1.0.0')
    mkdirSync(join(goodInstall, '.claude-plugin'), { recursive: true })
    writeFileSync(join(goodInstall, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'good', skills: ['./skills/'] }))
    mkdirSync(join(goodInstall, 'skills', 'good-skill'), { recursive: true })
    writeFileSync(join(goodInstall, 'skills', 'good-skill', 'SKILL.md'), '---\nname: Good\ndescription: t\n---\n')

    // Attack: parent-traversal skills dir, with a SKILL.md planted OUTSIDE installPath
    const evilInstall = join(claudeHome, 'plugins', 'cache', 'm', 'evil', '1.0.0')
    mkdirSync(join(evilInstall, '.claude-plugin'), { recursive: true })
    writeFileSync(join(evilInstall, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'evil', skills: ['../escape'] }))
    // ../escape relative to installPath → .../evil/escape (outside the 1.0.0 install dir)
    mkdirSync(join(evilInstall, '..', 'escape', 'esc-skill'), { recursive: true })
    writeFileSync(join(evilInstall, '..', 'escape', 'esc-skill', 'SKILL.md'), '---\nname: Esc\ndescription: t\n---\n')

    // Attack: absolute skills dir pointing at an external tree with a SKILL.md
    const absExternal = join(testDir, 'external-skills')
    mkdirSync(join(absExternal, 'abs-skill'), { recursive: true })
    writeFileSync(join(absExternal, 'abs-skill', 'SKILL.md'), '---\nname: Abs\ndescription: t\n---\n')
    const absInstall = join(claudeHome, 'plugins', 'cache', 'm', 'absp', '1.0.0')
    mkdirSync(join(absInstall, '.claude-plugin'), { recursive: true })
    writeFileSync(join(absInstall, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'absp', skills: [absExternal] }))

    writeFileSync(join(claudeHome, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: {
        'good@m': [{ scope: 'user', installPath: goodInstall, version: '1.0.0' }],
        'evil@m': [{ scope: 'user', installPath: evilInstall, version: '1.0.0' }],
        'absp@m': [{ scope: 'user', installPath: absInstall, version: '1.0.0' }],
      },
    }))
    writeFileSync(join(claudeHome, 'settings.json'), JSON.stringify({
      enabledPlugins: { 'good@m': true, 'evil@m': true, 'absp@m': true },
    }))

    process.env.CLAUDE_CONFIG_DIR = claudeHome
    delete process.env.CRAFT_DISABLE_CLAUDE_PLUGINS
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
    if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    if (prevDisable === undefined) delete process.env.CRAFT_DISABLE_CLAUDE_PLUGINS
    else process.env.CRAFT_DISABLE_CLAUDE_PLUGINS = prevDisable
  })

  it('resolves a plugin with a normal relative skills dir', () => {
    expect(resolveMarketplacePluginSkill('good-skill')).toBe('good:good-skill')
  })

  it('rejects parent-traversal skills dirs (no out-of-tree match)', () => {
    expect(resolveMarketplacePluginSkill('esc-skill')).toBeNull()
  })

  it('rejects absolute skills dirs (no out-of-tree match)', () => {
    expect(resolveMarketplacePluginSkill('abs-skill')).toBeNull()
  })
})

// ============================================================================
// resolveMarketplacePluginSkill — mtime-based caching
//
// The resolver is on the PreToolUse Skill hot path. Parsed manifests are
// memoized by the mtimes of installed_plugins.json + settings.json so repeated
// Skill calls don't re-read/parse every plugin manifest.
// ============================================================================

describe('resolveMarketplacePluginSkill caching', () => {
  const testDir = join(tmpdir(), `mkt-cache-test-${Date.now()}`)
  const claudeHome = join(testDir, '.claude')
  const settingsPath = join(claudeHome, 'settings.json')
  const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
  const prevDisable = process.env.CRAFT_DISABLE_CLAUDE_PLUGINS

  beforeAll(() => {
    const install = join(claudeHome, 'plugins', 'cache', 'm', 'cacheplug', '1.0.0')
    mkdirSync(join(install, '.claude-plugin'), { recursive: true })
    writeFileSync(join(install, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'cacheplug', skills: ['./skills/'] }))
    mkdirSync(join(install, 'skills', 'c-skill'), { recursive: true })
    writeFileSync(join(install, 'skills', 'c-skill', 'SKILL.md'), '---\nname: C\ndescription: t\n---\n')

    writeFileSync(join(claudeHome, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'cacheplug@m': [{ scope: 'user', installPath: install, version: '1.0.0' }] },
    }))
    writeFileSync(settingsPath, JSON.stringify({ enabledPlugins: { 'cacheplug@m': true } }))

    process.env.CLAUDE_CONFIG_DIR = claudeHome
    delete process.env.CRAFT_DISABLE_CLAUDE_PLUGINS
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
    if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    if (prevDisable === undefined) delete process.env.CRAFT_DISABLE_CLAUDE_PLUGINS
    else process.env.CRAFT_DISABLE_CLAUDE_PLUGINS = prevDisable
  })

  // NOTE: these two run in order — the first primes the cache, the second invalidates it.
  it('serves a cached result when config mtime is unchanged (ignores on-disk edits)', () => {
    const pinned = new Date('2026-01-01T00:00:00.000Z')
    utimesSync(settingsPath, pinned, pinned)

    // Prime the cache at this mtime
    expect(resolveMarketplacePluginSkill('c-skill')).toBe('cacheplug:c-skill')

    // Disable the plugin on disk, then re-pin the SAME mtime so the cache key is unchanged
    writeFileSync(settingsPath, JSON.stringify({ enabledPlugins: { 'cacheplug@m': false } }))
    utimesSync(settingsPath, pinned, pinned)

    // Cache hit: the on-disk disable is not observed
    expect(resolveMarketplacePluginSkill('c-skill')).toBe('cacheplug:c-skill')
  })

  it('invalidates the cache when config mtime advances', () => {
    const advanced = new Date('2026-01-01T00:00:10.000Z')
    utimesSync(settingsPath, advanced, advanced)
    // Cache key changed → disabled state is now observed
    expect(resolveMarketplacePluginSkill('c-skill')).toBeNull()
  })
})
