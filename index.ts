import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as http from "http";
import * as https from "https";

const execAsync = promisify(exec);
const MAX_SHELL_BUFFER = 1024 * 1024 * 10;
const MAX_FETCH_BYTES = 1024 * 1024 * 2;

type TextResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(text: string): TextResult {
  return { content: [{ type: "text", text }] };
}

function fail(text: string): TextResult {
  return { content: [{ type: "text", text }], isError: true };
}

function detectEol(sample: string): "\r\n" | "\n" {
  return sample.includes("\r\n") ? "\r\n" : "\n";
}

function toLf(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

function fromLf(s: string, eol: "\r\n" | "\n"): string {
  return eol === "\r\n" ? s.replace(/\n/g, "\r\n") : s;
}

async function walkFiles(root: string, max = 500): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    if (out.length >= max) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= max) return;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".trash") continue;
        await walk(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }
  const st = await fs.stat(root);
  if (st.isFile()) return [root];
  await walk(root);
  return out;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  let re = "";
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === "*" && normalized[i + 1] === "*") {
      re += ".*";
      i++;
      if (normalized[i + 1] === "/") i++;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^$()[]{}|".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$", "i");
}

async function trashPath(filePath: string): Promise<string> {
  const abs = path.resolve(filePath);
  const trashDir = path.join(path.dirname(abs), ".trash");
  await fs.mkdir(trashDir, { recursive: true });
  let dest = path.join(trashDir, path.basename(abs));
  if (fsSync.existsSync(dest)) {
    const stamp = Date.now();
    dest = path.join(trashDir, `${path.parse(abs).name}_${stamp}${path.parse(abs).ext}`);
  }
  await fs.rename(abs, dest);
  return dest;
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location).then(resolve, reject);
        res.resume();
        return;
      }
      if ((res.statusCode ?? 500) >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_FETCH_BYTES) {
          req.destroy();
          reject(new Error("response too large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });
    req.on("error", reject);
  });
}

class UniversalAgenticServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "universal-agent-tools",
        version: "1.2.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "Shell",
          description:
            "Execute a shell command. On Windows use cmd/PowerShell (dir, findstr, mkdir, powershell -Command). Avoid bash-only: head, grep, mkdir -p, ls, cat, rm. 10MB output buffer.",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "string", description: "The terminal command to execute" },
              cwd: { type: "string", description: "Working directory (optional)" },
            },
            required: ["command"],
          },
        },
        {
          name: "AwaitShell",
          description: "Alias of Shell — wait for command completion.",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "string" },
              cwd: { type: "string" },
            },
            required: ["command"],
          },
        },
        {
          name: "Read",
          description: "Read the contents of a text file",
          inputSchema: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "Absolute or relative path to the file" },
              path: { type: "string", description: "Alias of filePath" },
            },
          },
        },
        {
          name: "Write",
          description: "Write content to a file, creating parent directories if needed",
          inputSchema: {
            type: "object",
            properties: {
              filePath: { type: "string" },
              path: { type: "string" },
              content: { type: "string" },
              contents: { type: "string" },
            },
          },
        },
        {
          name: "StrReplace",
          description:
            "Surgical edit. Normalizes CRLF/LF for matching, then restores the file's original line endings.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: { type: "string" },
              path: { type: "string" },
              targetText: { type: "string" },
              old_string: { type: "string" },
              replacementText: { type: "string" },
              new_string: { type: "string" },
              replaceAll: { type: "boolean" },
            },
          },
        },
        {
          name: "Delete",
          description:
            "Move a file into a sibling .trash folder (not permanent delete). Refuses to wipe directories recursively.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: { type: "string" },
              path: { type: "string" },
            },
          },
        },
        {
          name: "ListDir",
          description: "List names in a directory",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" },
              filePath: { type: "string" },
            },
          },
        },
        {
          name: "Glob",
          description: "Find files under a root matching a glob (* and ** supported)",
          inputSchema: {
            type: "object",
            properties: {
              pattern: { type: "string" },
              path: { type: "string", description: "Root directory (default: cwd)" },
            },
            required: ["pattern"],
          },
        },
        {
          name: "Grep",
          description: "Search text file contents for a regex",
          inputSchema: {
            type: "object",
            properties: {
              pattern: { type: "string" },
              path: { type: "string" },
            },
            required: ["pattern"],
          },
        },
        {
          name: "TodoWrite",
          description: "Record a short todo list (returned back; no disk required)",
          inputSchema: {
            type: "object",
            properties: {
              todos: { type: "array", items: { type: "string" } },
            },
            required: ["todos"],
          },
        },
        {
          name: "WebSearch",
          description: "Search stub — returns guidance to use WebFetch with a concrete URL",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
        {
          name: "WebFetch",
          description: "Fetch a URL as text (2MB cap)",
          inputSchema: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const args = (request.params.arguments ?? {}) as Record<string, unknown>;
        switch (request.params.name) {
          case "Shell":
          case "AwaitShell": {
            const command = String(args.command ?? "");
            const cwd = args.cwd ? String(args.cwd) : undefined;
            try {
              const { stdout, stderr } = await execAsync(command, {
                cwd,
                maxBuffer: MAX_SHELL_BUFFER,
                windowsHide: true,
              });
              return ok(`STDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
            } catch (error: any) {
              return fail(
                `Command failed: ${error.message}\nSTDOUT:\n${error.stdout ?? ""}\nSTDERR:\n${error.stderr ?? ""}`
              );
            }
          }
          case "Read": {
            const filePath = String(args.filePath ?? args.path ?? "");
            if (!filePath) return fail("filePath required");
            try {
              const content = await fs.readFile(filePath, "utf-8");
              return ok(content);
            } catch (err: any) {
              return fail(`Failed to read file: ${err.message}`);
            }
          }
          case "Write": {
            const filePath = String(args.filePath ?? args.path ?? "");
            const content = String(args.content ?? args.contents ?? "");
            if (!filePath) return fail("filePath required");
            try {
              await fs.mkdir(path.dirname(filePath), { recursive: true });
              await fs.writeFile(filePath, content, "utf-8");
              return ok(`Successfully wrote to ${filePath}`);
            } catch (err: any) {
              return fail(`Failed to write file: ${err.message}`);
            }
          }
          case "StrReplace": {
            const filePath = String(args.filePath ?? args.path ?? "");
            const targetText = String(args.targetText ?? args.old_string ?? "");
            const replacementText = String(args.replacementText ?? args.new_string ?? "");
            const replaceAll = Boolean(args.replaceAll);
            if (!filePath || !targetText) return fail("filePath and targetText required");
            try {
              const content = await fs.readFile(filePath, "utf-8");
              const eol = detectEol(content);
              const normalizedContent = toLf(content);
              const normalizedTarget = toLf(targetText);
              const normalizedReplacement = toLf(replacementText);
              if (!normalizedContent.includes(normalizedTarget)) {
                return fail("Target text not found in file. Ensure exact match including whitespace.");
              }
              let newLf: string;
              if (replaceAll) {
                newLf = normalizedContent.split(normalizedTarget).join(normalizedReplacement);
              } else {
                newLf = normalizedContent.replace(normalizedTarget, normalizedReplacement);
              }
              await fs.writeFile(filePath, fromLf(newLf, eol), "utf-8");
              return ok(`Successfully replaced content in ${filePath}`);
            } catch (err: any) {
              return fail(`Failed to replace content: ${err.message}`);
            }
          }
          case "Delete": {
            const filePath = String(args.filePath ?? args.path ?? "");
            if (!filePath) return fail("filePath required");
            try {
              const st = await fs.stat(filePath);
              if (st.isDirectory()) {
                return fail("Delete refuses directories — move files individually into .trash");
              }
              const dest = await trashPath(filePath);
              return ok(`Moved to trash: ${dest}`);
            } catch (err: any) {
              return fail(`Failed to trash file: ${err.message}`);
            }
          }
          case "ListDir": {
            const dir = String(args.path ?? args.filePath ?? process.cwd());
            try {
              const names = await fs.readdir(dir);
              return ok(names.sort().join("\n") || "(empty)");
            } catch (err: any) {
              return fail(`Failed to list dir: ${err.message}`);
            }
          }
          case "Glob": {
            const pattern = String(args.pattern ?? "");
            const root = String(args.path ?? process.cwd());
            try {
              const rx = globToRegExp(pattern.includes("/") || pattern.includes("\\") ? pattern : `**/${pattern}`);
              const files = await walkFiles(root);
              const hits = files
                .map((f) => f.replace(/\\/g, "/"))
                .filter((f) => rx.test(f) || rx.test(path.basename(f).replace(/\\/g, "/")))
                .slice(0, 200);
              return ok(hits.join("\n") || "(no matches)");
            } catch (err: any) {
              return fail(`Glob failed: ${err.message}`);
            }
          }
          case "Grep": {
            const pattern = String(args.pattern ?? "");
            const root = String(args.path ?? process.cwd());
            try {
              const rx = new RegExp(pattern, "i");
              const files = await walkFiles(root, 300);
              const out: string[] = [];
              const textExt = new Set([
                ".txt", ".md", ".py", ".json", ".html", ".js", ".ts", ".css", ".bat", ".ps1", ".xml", ".yml", ".yaml",
              ]);
              for (const f of files) {
                if (out.length >= 80) break;
                if (!textExt.has(path.extname(f).toLowerCase())) continue;
                let text: string;
                try {
                  text = await fs.readFile(f, "utf-8");
                } catch {
                  continue;
                }
                const lines = text.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                  if (rx.test(lines[i])) {
                    out.push(`${f}:${i + 1}:${lines[i].slice(0, 160)}`);
                    if (out.length >= 80) break;
                  }
                }
              }
              return ok(out.join("\n") || "(no matches)");
            } catch (err: any) {
              return fail(`Grep failed: ${err.message}`);
            }
          }
          case "TodoWrite": {
            const todos = Array.isArray(args.todos) ? args.todos.map(String) : [];
            return ok(`ok: ${todos.length} todos\n` + todos.map((t, i) => `${i + 1}. ${t}`).join("\n"));
          }
          case "WebSearch": {
            return ok(
              `WebSearch stub. Query=${String(args.query ?? "")}. Use WebFetch with a concrete URL instead.`
            );
          }
          case "WebFetch": {
            const url = String(args.url ?? "");
            if (!/^https?:\/\//i.test(url)) return fail("url must start with http:// or https://");
            try {
              const body = await fetchText(url);
              return ok(body.slice(0, MAX_FETCH_BYTES));
            } catch (err: any) {
              return fail(`WebFetch failed: ${err.message}`);
            }
          }
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        }
      } catch (error: any) {
        return fail(`Tool error: ${error.message}`);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Universal Agentic MCP Server v1.2.0 running on stdio");
  }
}

const server = new UniversalAgenticServer();
server.run().catch(console.error);
