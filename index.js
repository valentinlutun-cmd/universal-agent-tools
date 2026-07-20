"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class AgenticServer {
    server;
    constructor() {
        this.server = new index_js_1.Server({
            name: "zed-agentic-tools",
            version: "1.0.0",
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
        // Error handling
        this.server.onerror = (error) => console.error("[MCP Error]", error);
        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    setupToolHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "run_terminal_command",
                    description: "Execute a shell command. Always use this to interact with the environment.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            command: {
                                type: "string",
                                description: "The terminal command to execute",
                            },
                            cwd: {
                                type: "string",
                                description: "The working directory (optional)",
                            },
                        },
                        required: ["command"],
                    },
                },
                {
                    name: "read_file",
                    description: "Read the contents of a file",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filePath: { type: "string" },
                        },
                        required: ["filePath"],
                    },
                },
                {
                    name: "write_file",
                    description: "Write content to a file",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filePath: { type: "string" },
                            content: { type: "string" },
                        },
                        required: ["filePath", "content"],
                    },
                },
                {
                    name: "replace_file_content",
                    description: "Replace a specific block of text in a file. Very precise.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filePath: { type: "string" },
                            targetText: { type: "string", description: "The exact text to replace" },
                            replacementText: { type: "string", description: "The new text" },
                        },
                        required: ["filePath", "targetText", "replacementText"],
                    },
                },
            ],
        }));
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            try {
                switch (request.params.name) {
                    case "run_terminal_command": {
                        const { command, cwd } = request.params.arguments;
                        try {
                            const { stdout, stderr } = await execAsync(command, { cwd });
                            return {
                                content: [{ type: "text", text: `STDOUT:\n${stdout}\nSTDERR:\n${stderr}` }],
                            };
                        }
                        catch (error) {
                            return {
                                content: [{ type: "text", text: `Command failed: ${error.message}\nSTDOUT:\n${error.stdout}\nSTDERR:\n${error.stderr}` }],
                                isError: true,
                            };
                        }
                    }
                    case "read_file": {
                        const { filePath } = request.params.arguments;
                        const content = await fs.readFile(filePath, "utf-8");
                        return { content: [{ type: "text", text: content }] };
                    }
                    case "write_file": {
                        const { filePath, content } = request.params.arguments;
                        await fs.mkdir(path.dirname(filePath), { recursive: true });
                        await fs.writeFile(filePath, content, "utf-8");
                        return { content: [{ type: "text", text: `Successfully wrote to ${filePath}` }] };
                    }
                    case "replace_file_content": {
                        const { filePath, targetText, replacementText } = request.params.arguments;
                        const content = await fs.readFile(filePath, "utf-8");
                        if (!content.includes(targetText)) {
                            throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidParams, "Target text not found in file");
                        }
                        const newContent = content.replace(targetText, replacementText);
                        await fs.writeFile(filePath, newContent, "utf-8");
                        return { content: [{ type: "text", text: `Successfully replaced content in ${filePath}` }] };
                    }
                    default:
                        throw new types_js_1.McpError(types_js_1.ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
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
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error("Zed Agentic MCP Server running on stdio");
    }
}
const server = new AgenticServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map