# Terminal Mirror (Interactive CLI Sandbox) (still in MVP phase)

> A high-fidelity, AST-powered sandbox for Visual Studio Code that bridges the gap between CLI declaration and interactive execution.

Terminal Mirror transforms the developer experience by synthesizing static analysis and high-performance terminal emulation into a seamless feedback loop. Instead of treating your CLI as a "black box" where you have to constantly run `--help`, this extension reads your source code and automatically generates a dynamic, theme-aware GUI right inside your editor.

## Features

* **Semantic Introspection:** Automatically projects CLI structures (flags, arguments, and subcommands) into interactive webview elements. Designed to support Rust (`clap`), Python (`argparse`), and TypeScript (`yargs`) via Abstract Syntax Tree (AST) parsing.
* **Heuristic Fallback Engine:** A language-agnostic help-scraping engine that parses `--help` outputs to ensure universal compatibility with any executable binary.
* **Asynchronous Execution:** Utilizes non-blocking background processes (`child_process.spawn`) for real-time output streaming, fully supporting interactive `stdin` prompts.
* **High-Performance Terminal UI:** Integrates `xterm.js` for industry-standard terminal emulation, featuring full ANSI color support, custom keybindings, and hardware-accelerated rendering.
* **Native VS Code Theming:** Built with `vscode-elements` to perfectly inherit your editor's custom fonts, colors, and design tokens.
* **Throttled IPC Bridge:** Implements a buffered output model that prevents synchronous reflow and UI freezing, even when a command floods the terminal with millions of messages.

## Getting Started (Local Development)

Currently, Terminal Mirror is in active development. To run the MVP locally on your machine:

1. **Clone the repository and install dependencies:**
   ```bash
   git clone https://github.com/Rakshat28/TMirror/tree/main
   cd TMIRROR
   npm install
   ```

2. **Launch the Extension Development Host:**
   * Open the project folder in Visual Studio Code.
   * Press `F5` (or click **Run > Start Debugging**).
   * A new VS Code window will open with the extension loaded.

3. **Activate the Sandbox:**
   * In the new window, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
   * Search for and execute the activation command (e.g., `Terminal Mirror: Start`).
   * The sandbox UI will open in your sidebar or editor panel.

## Architecture

The extension relies on a strict separation of concerns:
* **Extension Host (Node.js):** Handles file system access, parses AST metadata, spawns native OS processes, and throttles data output.
* **Webview UI (Chromium):** Renders the graphical inputs using Lit-based web components and handles raw byte-stream rendering via `xterm.js`.
* **IPC Bridge:** A strictly typed, bidirectional message-passing interface (`postMessage`) secured by a Content Security Policy (CSP) and session-unique nonces to prevent XSS.

## Tech Stack

* **Extension API:** TypeScript, Node.js (`child_process`)
* **Frontend:** HTML, CSS, JavaScript, `vscode-elements`
* **Terminal Emulation:** `xterm.js`
* **Parsing:** `syn` (Rust), `ast` (Python), TS Compiler API
