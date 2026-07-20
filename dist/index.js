import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError, } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
const execAsync = promisify(exec);
class UniversalAgenticServer {
    server;
    constructor() {
        this.server = new Server({
            name: "universal-agent-tools",
            version: "1.1.0",
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
        this.server.onerror = (error) => console.error("[MCP Error]", error);
        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "Shell",
                    description: "Execute a shell command in the background or wait for it. High buffer capacity.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            command: { type: "string", description: "The terminal command to execute" },
                            cwd: { type: "string", description: "The working directory (optional)" },
                        },
                        required: ["command"],
                    },
                },
                {
                    name: "Read",
                    description: "Read the contents of a file",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filePath: { type: "string", description: "Absolute or relative path to the file" },
                        },
                        required: ["filePath"],
                    },
                },
                {
                    name: "Write",
                    description: "Write content to a file, safely creating directories if needed",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filePath: { type: "string", description: "Absolute or relative path to the file" },
                            content: { type: "string", description: "The complete content to write" },
                        },
                        required: ["filePath", "content"],
                    },
                },
                {
                    name: "StrReplace",
                    description: "Makes a precise, targeted edit to an existing file. Use this for surgical edits.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filePath: { type: "string" },
                            targetText: { type: "string", description: "The exact text to replace (including exact whitespace/newlines)" },
                            replacementText: { type: "string", description: "The new text to insert" },
                            replaceAll: { type: "boolean", description: "Whether to replace all occurrences. Defaults to false." }
                        },
                        required: ["filePath", "targetText", "replacementText"],
                    },
                },
                {
                    name: "Delete",
                    description: "Delete a file or empty directory",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filePath: { type: "string" },
                        },
                        required: ["filePath"],
                    },
                },
                // WebSearch stub so Atomic Chat doesn't fail hard if it tries to search
                {
                    name: "WebSearch",
                    description: "Search the web (Currently a Stub)",
                    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
                }
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                switch (request.params.name) {
                    case "Shell":
                    case "AwaitShell": {
                        const { command, cwd } = request.params.arguments;
                        try {
                            // 10MB buffer to prevent crashing on large output like npm install
                            const { stdout, stderr } = await execAsync(command, { cwd, maxBuffer: 1024 * 1024 * 10 });
                            return {
                                content: [{ type: "text", text: `STDOUT:\n${stdout}\nSTDERR:\n${stderr}` }],
                            };
                        }
                        catch (error) {
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `Command failed: ${error.message}\nSTDOUT:\n${error.stdout}\nSTDERR:\n${error.stderr}`,
                                    },
                                ],
                                isError: true,
                            };
                        }
                    }
                    case "Read": {
                        const { filePath } = request.params.arguments;
                        try {
                            const content = await fs.readFile(filePath, "utf-8");
                            return { content: [{ type: "text", text: content }] };
                        }
                        catch (err) {
                            return { content: [{ type: "text", text: `Failed to read file: ${err.message}` }], isError: true };
                        }
                    }
                    case "Write": {
                        const { filePath, content } = request.params.arguments;
                        try {
                            await fs.mkdir(path.dirname(filePath), { recursive: true });
                            await fs.writeFile(filePath, content, "utf-8");
                            return { content: [{ type: "text", text: `Successfully wrote to ${filePath}` }] };
                        }
                        catch (err) {
                            return { content: [{ type: "text", text: `Failed to write file: ${err.message}` }], isError: true };
                        }
                    }
                    case "StrReplace": {
                        const { filePath, targetText, replacementText, replaceAll } = request.params.arguments;
                        try {
                            const content = await fs.readFile(filePath, "utf-8");
                            // Normalize line endings to help match properly in case of CRLF vs LF mismatches
                            const normalizedContent = content.replace(/\r\n/g, '\n');
                            const normalizedTarget = targetText.replace(/\r\n/g, '\n');
                            if (!normalizedContent.includes(normalizedTarget)) {
                                return { content: [{ type: "text", text: "Target text not found in file. Ensure exact match including whitespace." }], isError: true };
                            }
                            let newContent = content;
                            if (replaceAll) {
                                // Split and join to replace all instances accurately
                                newContent = normalizedContent.split(normalizedTarget).join(replacementText);
                            }
                            else {
                                newContent = normalizedContent.replace(normalizedTarget, replacementText);
                            }
                            await fs.writeFile(filePath, newContent, "utf-8");
                            return { content: [{ type: "text", text: `Successfully replaced content in ${filePath}` }] };
                        }
                        catch (err) {
                            return { content: [{ type: "text", text: `Failed to replace content: ${err.message}` }], isError: true };
                        }
                    }
                    case "Delete": {
                        const { filePath } = request.params.arguments;
                        try {
                            await fs.rm(filePath, { recursive: true, force: true });
                            return { content: [{ type: "text", text: `Successfully deleted ${filePath}` }] };
                        }
                        catch (err) {
                            return { content: [{ type: "text", text: `Failed to delete file: ${err.message}` }], isError: true };
                        }
                    }
                    case "WebSearch": {
                        return { content: [{ type: "text", text: "WebSearch is currently stubbed and not implemented in this MCP." }] };
                    }
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
                }
            }
            catch (error) {
                return {
                    content: [{ type: "text", text: `Tool error: ${error.message}` }],
                    isError: true,
                };
            }
        });
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("Universal Agentic MCP Server running on stdio");
    }
}
const server = new UniversalAgenticServer();
server.run().catch(console.error);
