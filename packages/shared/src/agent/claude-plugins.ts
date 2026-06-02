import { homedir } from 'node:os';
import { join, isAbsolute, resolve, sep } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { debug } from '../utils/debug.ts';

type SdkPluginConfig = NonNullable<Options['plugins']>[number];

interface InstalledPluginEntry {
  scope: 'user' | 'project';
  installPath: string;
  version: string;
}

interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, InstalledPluginEntry[]>;
}

interface ClaudeSettingsFile {
  enabledPlugins?: Record<string, boolean>;
}

/**
 * Read install paths of enabled Claude Code CLI marketplace plugins.
 *
 * Reads:
 *   $CLAUDE_CONFIG_DIR/plugins/installed_plugins.json  (install paths)
 *   $CLAUDE_CONFIG_DIR/settings.json                   (enabledPlugins map)
 *
 * Returns the install path of each enabled plugin (keyed by its marketplace
 * install key, e.g. `jira@ai-tools-engineering`). Silently returns [] on any
 * read/parse error so the agent still boots.
 *
 * Set CRAFT_DISABLE_CLAUDE_PLUGINS=1 to force-disable (CI / multi-tenant).
 */
function readEnabledPluginInstallPaths(): Array<{ key: string; installPath: string }> {
  if (process.env.CRAFT_DISABLE_CLAUDE_PLUGINS === '1') {
    debug('[claude-plugins] disabled by CRAFT_DISABLE_CLAUDE_PLUGINS=1');
    return [];
  }

  try {
    const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
    const installedFile = join(claudeHome, 'plugins', 'installed_plugins.json');
    const settingsFile = join(claudeHome, 'settings.json');

    if (!existsSync(installedFile)) {
      debug('[claude-plugins] no installed_plugins.json — skipping plugin load');
      return [];
    }

    const installed = JSON.parse(readFileSync(installedFile, 'utf8')) as InstalledPluginsFile;
    const enabled: Record<string, boolean> = existsSync(settingsFile)
      ? (JSON.parse(readFileSync(settingsFile, 'utf8')) as ClaudeSettingsFile).enabledPlugins ?? {}
      : {};

    const paths: Array<{ key: string; installPath: string }> = [];
    for (const [pluginKey, entries] of Object.entries(installed.plugins ?? {})) {
      if (enabled[pluginKey] !== true) continue;
      const entry = entries[0];
      if (!entry?.installPath) continue;
      paths.push({ key: pluginKey, installPath: entry.installPath });
    }
    return paths;
  } catch (err) {
    debug('[claude-plugins] discovery failed:', err);
    return [];
  }
}

/**
 * Discover plugins installed via the Claude Code CLI marketplace.
 *
 * Returns SdkPluginConfig[] suitable for the SDK's `plugins` option, one entry
 * per enabled plugin that has a readable `.claude-plugin/plugin.json` manifest.
 */
export function discoverEnabledClaudePlugins(): SdkPluginConfig[] {
  const result: SdkPluginConfig[] = [];
  for (const { key, installPath } of readEnabledPluginInstallPaths()) {
    if (!existsSync(join(installPath, '.claude-plugin', 'plugin.json'))) {
      debug(`[claude-plugins] manifest missing for ${key} at ${installPath}`);
      continue;
    }
    result.push({ type: 'local', path: installPath });
  }

  debug(`[claude-plugins] loading ${result.length} enabled plugins: ${result.map(p => p.path).join(', ')}`);
  return result;
}

interface EnabledPluginManifest {
  installPath: string;
  name: string;
  skillDirs: string[];
}

interface PluginManifestCacheEntry {
  configDir: string;
  installedMtimeMs: number;
  settingsMtimeMs: number;
  plugins: EnabledPluginManifest[];
}

// Memoized parse of enabled-plugin manifests. Invalidated when either Claude
// config file changes (by mtime) or CLAUDE_CONFIG_DIR is repointed, so the
// PreToolUse Skill hot path doesn't re-read/parse N files on every invocation.
let manifestCache: PluginManifestCacheEntry | null = null;

function safeMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Normalize and validate plugin-declared skill roots, keeping only relative
 * directories that resolve inside the plugin install dir. Rejects absolute
 * paths and `..` traversal so a manifest can't make existence checks escape
 * its own directory. Defaults to the conventional `skills/` when unspecified.
 */
function sanitizeSkillDirs(rawSkills: unknown, installPath: string): string[] {
  const candidates = Array.isArray(rawSkills) && rawSkills.length > 0
    ? rawSkills.filter((d): d is string => typeof d === 'string')
    : ['skills'];

  const root = resolve(installPath);
  const safe: string[] = [];
  for (const dir of candidates) {
    if (!dir || isAbsolute(dir)) continue;
    const resolved = resolve(root, dir);
    if (resolved !== root && !resolved.startsWith(root + sep)) continue;
    safe.push(dir);
  }
  return safe;
}

/**
 * Parsed manifests of all enabled marketplace plugins, memoized by the mtimes
 * of installed_plugins.json + settings.json. Honors CRAFT_DISABLE_CLAUDE_PLUGINS=1.
 */
function getEnabledPluginManifests(): EnabledPluginManifest[] {
  if (process.env.CRAFT_DISABLE_CLAUDE_PLUGINS === '1') return [];

  const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const installedMtimeMs = safeMtimeMs(join(claudeHome, 'plugins', 'installed_plugins.json'));
  const settingsMtimeMs = safeMtimeMs(join(claudeHome, 'settings.json'));

  if (
    manifestCache &&
    manifestCache.configDir === claudeHome &&
    manifestCache.installedMtimeMs === installedMtimeMs &&
    manifestCache.settingsMtimeMs === settingsMtimeMs
  ) {
    return manifestCache.plugins;
  }

  const plugins: EnabledPluginManifest[] = [];
  for (const { installPath } of readEnabledPluginInstallPaths()) {
    try {
      const manifestPath = join(installPath, '.claude-plugin', 'plugin.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string; skills?: unknown };
      if (!manifest.name) continue;
      const skillDirs = sanitizeSkillDirs(manifest.skills, installPath);
      if (skillDirs.length === 0) continue;
      plugins.push({ installPath, name: manifest.name, skillDirs });
    } catch {
      // Skip unreadable/malformed plugin manifest
    }
  }

  manifestCache = { configDir: claudeHome, installedMtimeMs, settingsMtimeMs, plugins };
  return plugins;
}

/**
 * Resolve a bare skill slug to its marketplace plugin namespace (`pluginName:slug`).
 *
 * The SDK namespaces plugin skills by the plugin manifest's `name` field, NOT by
 * the marketplace install key (e.g. install key `jira@ai-tools-engineering` →
 * plugin name `jira` → skill `jira:jira`). Scans each enabled plugin's validated
 * skill directories for `{slug}/SKILL.md`.
 *
 * @returns `${pluginName}:${bareSlug}` if a matching enabled plugin skill exists, else null.
 */
export function resolveMarketplacePluginSkill(bareSlug: string): string | null {
  for (const { installPath, name, skillDirs } of getEnabledPluginManifests()) {
    for (const dir of skillDirs) {
      if (existsSync(join(installPath, dir, bareSlug, 'SKILL.md'))) {
        return `${name}:${bareSlug}`;
      }
    }
  }
  return null;
}
