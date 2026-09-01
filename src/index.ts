#!/usr/bin/env node

import { ensureWorkingDirectory } from './utils/cwd.js';

// Before anything touches the filesystem: MCP clients often spawn this server
// from a directory that no longer exists (WSL mounts, deleted project folders),
// and Node then throws ENOENT/uv_cwd on the first fs call.
const workingDirectory = ensureWorkingDirectory();

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions } from './tools/definitions.js';
import { toolHandlers } from './tools/handlers.js';

const server = new Server(
  {
    name: 'mcp-adb',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: toolDefinitions,
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const handler = toolHandlers[name as keyof typeof toolHandlers];
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    return await handler(args);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `MCP ADB Server started (artifacts in ${workingDirectory.path}${
      workingDirectory.ok ? '' : ', recovered from an invalid working directory'
    })`
  );
}

main().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});