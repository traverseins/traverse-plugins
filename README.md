# Traverse plugins for Claude

Plugins that let Claude work with [Traverse](https://www.traverseins.com). This
repository is a Claude plugin marketplace.

| Plugin | What it does |
| --- | --- |
| [`traverse-engagement`](plugins/traverse-engagement/README.md) | Guides a broker through a Traverse insurance placements engagement: gather client details, analyze documents against an agency coverage benchmark, upload supporting files, submit the engagement, and track its submissions, quotes, and tasks. |

## Install

### Claude Code (CLI) and the Desktop app's Code tab

```
/plugin marketplace add traverseins/traverse-plugins
/plugin install traverse-engagement@traverse-plugins
```

Then save your Traverse API key; see
[Credentials](plugins/traverse-engagement/README.md#credentials).

To update, run `/plugin marketplace update traverse-plugins`, then
`claude plugin update traverse-engagement@traverse-plugins`, and restart Claude
Code. Or turn on auto-update for this marketplace under `/plugin` → Marketplaces.

### Cowork

Open the **Cowork** tab, then **Customize** → **Plugins**. Under **Personal
plugins**, click **+** → **Add marketplace**, enter `traverseins/traverse-plugins`,
and install `traverse-engagement`.

### Your whole organization (Claude Team or Enterprise)

Claude does not accept a public repository as an organization marketplace, so
this one cannot be connected directly. Pick one of these instead.

**Upload the plugin file.** Each version's zip and its SHA-256 checksum are
attached to its [release](https://github.com/traverseins/traverse-plugins/releases).
Check the download, then upload it in **Organization settings** → **Plugins &
skills** → **Add** → **Upload a plugin**:

```bash
shasum -a 256 -c traverse-engagement-<version>.zip.sha256
```

To update, upload the new version's zip: a plugin with the same name replaces
the old one.

**List it from your own private marketplace repository.** Add this entry to the
`plugins` array in that repository's `.claude-plugin/marketplace.json`, and change
`ref` to the version you want. Organization sync fetches it without credentials.

```json
{
  "name": "traverse-engagement",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/traverseins/traverse-plugins.git",
    "path": "plugins/traverse-engagement",
    "ref": "traverse-engagement--v<version>"
  }
}
```

## Requirements

- A Traverse API key. See
  [Credentials](plugins/traverse-engagement/README.md#credentials).
- Node.js on the computer running Claude, because the plugin bundles a small
  local server that uploads documents. The supported versions are listed under
  [Prerequisites](plugins/traverse-engagement/README.md#prerequisites).

## Versions

Each release is tagged `traverse-engagement--v<version>`, matching the `version`
in the plugin's `.claude-plugin/plugin.json`. See the
[tags](https://github.com/traverseins/traverse-plugins/tags).

## About this repository

It is published automatically, so edits made here are overwritten. For help,
contact support@traverseins.com.
