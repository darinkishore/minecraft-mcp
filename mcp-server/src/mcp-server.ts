#!/usr/bin/env node

// Redirect ALL console.log output to stderr to prevent stdout pollution
// This MUST be done before any other imports or code
const originalConsoleLog = console.log;
console.log = (...args: any[]) => {
    console.error('[LOG]', ...args);
};

// Also redirect console.dir which might be used for error objects
const originalConsoleDir = console.dir;
console.dir = (obj: any, options?: any) => {
    console.error('[DIR]', obj, options);
};

// Intercept direct writes to stdout to ensure only JSON-RPC messages go through
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
(process.stdout as any).write = (chunk: any, encoding?: any, callback?: any) => {
    // Check if this looks like a JSON-RPC message
    const str = chunk.toString();
    if (str.trim().startsWith('{') && str.includes('"jsonrpc"')) {
        // This looks like a JSON-RPC message, let it through
        return originalStdoutWrite(chunk, encoding, callback);
    } else {
        // Redirect non-JSON-RPC output to stderr
        console.error('[STDOUT REDIRECT]', str.trim());
        if (callback) callback();
        return true;
    }
};

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    CallToolRequest,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { program } from 'commander';
import { Bot } from 'mineflayer';
import { createBot as mineflayerCreateBot } from 'mineflayer';
import { loadSkills, SkillRegistry } from './skillRegistry.js';
import { BotManager } from './botManager.js';
import { initializeChatHistory } from './skills/verified/readChat.js';

// Parse command line arguments (now optional)
program
    .option('-p, --port <port>', 'Default Minecraft server port')
    .option('-h, --host <host>', 'Default Minecraft server host')
    .option('-u, --username <username>', 'Bot username or email for Microsoft auth')
    .option('-a, --auth <auth>', 'Authentication mode (offline/microsoft)')
    .option('--password <password>', 'Password for Microsoft authentication')
    .parse(process.argv);

const options = program.opts();

// Initialize the MCP server
const server = new Server(
    {
        name: "fl-minecraft",
        version: "0.1.0",
    },
    {
        capabilities: {
            tools: {}
        }
    }
);

// Bot manager to handle multiple bot instances
const botManager = new BotManager();

// Skill registry to manage available skills
const skillRegistry = new SkillRegistry();

// Initialize skills
async function initializeSkills() {
    const skills = await loadSkills();
    for (const skill of skills) {
        skillRegistry.registerSkill(skill);
    }
}

// List all available tools (joinGame + all skills)
server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [
        {
            name: "joinGame",
            description: "Connect the bot to the Minecraft server using configured credentials",
            inputSchema: {
                type: "object",
                properties: {},
                required: []
            }
        },
        {
            name: "leaveGame",
            description: "Disconnect a bot from the game",
            inputSchema: {
                type: "object",
                properties: {
                    username: {
                        type: "string",
                        description: "The username of the bot to disconnect"
                    },
                    disconnectAll: {
                        type: "boolean",
                        description: "If true, disconnect all bots and close all connections"
                    }
                }
            }
        }
    ];

    // Add all registered skills as tools
    const skillTools = skillRegistry.getAllSkills().map(skill => ({
        name: skill.name,
        description: skill.description,
        inputSchema: skill.inputSchema
    }));

    return { tools: [...tools, ...skillTools] };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;

    // Handle joinGame tool
    if (name === "joinGame") {
        try {
            // Use command line options or environment variables for all settings
            const serverHost = options.host || process.env.MC_HOST || 'localhost';
            const serverPort = options.port ? parseInt(options.port) : (process.env.MC_PORT ? parseInt(process.env.MC_PORT) : 25565);
            const username = options.username || process.env.MC_USERNAME || 'MCPBot';
            const authMode = options.auth || process.env.MC_AUTH || 'offline';
            const password = options.password || process.env.MC_PASSWORD;

            console.error(`[MCP] Attempting to spawn bot '${username}' on ${serverHost}:${serverPort} with ${authMode} auth`);

            // Create bot options
            const botOptions: any = {
                host: serverHost,
                port: serverPort,
                username: username,
                version: '1.21.4'  // Force 1.21.4 for better compatibility with viewer
            };

            // Add authentication options if specified
            if (authMode !== 'offline') {
                botOptions.auth = authMode;
                if (password) {
                    botOptions.password = password;
                }
                console.error(`[MCP] Using ${authMode} authentication mode`);
            }

            // Create a new bot
            const bot = mineflayerCreateBot(botOptions) as any; // Type assertion to allow adding custom properties

            // Dynamically import and load plugins
            const [pathfinderModule, pvpModule, toolModule, collectBlockModule, viewerModule] = await Promise.all([
                import('mineflayer-pathfinder'),
                import('mineflayer-pvp'),
                import('mineflayer-tool'),
                import('mineflayer-collectblock'),
                import('prismarine-viewer')
            ]);

            // Load plugins
            bot.loadPlugin(pathfinderModule.pathfinder);
            bot.loadPlugin(pvpModule.plugin);
            bot.loadPlugin(toolModule.plugin);
            bot.loadPlugin(collectBlockModule.plugin);

            // Add Movements constructor to bot for skills that create movement configurations
            bot.Movements = pathfinderModule.Movements;

            // Add a logger to the bot
            bot.logger = {
                info: (message: string) => {
                    const timestamp = new Date().toISOString();
                    console.error(`[${username}] ${timestamp} : ${message}`);
                },
                error: (message: string) => {
                    const timestamp = new Date().toISOString();
                    console.error(`[${username}] ${timestamp} : ERROR: ${message}`);
                },
                warn: (message: string) => {
                    const timestamp = new Date().toISOString();
                    console.error(`[${username}] ${timestamp} : WARN: ${message}`);
                },
                debug: (message: string) => {
                    const timestamp = new Date().toISOString();
                    console.error(`[${username}] ${timestamp} : DEBUG: ${message}`);
                }
            };

            // Register the bot
            const botId = botManager.addBot(username, bot);

            // Wait for spawn
            await Promise.race([
                new Promise<void>((resolve, reject) => {
                    bot.once('spawn', () => {
                        console.error(`[MCP] Bot ${username} spawned, initializing additional properties...`);

                        // Initialize properties that skills expect
                        bot.exploreChunkSize = 16; // INTERNAL_MAP_CHUNK_SIZE
                        bot.knownChunks = bot.knownChunks || {};
                        bot.currentSkillCode = '';
                        bot.currentSkillData = {};

                        // Set constants that skills use
                        bot.nearbyBlockXZRange = 20; // NEARBY_BLOCK_XZ_RANGE
                        bot.nearbyBlockYRange = 10; // NEARBY_BLOCK_Y_RANGE
                        bot.nearbyPlayerRadius = 10; // NEARBY_PLAYER_RADIUS
                        bot.hearingRadius = 30; // HEARING_RADIUS
                        bot.nearbyEntityRadius = 10; // NEARBY_ENTITY_RADIUS

                        // Initialize chat history tracking
                        initializeChatHistory(bot);

                        // Start the 3D viewer with dynamic port selection
                        let viewerPort = 3007 + botManager.getBotCount();
                        let viewerStarted = false;
                        
                        // Try to find an available port
                        for (let attempts = 0; attempts < 10; attempts++) {
                            try {
                                viewerModule.mineflayer(bot, { port: viewerPort, firstPerson: true });
                                console.error(`[MCP] Web viewer started at http://localhost:${viewerPort} (first-person mode)`);
                                bot.viewerPort = viewerPort;
                                viewerStarted = true;
                                break;
                            } catch (err: any) {
                                if (err.code === 'EADDRINUSE' || err.message?.includes('EADDRINUSE')) {
                                    viewerPort++;
                                    console.error(`[MCP] Port ${viewerPort - 1} in use, trying port ${viewerPort}`);
                                } else {
                                    console.error(`[MCP] Failed to start viewer: ${err.message}`);
                                    break;
                                }
                            }
                        }
                        
                        if (!viewerStarted) {
                            console.error(`[MCP] Warning: Could not start web viewer (ports unavailable)`);
                            bot.viewerPort = null; // Mark as unavailable
                        }

                        resolve();
                    });
                    bot.once('error', (err: Error) => reject(err));
                    bot.once('kicked', (reason: string) => reject(new Error(`Bot kicked: ${reason}`)));
                }),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Bot spawn timed out after 30 seconds')), 30000)
                )
            ]);

            return {
                content: [{
                    type: "text",
                    text: `Bot '${username}' successfully joined the game on ${serverHost}:${serverPort}. Bot ID: ${botId}`
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: `Failed to join game: ${error instanceof Error ? error.message : String(error)}`
                }],
                isError: true
            };
        }
    }

    // Handle leaveGame tool
    if (name === "leaveGame") {
        try {
            const { username, disconnectAll } = args as { username?: string; disconnectAll?: boolean };

            if (disconnectAll) {
                const count = botManager.getBotCount();
                botManager.disconnectAll();
                return {
                    content: [{
                        type: "text",
                        text: `Disconnected all ${count} bot(s) from the game.`
                    }]
                };
            }

            if (!username) {
                throw new Error("Either 'username' or 'disconnectAll' must be specified");
            }

            const bot = botManager.getBotByUsername(username);
            if (!bot) {
                throw new Error(`No bot found with username '${username}'`);
            }

            botManager.removeBot(username);

            return {
                content: [{
                    type: "text",
                    text: `Bot '${username}' has been disconnected from the game.`
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: `Failed to leave game: ${error instanceof Error ? error.message : String(error)}`
                }],
                isError: true
            };
        }
    }

    // Handle skill tools
    const skill = skillRegistry.getSkill(name);
    if (skill) {
        try {
            // Get the active bot (for now, we'll use the most recently created bot)
            const bot = botManager.getActiveBot();
            if (!bot) {
                throw new Error("No active bot. Please use 'joinGame' first to spawn a bot.");
            }

            // Execute the skill with 30-second timeout
            const result = await Promise.race([
                skill.execute(bot, args),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Skill execution timed out after 30 seconds')), 30000)
                )
            ]);

            // Check if result is already in MCP format (has content array)
            if (typeof result === 'object' && result !== null && 'content' in result && Array.isArray(result.content)) {
                // Result is already properly formatted for MCP
                return result;
            }

            // Otherwise format as text response
            let responseText: string;
            if (result === undefined || result === null) {
                responseText = `Skill '${name}' executed successfully`;
            } else if (typeof result === 'string') {
                responseText = result;
            } else if (typeof result === 'object') {
                // If result is an object but not MCP formatted, stringify it
                responseText = JSON.stringify(result, null, 2);
            } else {
                // For any other type, convert to string
                responseText = String(result);
            }

            return {
                content: [{
                    type: "text",
                    text: responseText
                }]
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[MCP] Skill '${name}' execution error:`, error);

            return {
                content: [{
                    type: "text",
                    text: `Skill execution failed: ${errorMessage}`
                }],
                isError: true
            };
        }
    }

    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

// Helper to kill process using a port
async function killPortProcess(port: number): Promise<void> {
    try {
        // Use lsof to find process using the port
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        // Find and kill process on the port
        try {
            const { stdout } = await execAsync(`lsof -ti:${port}`);
            const pids = stdout.trim().split('\n').filter(Boolean);
            for (const pid of pids) {
                console.error(`[MCP] Killing process ${pid} using port ${port}`);
                try {
                    await execAsync(`kill -9 ${pid}`);
                } catch (e) {
                    // Process might already be dead
                }
            }
        } catch (e) {
            // No process found on port, which is fine
        }
    } catch (error) {
        console.error(`[MCP] Could not clean up port ${port}:`, error);
    }
}

// Initialize and start the server
async function main() {
    const defaultHost = options.host || 'localhost';
    const defaultPort = options.port || '25565';

    console.error(`Starting MCP server for Minecraft`);
    console.error(`Default connection: ${defaultHost}:${defaultPort}`);

    // Clean up any leftover viewer ports
    console.error('[MCP] Cleaning up any leftover connections...');
    for (let port = 3007; port <= 3017; port++) {
        await killPortProcess(port);
    }
    
    // Disconnect any existing bots
    botManager.disconnectAll();

    // Initialize skills
    await initializeSkills();
    console.error(`Loaded ${skillRegistry.getAllSkills().length} skills`);

    // Auto-join the game if credentials are provided
    if (options.username) {
        console.error('[MCP] Auto-joining game with provided credentials...');
        
        let connected = false;
        let retryDelay = 2000; // Start with 2 seconds
        const maxRetries = 3;
        
        for (let retry = 0; retry < maxRetries && !connected; retry++) {
            if (retry > 0) {
                console.error(`[MCP] Retry ${retry}/${maxRetries} after ${retryDelay/1000}s delay...`);
            }
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            
            try {
            const serverHost = options.host || 'localhost';
            const serverPort = options.port ? parseInt(options.port) : 25565;
            const username = options.username;
            const authMode = options.auth || 'offline';
            const password = options.password;

            console.error(`[MCP] Connecting bot '${username}' to ${serverHost}:${serverPort} with ${authMode} auth`);

            // Create bot options
            const botOptions: any = {
                host: serverHost,
                port: serverPort,
                username: username,
                version: '1.21.4'  // Force 1.21.4 for better compatibility with viewer
            };

            // Add authentication options if specified
            if (authMode !== 'offline') {
                botOptions.auth = authMode;
                if (password) {
                    botOptions.password = password;
                }
            }

            // Create a new bot
            const bot = mineflayerCreateBot(botOptions) as any;

            // Dynamically import and load plugins
            const [pathfinderModule, pvpModule, toolModule, collectBlockModule, viewerModule] = await Promise.all([
                import('mineflayer-pathfinder'),
                import('mineflayer-pvp'),
                import('mineflayer-tool'),
                import('mineflayer-collectblock'),
                import('prismarine-viewer')
            ]);

            // Load plugins
            bot.loadPlugin(pathfinderModule.pathfinder);
            bot.loadPlugin(pvpModule.plugin);
            bot.loadPlugin(toolModule.plugin);
            bot.loadPlugin(collectBlockModule.plugin);

            // Add Movements constructor to bot
            bot.Movements = pathfinderModule.Movements;

            // Add a logger to the bot
            bot.logger = {
                info: (message: string) => console.error(`[${username}] ${new Date().toISOString()} : ${message}`),
                error: (message: string) => console.error(`[${username}] ${new Date().toISOString()} : ERROR: ${message}`),
                warn: (message: string) => console.error(`[${username}] ${new Date().toISOString()} : WARN: ${message}`),
                debug: (message: string) => console.error(`[${username}] ${new Date().toISOString()} : DEBUG: ${message}`)
            };

            // Register the bot
            const botId = botManager.addBot(username, bot);

            // Wait for spawn
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Bot spawn timed out')), 30000);
                
                bot.once('spawn', () => {
                    clearTimeout(timeout);
                    console.error(`[MCP] Bot ${username} spawned successfully!`);

                    // Initialize bot properties
                    bot.exploreChunkSize = 16;
                    bot.knownChunks = bot.knownChunks || {};
                    bot.currentSkillCode = '';
                    bot.currentSkillData = {};
                    bot.nearbyBlockXZRange = 20;
                    bot.nearbyBlockYRange = 10;
                    bot.nearbyPlayerRadius = 10;
                    bot.hearingRadius = 30;
                    bot.nearbyEntityRadius = 10;

                    // Initialize chat history tracking
                    initializeChatHistory(bot);

                    // Start the 3D viewer with dynamic port selection
                    let viewerPort = 3007;
                    let viewerStarted = false;
                    
                    // Try to find an available port
                    for (let attempts = 0; attempts < 10; attempts++) {
                        try {
                            viewerModule.mineflayer(bot, { port: viewerPort, firstPerson: true });
                            console.error(`[MCP] Web viewer started at http://localhost:${viewerPort}`);
                            bot.viewerPort = viewerPort;
                            viewerStarted = true;
                            break;
                        } catch (err: any) {
                            if (err.code === 'EADDRINUSE') {
                                viewerPort++;
                                console.error(`[MCP] Port ${viewerPort - 1} in use, trying port ${viewerPort}`);
                            } else {
                                console.error(`[MCP] Failed to start viewer: ${err.message}`);
                                break;
                            }
                        }
                    }
                    
                    if (!viewerStarted) {
                        console.error(`[MCP] Warning: Could not start web viewer (all ports in use)`);
                    }

                    resolve();
                });
                
                bot.once('error', (err: Error) => {
                    clearTimeout(timeout);
                    reject(err);
                });
                
                bot.once('kicked', (reason: string) => {
                    clearTimeout(timeout);
                    reject(new Error(`Bot kicked: ${reason}`));
                });
            });

            console.error(`[MCP] Bot '${username}' successfully connected and ready!`);
            connected = true;
        } catch (error: any) {
            console.error(`[MCP] Failed to auto-join:`, error.message);
            
            // Check if it's a throttling error
            if (error.message?.includes('throttled') || error.message?.includes('Connection throttled')) {
                retryDelay *= 2; // Exponential backoff
                continue;
            }
            
            // For other errors, don't retry
            break;
        }
        }
        
        if (!connected) {
            console.error(`[MCP] Could not auto-connect after ${maxRetries} attempts`);
            console.error(`[MCP] You can still use the 'joinGame' tool to connect manually`);
        }
    } else {
        console.error('[MCP] No credentials provided via CLI. Use joinGame tool to connect.');
    }

    // Connect to stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error("MCP server running on stdio transport");
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
    console.error("Shutting down...");
    botManager.disconnectAll();
    process.exit(0);
});

// Capture any uncaught exceptions and send to stderr
process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error);
    // Don't exit for EADDRINUSE errors - they're handled gracefully
    if (error.message?.includes('EADDRINUSE')) {
        console.error('[MCP] Port conflict handled - continuing operation');
        return;
    }
    process.exit(1);
});

// Capture any unhandled promise rejections and send to stderr
process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION] at:', promise, 'reason:', reason);
});

main().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});