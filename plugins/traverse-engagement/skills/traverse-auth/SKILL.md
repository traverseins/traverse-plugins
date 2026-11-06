---
description: How to authenticate to Traverse services and configure credentials for Traverse MCP servers. Use whenever a Traverse plugin needs API access, when deciding which broker and agency an engagement is filed under (agency key vs. TRAVERSE_SERVICE key), when a Traverse MCP tool returns an authentication or 401 error, or when a user is first setting up Traverse credentials.
---

# Traverse authentication

This skill explains how credentials are supplied to this plugin's Traverse MCP
servers, and what to check when a tool reports an auth error. It ships inside
`traverse-engagement` rather than in a shared library plugin, because Cowork
does not install plugin dependencies. A skill this plugin depends on has to
travel with it.

## Credentials

Traverse MCP servers authenticate with an **API key sent in the
`X-Traverse-API-Key` header**, not with an `Authorization: Bearer` token — a
Bearer token is rejected with `401 unauthorized`. The key is read at MCP-server
startup via `${TRAVERSE_API_KEY}` substitution in each plugin's `.mcp.json`.

There are two ways to supply it. Both are read at MCP-server startup, so neither
takes effect until Claude Code restarts.

**A shell export** — for anyone who launches Claude Code from a terminal:

```bash
export TRAVERSE_API_KEY="<key issued from the Traverse console>"
```

**A settings file** — for anyone who opens the Desktop app or Cowork from the
app icon and never sees a shell. Add an `env` block to `~/.claude/settings.json`:

```json
{
  "env": {
    "TRAVERSE_API_KEY": "<key issued from the Traverse console>"
  }
}
```

User scope is the verified path. A project-scoped `.claude/settings.json` did
not reach the substitution in testing, so do not rely on it. `env` in settings
also covers background plugin auto-update and CI, which do not inherit an
interactive shell.

`~/.claude/settings.json` is plaintext in your home directory. Treat it as a
credential file: never commit it, and never put a production key in a
repository-scoped settings file.

Supplying the key connects the transport but does not by itself establish a
session. Call the `authenticate` tool first; the engagement tools return
`unauthenticated` until you do.

## Selecting an environment

`TRAVERSE_BASE_URL` selects which deployment the plugin talks to. It is the
**full URL of the MCP endpoint, path included** — the plugin appends nothing
to it.

| Environment | `TRAVERSE_BASE_URL`                                       |
| ----------- | --------------------------------------------------------- |
| Production  | `https://api.traverse-sys.com/mcp_engagements` (default)  |
| Staging     | `https://mcp-engagements.staging.trytraverse.com/mcp`     |
| Local       | `http://localhost:10471/mcp`                              |

Leaving it unset uses production. To work against staging:

```bash
export TRAVERSE_BASE_URL="https://mcp-engagements.staging.trytraverse.com/mcp"
```

It can also go in the same `~/.claude/settings.json` `env` block as the key.

Use the URL exactly as listed, path and all. Before 1.13.0 this variable held
the origin alone and the plugin added `/mcp`; an origin with no path now gets a
`404` and the server fails to connect. If an older value is still exported, add
the path or unset it.

## Who an engagement is filed under: read the key's `role`

Every engagement belongs to an **agency** and names a **broker of record**.
Where those come from depends on the kind of API key, so any flow that calls
`submit_engagement` has to know which kind it holds **before** it gathers
inputs. The `authenticate` response says so in `role`. Keep it for the run.

Authenticate at the start of the flow, not just before submitting. A flow that
learns the role after its confirmation gate has already shown the broker a
summary without the agency on it.

### Agency key (any `role` other than `TRAVERSE_SERVICE`)

- **Agency:** the organization the key was issued for. Traverse applies it from
  the session. **Never pass `broker.agencyOrgId`**, because the server refuses
  any agency on an agency key.
- **Broker:** `{ name, email }` of the person running the session. Don't ask for
  it.

### `TRAVERSE_SERVICE` key

A service key belongs to **no agency**, and its session identity is the key
itself (a name like `mcp-dds-stage-key` and an address ending
`@keys.traverse.com`), not a person. Nothing about the filing identity can come
from the session. Before the confirmation gate, collect all three of these from
the user, **typed in this session**:

| Field | Rule |
| --- | --- |
| `broker.name` | The real broker of record. |
| `broker.email` | That broker's own address. Never the key's `@keys.traverse.com` address, a shared or automation mailbox, or the signed-in user's address unless the user says that person is the broker. |
| `broker.agencyOrgId` | The agency's org id, exactly as typed. Echo it back for confirmation. There is no agency lookup tool, so the user has to supply it. |

Ask for them in one message: *"This is a Traverse service key, so I need the
broker of record and the agency to file this under: the broker's name and
email, and the agency's org id."*

> ### Never infer the filing identity
>
> Do not pre-fill the broker from the session or the signed-in user, and do not
> derive `agencyOrgId` from an email domain, an agency name, a document, or a
> previous engagement. An engagement filed under the wrong agency is visible to
> that agency's brokers and invisible to the right one. An engagement filed with
> no agency never resolves: reads answer `engagement_not_ready` indefinitely,
> and no submissions go to markets.
>
> If any of the three is missing, **stop and ask**. Never submit without them.

Then:

1. **Show them at the confirmation gate:** broker name, broker email and
   `agencyOrgId` on the summary, alongside the client.
2. **Submit** with `broker: { name, email, agencyOrgId }`.
3. **Verify the filing before reporting success.** Call `get_engagement` with
   the `engagementRequestId` to get the `engagement_id`, backing off ~5s, 15s,
   30s on `engagement_not_found` / `engagement_not_ready`. Then call
   `get_engagements { agencyOrgId }` and check that the `engagement_id` is
   listed. Report the `agencyName` it shows. If it never appears, say the
   engagement was submitted but is **not confirmed under that agency**, and do
   not present it as ready.

If the `authenticate` response carries no `role`, ask the user which kind of key
they are using rather than assuming.

## When a tool returns an auth error

1. Confirm `TRAVERSE_API_KEY` is set in the environment that launched Claude
   Code — not just in a shell opened afterwards.
2. Run `claude mcp list` and read the `traverse-engagements` line. It prints the
   URL after substitution: a literal `${TRAVERSE_BASE_URL}` there means the
   variable never reached the server. Note that **`✓ Connected` does not mean
   authenticated** — the service accepts the connection and rejects the
   credential later, so a connected server with an unset `TRAVERSE_API_KEY`
   looks healthy until a tool is called.
3. Confirm `authenticate` has been called in this session.
4. Re-run the failing tool. Do not paste the key into chat or into any file.
