# Universal Agent Tools

Lightweight Model Context Protocol (MCP) server giving local AI agents IDE-style tools.

**Version: 1.2.0**

## Testing status

I tested this myself in **LM Studio** and **Zed**.

## Features

- **Shell / AwaitShell** — 10MB output buffer; Windows-first command guidance
- **Read / Write / StrReplace / Delete** — Write creates parent dirs; StrReplace normalizes CRLF/LF for matching then restores original endings; Delete moves files to a sibling `.trash` folder (not permanent wipe)
- **ListDir / Glob / Grep** — Discovery tools agents actually need
- **TodoWrite** — Lightweight todo list echo
- **WebFetch** — Fetch URL text (2MB cap); **WebSearch** is a stub pointing you to WebFetch

## Tools (12)

`Shell`, `AwaitShell`, `Read`, `Write`, `StrReplace`, `Delete`, `ListDir`, `Glob`, `Grep`, `TodoWrite`, `WebSearch`, `WebFetch`

## Setup

```bash
git clone https://github.com/valentinlutun-cmd/universal-agent-tools.git
cd universal-agent-tools
npm install
npm exec -- tsc -p tsconfig.json   # optional if dist/ is already present
```

Point your MCP client at the compiled entry:

```json
"universal-agent-tools": {
  "command": "node",
  "args": ["D:/path/to/universal-agent-tools/dist/index.js"]
}
```

On Windows you can use the full path to `node.exe` if needed.

## Notes

- Prefer `dist/index.js` as the MCP entry (not the root `index.js` leftover).
- See `TOOLS.md` for the short agent-facing list.