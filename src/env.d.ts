// SPDX-License-Identifier: AGPL-3.0-only
interface LocalToolArguments {
  id: string;
  input: string;
  option?: string;
}

interface Document {
  modelContext?: {
    registerTool(tool: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute(
        args: LocalToolArguments,
      ): Promise<{ tool: string; result: string }>;
    }): void | Promise<void>;
  };
}
