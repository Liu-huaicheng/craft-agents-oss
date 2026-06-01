import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
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

/**
 * Resolve a bare skill slug to its marketplace plugin namespace (`pluginName:slug`).
 *
 * The SDK namespaces plugin skills by the plugin manifest's `name` field, NOT by
 * the marketplace install key (e.g. install key `jira@ai-tools-engineering` →
 * plugin name `jira` → skill `jira:jira`). This scans each enabled plugin's
 * declared skill directories for `{slug}/SKILL.md`.
 *
 * @returns `${pluginName}:${bareSlug}` if a matching enabled plugin skill exists, else null.
 */
export function resolveMarketplacePluginSkill(bareSlug: string): string | null {
  for (const { installPath } of readEnabledPluginInstallPaths()) {
    try {
      const manifestPath = join(installPath, '.claude-plugin', 'plugin.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string; skills?: unknown };
      if (!manifest.name) continue;

      // Plugin manifests declare skill roots in `skills` (e.g. ["./skills/"]);
      // default to the conventional `skills/` directory when unspecified.
      const skillDirs = Array.isArray(manifest.skills) && manifest.skills.length > 0
        ? manifest.skills.filter((d): d is string => typeof d === 'string')
        : ['skills'];

      for (const dir of skillDirs) {
        if (existsSync(join(installPath, dir, bareSlug, 'SKILL.md'))) {
          return `${manifest.name}:${bareSlug}`;
        }
      }
    } catch {
      // Skip unreadable/malformed plugin manifest
    }
  }
  return null;
}
