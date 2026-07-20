# universal-agent-tools MCP v1.1.0

Cursor-named agent tools for Atomic Chat / LM Studio / Cursor.

**Path:** `D:\PROJECTS\DATA\mcp\universal-agent-tools\`  
**Run:** `node dist\index.js` (stdio MCP)  
**Atomic / LM Studio entry:** `dist\index.js` (not root `index.js`)

## What changed in 1.1.0

- Copy/paste MCP that **provides universal IDE tools** (`Shell`, `Read`, `Write`, `StrReplace`, `Delete`, …)
- `Shell`: `maxBuffer` 10MB so heavy commands don’t crash the MCP
- `StrReplace`: CRLF/LF normalize + optional `replaceAll`
- `Write`: creates parent dirs; errors returned as text (no server crash)
- Server announces `universal-agent-tools` **1.1.0**

## Tools

Shell  
AwaitShell  
Read  
Write  
StrReplace  
Delete  
Glob  
Grep  
EditNotebook  
ReadLints  
WebSearch  
WebFetch  
GenerateImage  
Task  
TodoWrite  
AskQuestion  
SwitchMode  
GetMcpTools  
CallMcpTool  
FetchMcpResource  

Stubs (IDE-only): `GenerateImage`, `Task`, `AskQuestion`, `SwitchMode`, `ReadLints`, `FetchMcpResource`

## Wire into Zed (`%APPDATA%\Zed\settings.json`)

```json
"context_servers": {
  "universal-agent-tools": {
    "source": "custom",
    "command": "C:\\Program Files\\nodejs\\node.exe",
    "args": [
      "D:/PROJECTS/DATA/mcp/universal-agent-tools/dist/index.js"
    ]
  }
}
```

Uses `node_modules` copied from `zed-mcp-agent` (no build).
