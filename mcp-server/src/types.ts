import { Bot } from 'mineflayer';
import { Pathfinder, Movements } from 'mineflayer-pathfinder';

// Custom bot events that skills emit
declare module 'mineflayer' {
    interface BotEvents {
        alteraBotEndObservation: (message: string) => void;
        alteraBotTextObservation: (message: string) => void;
        alteraBotStartObservation: (message: string) => void;
        alteraBotDelayedEndObservation: (message: string, delaySeconds?: number) => void;
    }

    interface Bot {
        // Custom properties added to bot
        exploreChunkSize: number;
        knownChunks: Record<string, any>;
        currentSkillCode: string;
        currentSkillData: Record<string, any>;

        // Constants
        nearbyBlockXZRange: number;
        nearbyBlockYRange: number;
        nearbyPlayerRadius: number;
        hearingRadius: number;
        nearbyEntityRadius: number;

        // Movements from pathfinder plugin
        Movements?: any;

        // Interface management (custom chest/inventory management)
        openedInterface?: any;
        currentInterface?: any;
        setInterface?: (interfaceToSet: any, position?: any, chest?: any) => void;
        updateInterface?: (interfaceToSet: any) => void;

        // Additional bot properties
        cheatsAllowed?: boolean;
        lastDanceTime?: number;

        // MCP server metadata
        serverHost?: string;
        serverPort?: number;
        viewerPort?: number | null;
    }

    interface Entity {
        // Custom properties on entities
        isSleeping?: boolean;
    }
}

// Extend mineflayer-collectblock types
declare module 'mineflayer-collectblock' {
    interface CollectOptions {
        signal?: AbortSignal;
    }
}

// Custom extended recipe type to avoid conflicts
export interface ExtendedRecipe {
    missingItems?: Record<string, number>;
    requiresTable?: boolean;
    [key: string]: any; // Allow other recipe properties
}

// Logger interface
export interface Logger {
    info: (message: string) => void;
    error: (message: string) => void;
    warn: (message: string) => void;
    debug: (message: string) => void;
}

// Bot with logger
export interface BotWithLogger extends Bot {
    logger: Logger;
    // Pathfinder plugin
    pathfinder: Pathfinder;
    // PVP plugin 
    pvp: any; // The pvp plugin types aren't well defined
    // Tool plugin
    tool: any; // The tool plugin types aren't well defined
    // CollectBlock plugin
    collectBlock: any; // The collectBlock plugin types aren't well defined
    // Add other custom properties that the skills expect
    lastDanceTime?: number;
    Movements?: typeof Movements; // Constructor for creating movement configurations
}

// Custom furnace properties
declare module 'mineflayer' {
    interface Furnace {
        totalFuel?: number;
        totalFuelSeconds?: number;
        fuelSeconds?: number;
        totalProgress?: number;
        totalProgressSeconds?: number;
        progressSeconds?: number;
    }
} 