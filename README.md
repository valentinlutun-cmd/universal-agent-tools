Universal Agent Tools
A lightweight, highly robust Model Context Protocol (MCP) server providing universal IDE capabilities for local AI agents (e.g., LM Studio, Atomic Chat, Claude).
## 🚀 Features
- **Bulletproof Shell Execution (`Shell`)**: Includes a massive 10MB memory buffer so agents can run heavy compilation or installation commands without crashing.
- **Surgical Text Replacement (`StrReplace`)**: Bulletproof string replacement that automatically normalizes Windows (`\r\n`) and Linux (`\n`) line endings to prevent AI editing failures.
- **Safe File Operations (`Read`, `Write`, `Delete`)**: Automatically creates missing parent directories safely when writing files. 
- **Universal Compatibility**: Works effortlessly across Windows and Linux environments.
## 🛠️ Installation & Setup
1. Clone this repository.
2. Run `npm install` to download the required dependencies.
3. Hook it into your AI frontend by pointing your MCP configuration to the compiled `dist/index.js` file.
