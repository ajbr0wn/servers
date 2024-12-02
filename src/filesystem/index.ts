#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import os from 'os';
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Command line argument parsing
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: mcp-server-filesystem <allowed-directory> [additional-directories...]");
  process.exit(1);
}

// Normalize all paths consistently
function normalizePath(p: string): string {
  return path.normalize(p).toLowerCase();
}

function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

// Store allowed directories in normalized form
const allowedDirectories = args.map(dir => 
  normalizePath(path.resolve(expandHome(dir)))
);

// Validate that all directories exist and are accessible
await Promise.all(args.map(async (dir) => {
  try {
    const stats = await fs.stat(dir);
    if (!stats.isDirectory()) {
      console.error(`Error: ${dir} is not a directory`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error accessing directory ${dir}:`, error);
    process.exit(1);
  }
}));

// Security utilities
async function validatePath(requestedPath: string): Promise<string> {
  const expandedPath = expandHome(requestedPath);
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath);
    
  const normalizedRequested = normalizePath(absolute);

  // Check if path is within allowed directories
  const isAllowed = allowedDirectories.some(dir => normalizedRequested.startsWith(dir));
  if (!isAllowed) {
    throw new Error(`Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(', ')}`);
  }

  // Handle symlinks by checking their real path
  try {
    const realPath = await fs.realpath(absolute);
    const normalizedReal = normalizePath(realPath);
    const isRealPathAllowed = allowedDirectories.some(dir => normalizedReal.startsWith(dir));
    if (!isRealPathAllowed) {
      throw new Error("Access denied - symlink target outside allowed directories");
    }
    return realPath;
  } catch (error) {
    // For new files that don't exist yet, verify parent directory
    const parentDir = path.dirname(absolute);
    try {
      const realParentPath = await fs.realpath(parentDir);
      const normalizedParent = normalizePath(realParentPath);
      const isParentAllowed = allowedDirectories.some(dir => normalizedParent.startsWith(dir));
      if (!isParentAllowed) {
        throw new Error("Access denied - parent directory outside allowed directories");
      }
      return absolute;
    } catch {
      throw new Error(`Parent directory does not exist: ${parentDir}`);
    }
  }
}

// Schema definitions
const ReadFileArgsSchema = z.object({
  path: z.string(),
});

const ReadMultipleFilesArgsSchema = z.object({
  paths: z.array(z.string()),
});

const WriteFileArgsSchema = z.object({
  path: z.string(),
  content: z.string(),
});

const CreateDirectoryArgsSchema = z.object({
  path: z.string(),
});

const ListDirectoryArgsSchema = z.object({
  path: z.string(),
});

const MoveFileArgsSchema = z.object({
  source: z.string(),
  destination: z.string(),
});

const CharOperationSchema = z.object({
  startPosition: z.number(),
  endPosition: z.number().optional(),
  operation: z.enum(['replace', 'insert', 'delete']),
  newContent: z.string().optional()  // Make newContent optional
}).refine((data) => {
  if (data.operation === 'delete') {
    return data.endPosition !== undefined; // Require endPosition for delete
  }
  if (data.operation === 'replace') {
    return data.endPosition !== undefined && data.newContent !== undefined; // Require both for replace
  }
  if (data.operation === 'insert') {
    return data.newContent !== undefined; // Require newContent for insert
  }
  return false;
}, {
  message: "Invalid operation parameters"
});

const LineOperationSchema = z.object({
  type: z.enum(['replaceLines', 'insertLines', 'deleteLines']),
  startLine: z.number().positive(),
  endLine: z.number().positive().optional(),
  newContent: z.string().optional(),
}).refine((data) => {
  if (data.type === 'deleteLines') {
    return data.endLine !== undefined;
  }
  if (data.type === 'replaceLines') {
    return data.endLine !== undefined && data.newContent !== undefined;
  }
  if (data.type === 'insertLines') {
    return data.newContent !== undefined;
  }
  return false;
}, {
  message: "Invalid line operation parameters"
});

const ModifyLinesArgsSchema = z.object({
  path: z.string(),
  operations: z.array(LineOperationSchema)
});

const ModifyCharsArgsSchema = z.object({
  path: z.string(),
  operations: z.array(CharOperationSchema),
});

const SearchFilesArgsSchema = z.object({
  path: z.string(),
  pattern: z.string(),
});

const GetFileInfoArgsSchema = z.object({
  path: z.string(),
});

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  isDirectory: boolean;
  isFile: boolean;
  permissions: string;
}

interface Position {
  line: number;
  column: number;
}

interface FilePosition extends Position {
  offset: number;
}

interface LineRange {
  startLine: number;
  endLine?: number;
}

// Add these utility functions
function getLineRange(content: string, startPos: number, endPos?: number): LineRange {
  const lines = content.split('\n');
  let currentPos = 0;
  let startLine = 0;
  let endLine = 0;

  // Find start line
  for (let i = 0; i < lines.length; i++) {
    if (currentPos + lines[i].length >= startPos) {
      startLine = i;
      break;
    }
    currentPos += lines[i].length + 1; // +1 for newline
  }

  // Find end line if provided
  if (endPos !== undefined) {
    currentPos = 0;
    for (let i = 0; i < lines.length; i++) {
      if (currentPos + lines[i].length >= endPos) {
        endLine = i;
        break;
      }
      currentPos += lines[i].length + 1;
    }
    return { startLine, endLine };
  }

  return { startLine };
}

// Add safety checks for code structure
function validateCodeStructure(content: string): void {
  // Check balanced brackets/braces
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const stack: string[] = [];

  for (const char of content) {
    if ('{(['.includes(char)) {
      stack.push(char);
    } else if ('})]'.includes(char)) {
      const last = stack.pop();
      const expected = Object.entries(pairs).find(([_, close]) => close === char)?.[0];
      if (last !== expected) {
        throw new Error(`Unbalanced brackets: expected ${expected}, got ${char}`);
      }
    }
  }

  if (stack.length > 0) {
    throw new Error(`Unclosed brackets: ${stack.join(', ')}`);
  }
}

// Add line-based operations
type LineOperation = z.infer<typeof LineOperationSchema>;

async function performLineBasedUpdate(filePath: string, operations: LineOperation[]): Promise<string> {
  const { content, lines } = await getFilePositions(filePath);
  const modifiedLines = [...lines];
  
  // Apply all operations without validation
  for (const operation of operations) {
    switch (operation.type) {
      case 'replaceLines':
        if (!operation.newContent || operation.endLine === undefined) {
          throw new Error('Replace operation requires newContent and endLine');
        }
        modifiedLines.splice(
          operation.startLine - 1,
          operation.endLine - operation.startLine + 1,
          ...operation.newContent.split('\n')
        );
        break;

      case 'insertLines':
        if (!operation.newContent) {
          throw new Error('Insert operation requires newContent');
        }
        modifiedLines.splice(
          operation.startLine - 1,
          0,
          ...operation.newContent.split('\n')
        );
        break;

      case 'deleteLines':
        if (operation.endLine === undefined) {
          throw new Error('Delete operation requires endLine');
        }
        modifiedLines.splice(
          operation.startLine - 1,
          operation.endLine - operation.startLine + 1
        );
        break;
    }
  }

  // Create final content
  const result = modifiedLines.join('\n');

  // Only validate the complete file if it's a code file
  if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
    try {
      validateCodeStructure(result);
    } catch (error) {
      throw new Error(`Final code structure validation failed: ${error.message}`);
    }
  }

  return result;
}

// Utility functions for position handling
async function getFilePositions(filePath: string): Promise<{
  content: string;
  lines: string[];
  lineStarts: number[];  // Index where each line starts
}> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  
  // Calculate line start positions
  const lineStarts = [0];  // First line starts at 0
  let position = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    position += lines[i].length + 1; // +1 for \n
    lineStarts.push(position);
  }
  
  return { content, lines, lineStarts };
}

function validatePosition(position: number, fileLength: number): void {
  if (position < 0 || position > fileLength) {
    throw new Error(`Position ${position} out of bounds (0-${fileLength})`);
  }
}

function validatePositions(startPosition: number, endPosition: number | undefined, fileLength: number): void {
  validatePosition(startPosition, fileLength);
  if (endPosition !== undefined) {
    validatePosition(endPosition, fileLength);
    if (endPosition < startPosition) {
      throw new Error(`End position ${endPosition} cannot be before start position ${startPosition}`);
    }
  }
}

// Convert line/column to absolute position
function getOffsetFromLineColumn(lineStarts: number[], line: number, column: number): number {
  if (line < 1 || line > lineStarts.length) {
    throw new Error(`Invalid line number: ${line}`);
  }
  const lineStart = lineStarts[line - 1];
  return lineStart + column - 1;
}

// Convert absolute position to line/column
function getLineColumnFromOffset(lineStarts: number[], offset: number): Position {
  const line = lineStarts.findIndex((start, index) => {
    const nextStart = index < lineStarts.length - 1 ? lineStarts[index + 1] : Infinity;
    return offset >= start && offset < nextStart;
  }) + 1;
  
  const column = offset - lineStarts[line - 1] + 1;
  return { line, column };
}

// Server setup
const server = new Server(
  {
    name: "secure-filesystem-server",
    version: "0.2.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Tool implementations
async function getFileStats(filePath: string): Promise<FileInfo> {
  const stats = await fs.stat(filePath);
  return {
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    accessed: stats.atime,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    permissions: stats.mode.toString(8).slice(-3),
  };
}

async function searchFiles(
  rootPath: string,
  pattern: string,
): Promise<string[]> {
  const results: string[] = [];

  async function search(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      try {
        // Validate each path before processing
        await validatePath(fullPath);

        if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
          results.push(fullPath);
        }

        if (entry.isDirectory()) {
          await search(fullPath);
        }
      } catch (error) {
        // Skip invalid paths during search
        continue;
      }
    }
  }

  await search(rootPath);
  return results;
}

async function performCharBasedUpdate(filePath: string, operations: z.infer<typeof CharOperationSchema>[]): Promise<string> {
  const { content, lineStarts } = await getFilePositions(filePath);
  let result = content;
  const fileLength = content.length;

  // Sort operations by startPosition in descending order
  const sortedOps = [...operations].sort((a, b) => b.startPosition - a.startPosition);
  
  // Keep track of accumulated position shifts
  let accumulatedShift = 0;

  for (const op of sortedOps) {
    const { startPosition, endPosition = startPosition, operation, newContent = '' } = op;
    
    // Adjust positions based on previous operations
    const adjustedStart = startPosition + accumulatedShift;
    const adjustedEnd = endPosition + accumulatedShift;
    
    try {
      validatePositions(adjustedStart, adjustedEnd, result.length);

      const newResult = result.substring(0, adjustedStart) + 
        (operation === 'delete' ? '' : newContent) + 
        result.substring(operation === 'insert' ? adjustedStart : adjustedEnd);

      // Update accumulated shift based on this operation
      const oldLength = adjustedEnd - adjustedStart;
      const newLength = operation === 'delete' ? 0 : newContent.length;
      accumulatedShift += newLength - oldLength;

      // If this is a code file, validate structure
      if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
        try {
          validateCodeStructure(newResult);
        } catch (error) {
          const pos = getLineColumnFromOffset(lineStarts, adjustedStart);
          const contextLine = result.split('\n')[pos.line - 1];
          throw new Error(
            `Code structure validation failed at line ${pos.line}:\n` +
            `${contextLine}\n` +
            `${' '.repeat(pos.column - 1)}^ ${error.message}`
          );
        }
      }

      result = newResult;
    } catch (error) {
      const pos = getLineColumnFromOffset(lineStarts, adjustedStart);
      const contextLine = result.split('\n')[pos.line - 1];
      throw new Error(
        `Operation failed at line ${pos.line}, column ${pos.column}:\n` +
        `${contextLine}\n` +
        `${' '.repeat(pos.column - 1)}^ ${error.message}`
      );
    }
  }

  return result;
}

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_file",
        description:
          "Read the complete contents of a file from the file system. " +
          "Handles various text encodings and provides detailed error messages " +
          "if the file cannot be read. Use this tool when you need to examine " +
          "the contents of a single file. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(ReadFileArgsSchema) as ToolInput,
      },
      {
        name: "read_multiple_files",
        description:
          "Read the contents of multiple files simultaneously. This is more " +
          "efficient than reading files one by one when you need to analyze " +
          "or compare multiple files. Each file's content is returned with its " +
          "path as a reference. Failed reads for individual files won't stop " +
          "the entire operation. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(ReadMultipleFilesArgsSchema) as ToolInput,
      },
      {
        name: "write_file",
        description:
          "Create a new file or completely overwrite an existing file with new content. " +
          "Use with caution as it will overwrite existing files without warning. " +
          "Handles text content with proper encoding. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(WriteFileArgsSchema) as ToolInput,
      },
      {
        name: "create_directory",
        description:
          "Create a new directory or ensure a directory exists. Can create multiple " +
          "nested directories in one operation. If the directory already exists, " +
          "this operation will succeed silently. Perfect for setting up directory " +
          "structures for projects or ensuring required paths exist. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema) as ToolInput,
      },
      {
        name: "list_directory",
        description:
          "Get a detailed listing of all files and directories in a specified path. " +
          "Results clearly distinguish between files and directories with [FILE] and [DIR] " +
          "prefixes. This tool is essential for understanding directory structure and " +
          "finding specific files within a directory. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(ListDirectoryArgsSchema) as ToolInput,
      },
      {
        name: "move_file",
        description:
          "Move or rename files and directories. Can move files between directories " +
          "and rename them in a single operation. If the destination exists, the " +
          "operation will fail. Works across different directories and can be used " +
          "for simple renaming within the same directory. Both source and destination must be within allowed directories.",
        inputSchema: zodToJsonSchema(MoveFileArgsSchema) as ToolInput,
      },
      {
        name: "search_files",
        description:
          "Recursively search for files and directories matching a pattern. " +
          "Searches through all subdirectories from the starting path. The search " +
          "is case-insensitive and matches partial names. Returns full paths to all " +
          "matching items. Great for finding files when you don't know their exact location. " +
          "Only searches within allowed directories.",
        inputSchema: zodToJsonSchema(SearchFilesArgsSchema) as ToolInput,
      },
      {
        name: "modify_chars",
        description:
          "Update specific portions of a file with new content. Supports inserting, " +
          "replacing, or deleting content at specific positions. Each operation specifies " +
          "the position and content to modify. Operations are applied in order from last " +
          "to first position to maintain integrity. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(ModifyCharsArgsSchema) as ToolInput,
      },
      {
        name: "modify_lines",
        description:
          "Update files using line-based operations. Perfect for code modifications, " +
          "supporting insert, replace, and delete operations by line number. Each operation " +
          "specifies line numbers and content to modify. Validates code structure and maintains " +
          "proper formatting. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(ModifyLinesArgsSchema) as ToolInput,
      },
      {
        name: "get_file_info",
        description:
          "Retrieve detailed metadata about a file or directory. Returns comprehensive " +
          "information including size, creation time, last modified time, permissions, " +
          "and type. This tool is perfect for understanding file characteristics " +
          "without reading the actual content. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(GetFileInfoArgsSchema) as ToolInput,
      },
      {
        name: "list_allowed_directories",
        description: 
          "Returns the list of directories that this server is allowed to access. " +
          "Use this to understand which directories are available before trying to access files.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  };
});


server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "read_file": {
        const parsed = ReadFileArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for read_file: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        const content = await fs.readFile(validPath, "utf-8");
        return {
          content: [{ type: "text", text: content }],
        };
      }

      case "read_multiple_files": {
        const parsed = ReadMultipleFilesArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for read_multiple_files: ${parsed.error}`);
        }
        const results = await Promise.all(
          parsed.data.paths.map(async (filePath: string) => {
            try {
              const validPath = await validatePath(filePath);
              const content = await fs.readFile(validPath, "utf-8");
              return `${filePath}:\n${content}\n`;
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              return `${filePath}: Error - ${errorMessage}`;
            }
          }),
        );
        return {
          content: [{ type: "text", text: results.join("\n---\n") }],
        };
      }

      case "write_file": {
        const parsed = WriteFileArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for write_file: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        await fs.writeFile(validPath, parsed.data.content, "utf-8");
        return {
          content: [{ type: "text", text: `Successfully wrote to ${parsed.data.path}` }],
        };
      }

      case "create_directory": {
        const parsed = CreateDirectoryArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for create_directory: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        await fs.mkdir(validPath, { recursive: true });
        return {
          content: [{ type: "text", text: `Successfully created directory ${parsed.data.path}` }],
        };
      }

      case "list_directory": {
        const parsed = ListDirectoryArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for list_directory: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        const entries = await fs.readdir(validPath, { withFileTypes: true });
        const formatted = entries
          .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
          .join("\n");
        return {
          content: [{ type: "text", text: formatted }],
        };
      }

      case "move_file": {
        const parsed = MoveFileArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for move_file: ${parsed.error}`);
        }
        const validSourcePath = await validatePath(parsed.data.source);
        const validDestPath = await validatePath(parsed.data.destination);
        await fs.rename(validSourcePath, validDestPath);
        return {
          content: [{ type: "text", text: `Successfully moved ${parsed.data.source} to ${parsed.data.destination}` }],
        };
      }

      case "search_files": {
        const parsed = SearchFilesArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for search_files: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        const results = await searchFiles(validPath, parsed.data.pattern);
        return {
          content: [{ type: "text", text: results.length > 0 ? results.join("\n") : "No matches found" }],
        };
      }

      case "modify_chars": {
        const parsed = ModifyCharsArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for modify_file: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        const newContent = await performCharBasedUpdate(validPath, parsed.data.operations);
        await fs.writeFile(validPath, newContent, "utf-8");
        return {
          content: [{ type: "text", text: `Successfully updated ${parsed.data.path}` }],
        };
      }

      case "modify_lines": {
        const parsed = ModifyLinesArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for modify_lines: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        
        // Handle each line operation
        let newContent = "";
        for (const operation of parsed.data.operations) {
          newContent = await performLineBasedUpdate(validPath, operation);
        }
        
        // If this is a code file, validate structure
        if (validPath.endsWith('.ts') || validPath.endsWith('.js') || 
            validPath.endsWith('.py') || validPath.endsWith('.json')) {
          validateCodeStructure(newContent);
        }
        
        await fs.writeFile(validPath, newContent, "utf-8");
        return {
          content: [{ type: "text", text: `Successfully updated ${parsed.data.path}` }],
        };
      }

      case "get_file_info": {
        const parsed = GetFileInfoArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for get_file_info: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        const info = await getFileStats(validPath);
        return {
          content: [{ type: "text", text: Object.entries(info)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n") }],
        };
      }

      case "list_allowed_directories": {
        return {
          content: [{ 
            type: "text", 
            text: `Allowed directories:\n${allowedDirectories.join('\n')}` 
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Start server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Secure MCP Filesystem Server running on stdio");
  console.error("Allowed directories:", allowedDirectories);
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});