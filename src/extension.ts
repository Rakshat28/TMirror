import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { JsonSchema, spawnInteractiveCommand, scrapeHelpToJsonSchema, SpawnedSession } from './execution/spawnWrapper';

const VIEW_ID = 'interactiveCliSandbox.view';

type WebviewIncomingMessage =
  | { type: 'webviewReady' }
  | { type: 'runCommand'; commandLine: string }
  | { type: 'stdin'; data: string }
  | { type: 'scrapeHelp'; commandLine: string }
  | { type: 'stopCommand' };

class InteractiveCliSandboxViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private currentSession?: SpawnedSession;
  private outputBuffer = '';
  private flushTimer?: NodeJS.Timeout;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules')
      ]
    };

    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: WebviewIncomingMessage) => {
      void this.handleWebviewMessage(message);
    });

    webviewView.onDidDispose(() => {
      this.stopActiveSession();
      this.stopFlushLoop();
      this.view = undefined;
    });
  }

  public reveal(): void {
    this.view?.show?.(true);
  }

  public async runBaselineCommand(): Promise<void> {
    const config = vscode.workspace.getConfiguration('interactiveCliSandbox');
    const defaultCommand = config.get<string>('defaultCommand', 'ls');
    await this.startCommand(defaultCommand);
  }

  private async handleWebviewMessage(message: WebviewIncomingMessage): Promise<void> {
    switch (message.type) {
      case 'webviewReady':
        await this.runBaselineCommand();
        break;
      case 'runCommand':
        await this.startCommand(message.commandLine);
        break;
      case 'stdin':
        this.currentSession?.process.stdin.write(message.data);
        break;
      case 'scrapeHelp':
        await this.handleHelpScrape(message.commandLine);
        break;
      case 'stopCommand':
        this.stopActiveSession();
        break;
      default:
        break;
    }
  }

  private async handleHelpScrape(commandLine: string): Promise<void> {
    const parsed = parseCommandLine(commandLine);
    if (!parsed) {
      this.postMessage({ type: 'schemaError', message: 'No executable provided.' });
      return;
    }

    const config = vscode.workspace.getConfiguration('interactiveCliSandbox');
    const cwd = this.getConfiguredCwd(config);
    const helpFlag = config.get<string>('helpFlag', '--help');

    try {
      const schema: JsonSchema = await scrapeHelpToJsonSchema(parsed.command, parsed.args, helpFlag, {
        cwd,
        timeoutMs: 7000
      });
      this.postMessage({ type: 'schema', schema });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage({ type: 'schemaError', message });
    }
  }

  private async startCommand(commandLine: string): Promise<void> {
    const parsed = parseCommandLine(commandLine);
    if (!parsed) {
      this.postMessage({ type: 'status', value: 'No command provided.' });
      return;
    }

    this.stopActiveSession();
    this.outputBuffer = '';

    const config = vscode.workspace.getConfiguration('interactiveCliSandbox');
    const cwd = this.getConfiguredCwd(config);

    try {
      this.currentSession = spawnInteractiveCommand(parsed.command, parsed.args, { cwd });
      this.startFlushLoop();

      this.postMessage({
        type: 'status',
        value: `Running: ${parsed.command}${parsed.args.length ? ` ${parsed.args.join(' ')}` : ''}`
      });

      this.currentSession.process.stdout.on('data', (chunk: Buffer) => {
        this.outputBuffer += chunk.toString();
      });

      this.currentSession.process.stderr.on('data', (chunk: Buffer) => {
        this.outputBuffer += chunk.toString();
      });

      this.currentSession.process.on('error', (error: Error) => {
        this.outputBuffer += `\r\n[spawn error] ${error.message}\r\n`;
      });

      this.currentSession.process.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        this.outputBuffer += `\r\n[process exited] code=${code ?? 'null'} signal=${signal ?? 'none'}\r\n`;
        this.flushBufferNow();
        this.postMessage({ type: 'exit', code, signal });
        this.stopActiveSession();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputBuffer += `\r\n[spawn failed] ${message}\r\n`;
      this.flushBufferNow();
      this.postMessage({ type: 'exit', code: -1, signal: null });
    }
  }

  private startFlushLoop(): void {
    this.stopFlushLoop();

    const config = vscode.workspace.getConfiguration('interactiveCliSandbox');
    const configuredHz = config.get<number>('maxIpcHz', 60);
    const samplingRate = Math.max(1, Math.min(60, configuredHz));
    const intervalMs = Math.max(1, Math.floor(1000 / samplingRate));

    this.flushTimer = setInterval(() => {
      this.flushBufferNow();
    }, intervalMs);
  }

  private flushBufferNow(): void {
    if (!this.outputBuffer) {
      return;
    }

    this.postMessage({ type: 'output', data: this.outputBuffer });
    this.outputBuffer = '';
  }

  private stopFlushLoop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  private stopActiveSession(): void {
    if (this.currentSession) {
      this.currentSession.stop();
      this.currentSession = undefined;
    }
  }

  private postMessage(payload: unknown): void {
    void this.view?.webview.postMessage(payload);
  }

  private getConfiguredCwd(config: vscode.WorkspaceConfiguration): string | undefined {
    const raw = config.get<string>('cwd', '').trim();
    if (raw) {
      return raw;
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const nonce = generateNonce(32);

    const webviewJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.js'));
    const xtermJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.js')
    );
    const xtermCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css')
    );
    const fitAddonUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@xterm', 'addon-fit', 'lib', 'addon-fit.js')
    );
    const vscodeElementsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode-elements', 'elements', 'dist', 'bundled.js')
    );

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`
    ].join('; ');

    const templateUri = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.html');
    const template = readFileSync(templateUri.fsPath, 'utf8');

    return template
      .replaceAll('__CSP__', csp)
      .replaceAll('__NONCE__', nonce)
      .replaceAll('__XTERM_CSS_URI__', xtermCssUri.toString())
      .replaceAll('__XTERM_JS_URI__', xtermJsUri.toString())
      .replaceAll('__FIT_ADDON_URI__', fitAddonUri.toString())
      .replaceAll('__VSCODE_ELEMENTS_URI__', vscodeElementsUri.toString())
      .replaceAll('__WEBVIEW_JS_URI__', webviewJsUri.toString());
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new InteractiveCliSandboxViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('interactiveCliSandbox.open', async () => {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      provider.reveal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('interactiveCliSandbox.runLs', async () => {
      await provider.runBaselineCommand();
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    })
  );
}

export function deactivate(): void {
}

function parseCommandLine(commandLine: string): { command: string; args: string[] } | null {
  const trimmed = commandLine.trim();
  if (!trimmed) {
    return null;
  }

  const tokens = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  if (tokens.length === 0) {
    return null;
  }

  const normalized = tokens.map((token) => token.replace(/^['"]|['"]$/g, ''));

  return {
    command: normalized[0],
    args: normalized.slice(1)
  };
}

function generateNonce(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < length; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}
