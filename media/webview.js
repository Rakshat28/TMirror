(() => {
  const vscode = acquireVsCodeApi();

  const state = vscode.getState() ?? {};

  const terminalContainer = document.getElementById('terminal');
  const schemaBox = document.getElementById('schema');
  const statusNode = document.getElementById('status');
  const commandInput = document.getElementById('commandInput');
  const runBtn = document.getElementById('runBtn');
  const stopBtn = document.getElementById('stopBtn');
  const scrapeBtn = document.getElementById('scrapeBtn');
  const autoHelp = document.getElementById('autoHelp');
  const samplingRate = document.getElementById('samplingRate');

  if (state.commandLine) {
    commandInput.value = state.commandLine;
  }

  const terminal = new Terminal({
    convertEol: true,
    cursorBlink: true,
    fontFamily: getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-family').trim() || 'monospace',
    fontSize: Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-size')) || 13,
    theme: {
      foreground: getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground').trim() || '#cccccc',
      background: getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e'
    }
  });

  const fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalContainer);
  fitAddon.fit();

  window.addEventListener('resize', () => {
    fitAddon.fit();
  });

  terminal.onData((data) => {
    vscode.postMessage({ type: 'stdin', data });
  });

  runBtn.addEventListener('click', () => {
    const commandLine = String(commandInput.value || '').trim();
    if (!commandLine) {
      setStatus('Command is empty.');
      return;
    }

    terminal.reset();
    vscode.postMessage({ type: 'runCommand', commandLine });

    if (autoHelp.checked) {
      vscode.postMessage({ type: 'scrapeHelp', commandLine });
    }

    persistState(commandLine);
  });

  stopBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'stopCommand' });
  });

  scrapeBtn.addEventListener('click', () => {
    const commandLine = String(commandInput.value || '').trim();
    if (!commandLine) {
      setStatus('Command is empty.');
      return;
    }

    vscode.postMessage({ type: 'scrapeHelp', commandLine });
    persistState(commandLine);
  });

  samplingRate.addEventListener('change', () => {
    setStatus(`IPC is clamped by extension settings to <= 60Hz. Selected: ${samplingRate.value}Hz`);
  });

  window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.type) {
      case 'output':
        terminal.write(message.data);
        break;
      case 'status':
        setStatus(message.value);
        break;
      case 'schema':
        schemaBox.textContent = JSON.stringify(message.schema, null, 2);
        break;
      case 'schemaError':
        schemaBox.textContent = `Schema parse error: ${message.message}`;
        break;
      case 'exit':
        setStatus(`Exited. code=${message.code} signal=${message.signal ?? 'none'}`);
        break;
      default:
        break;
    }
  });

  vscode.postMessage({ type: 'webviewReady' });

  function setStatus(text) {
    statusNode.textContent = text;
  }

  function persistState(commandLine) {
    vscode.setState({ commandLine });
  }
})();
