import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

export type JsonSchemaProperty = {
  title: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  default?: string | number | boolean;
};

export type JsonSchema = {
  title: string;
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
};

export type SpawnedSession = {
  process: ChildProcessWithoutNullStreams;
  stop: () => void;
};

export function spawnInteractiveCommand(
  executable: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): SpawnedSession {
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: 'pipe',
    shell: false
  });

  return {
    process: child,
    stop: () => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    }
  };
}

export async function scrapeHelpToJsonSchema(
  executable: string,
  args: string[],
  helpFlag = '--help',
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<JsonSchema> {
  const timeoutMs = options.timeoutMs ?? 7000;

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, [...args, helpFlag], {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });

    let collected = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`Help scrape timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      collected += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      collected += chunk.toString();
    });

    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });

    child.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(collected);
      }
    });
  });

  return parseHelpTextToJsonSchema(output, executable);
}

export function parseHelpTextToJsonSchema(helpText: string, schemaTitle: string): JsonSchema {
  const flagRegex = /^\s*(-[a-zA-Z]),?\s*(--[a-zA-Z0-9-]+)/;
  const typeHintRegex = /(?<=<)[A-Z_]+(?=>)/;
  const defaultRegex = /\[default:\s*(.*)\]/;

  const properties: Record<string, JsonSchemaProperty> = {};

  for (const line of helpText.split(/\r?\n/)) {
    const flagMatch = line.match(flagRegex);
    if (!flagMatch) {
      continue;
    }

    const shortFlag = flagMatch[1];
    const longFlag = flagMatch[2];
    const propertyKey = longFlag.replace(/^--/, '').replace(/-/g, '_');

    const typeHint = line.match(typeHintRegex)?.[0];
    const defaultRaw = line.match(defaultRegex)?.[1]?.trim();

    const propertyType = normalizeType(typeHint);
    const defaultValue = normalizeDefault(defaultRaw, propertyType);

    const description = line
      .replace(flagMatch[0], '')
      .replace(defaultRegex, '')
      .trim();

    properties[propertyKey] = {
      title: `${longFlag} (${shortFlag})`,
      description: description || `Generated from help output for ${longFlag}.`,
      type: propertyType,
      ...(defaultValue !== undefined ? { default: defaultValue } : {})
    };
  }

  return {
    title: schemaTitle,
    type: 'object',
    properties
  };
}

function normalizeType(typeHint?: string): 'string' | 'number' | 'boolean' {
  const hint = typeHint?.toUpperCase() ?? '';

  if (['INT', 'INTEGER', 'FLOAT', 'DOUBLE', 'NUMBER', 'COUNT', 'PORT'].includes(hint)) {
    return 'number';
  }

  if (['BOOL', 'BOOLEAN', 'FLAG', 'SWITCH'].includes(hint)) {
    return 'boolean';
  }

  return 'string';
}

function normalizeDefault(
  rawDefault: string | undefined,
  type: 'string' | 'number' | 'boolean'
): string | number | boolean | undefined {
  if (!rawDefault) {
    return undefined;
  }

  if (type === 'number') {
    const asNumber = Number(rawDefault);
    return Number.isNaN(asNumber) ? undefined : asNumber;
  }

  if (type === 'boolean') {
    const lowered = rawDefault.toLowerCase();
    if (lowered === 'true') {
      return true;
    }
    if (lowered === 'false') {
      return false;
    }
    return undefined;
  }

  return rawDefault;
}
