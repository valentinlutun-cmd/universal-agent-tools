# universal-agent-tools MCP v1.2.0

Cursor-named agent tools for Atomic Chat / LM Studio / Cursor.

**Run:** `node dist/index.js` (stdio MCP)

## What changed in 1.2.0

- Added **ListDir / Glob / Grep / TodoWrite / WebFetch / AwaitShell**
- **Delete** moves into sibling `.trash` (no recursive force wipe)
- **StrReplace** restores original CRLF/LF after match
- Arg aliases: `path`/`filePath`, `contents`/`content`, `old_string`/`targetText`
- **Shell** description is Windows-first (dir/findstr; avoid bash-only commands)

## Tools (12 real)

Shell  
AwaitShell  
Read  
Write  
StrReplace  
Delete  
ListDir  
Glob  
Grep  
TodoWrite  
WebSearch  
WebFetch  

WebSearch is a stub. WebFetch is implemented.
