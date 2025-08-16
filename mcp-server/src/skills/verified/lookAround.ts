import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Block } from 'prismarine-block';
import { Entity } from 'prismarine-entity';
import { Item } from 'prismarine-item';
import minecraftData from 'minecraft-data';

import { ISkillServiceParams, ISkillParams } from '../../types/skillType.js';
import { validateSkillParams } from '../index.js';

interface SkillParams {
    // No parameters needed for this skill
}

interface ServiceParams {
    signal: AbortSignal;
    cancelExecution: () => void;
    resetTimeout: () => void;
    getStatsData: () => any;
    setStatsData: (data: any) => void;
}

// Helper function to check if a block is exposed to air
function canSeeBlock(bot: Bot, position: Vec3): boolean {
    const offsets = [
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: -1 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: -1, z: 0 },
    ];

    return offsets.some((offset) => {
        const newPos = position.plus(new Vec3(offset.x, offset.y, offset.z));
        const block = bot.blockAt(newPos);
        return block && block.transparent;
    });
}

// Helper function to parse block info
function parseBlockInfo(bot: Bot, block: Block): string {
    let retVal = block.name;
    const mcData = minecraftData(bot.version);

    try {
        // Check if it's a fully grown crop
        if (isFullyGrownCrop(block)) {
            retVal = 'fully grown ' + block.name;
        }

        // Check if it's farmland
        if (block.type === mcData.blocksByName.farmland?.id) {
            const blockAbove = bot.blockAt(block.position.offset(0, 1, 0));
            if (blockAbove && blockAbove.type === mcData.blocksByName.air?.id) {
                retVal = 'empty ' + block.name;
            } else {
                retVal = 'planted ' + block.name;
            }
        }
    } catch (err) {
        // Ignore parsing errors
    }

    return retVal;
}

// Helper function to check if a crop is fully grown
function isFullyGrownCrop(block: Block): boolean {
    if (!block) return false;

    const blockName = block.name;
    const properties = block.getProperties();

    switch (blockName) {
        case 'wheat':
            return properties.age === 7;
        case 'carrots':
            return properties.age === 7;
        case 'potatoes':
            return properties.age === 7;
        case 'beetroots':
            return properties.age === 3;
        case 'nether_wart':
            return properties.age === 3;
        default:
            return false;
    }
}

// Get nearby blocks within radius
function getNearbyBlocks(bot: Bot, radius: number = 16): string[] {
    const blocks: string[] = [];
    const processedDoubleChests = new Set<string>(); // Track double chests we've already counted
    if (!bot.entity) return [];

    const position = bot.entity.position.floored();
    const maxDistanceXZ = radius;
    const maxDistanceY = Math.min(radius, 10); // Limit vertical scanning

    for (let x = -maxDistanceXZ; x <= maxDistanceXZ; x++) {
        for (let y = -maxDistanceY; y <= maxDistanceY; y++) {
            for (let z = -maxDistanceXZ; z <= maxDistanceXZ; z++) {
                const blockPos = position.offset(x, y, z);
                const block = bot.blockAt(blockPos);
                if (block && block.type !== 0 && canSeeBlock(bot, block.position)) {
                    const blockName = parseBlockInfo(bot, block);
                    
                    // Special handling for chests and trapped chests
                    if (blockName === 'chest' || blockName === 'trapped_chest') {
                        const posKey = `${blockPos.x},${blockPos.y},${blockPos.z}`;
                        
                        // Check if this chest is part of a double chest we've already processed
                        if (processedDoubleChests.has(posKey)) {
                            continue; // Skip this chest, already counted as part of double chest
                        }
                        
                        // Check for adjacent chest to form double chest
                        const adjacentPositions = [
                            blockPos.offset(1, 0, 0),  // East
                            blockPos.offset(-1, 0, 0), // West
                            blockPos.offset(0, 0, 1),  // South
                            blockPos.offset(0, 0, -1)  // North
                        ];
                        
                        let isDoubleChest = false;
                        for (const adjPos of adjacentPositions) {
                            const adjBlock = bot.blockAt(adjPos);
                            if (adjBlock && adjBlock.name === block.name) {
                                // Found adjacent chest of same type - this is a double chest
                                isDoubleChest = true;
                                // Mark both positions as processed
                                processedDoubleChests.add(posKey);
                                processedDoubleChests.add(`${adjPos.x},${adjPos.y},${adjPos.z}`);
                                blocks.push(`double_${blockName}`);
                                break;
                            }
                        }
                        
                        if (!isDoubleChest) {
                            blocks.push(blockName);
                        }
                    } else {
                        blocks.push(blockName);
                    }
                }
            }
        }
    }

    return blocks;
}

// Get nearby entities
function getNearbyEntities(bot: Bot, radius: number = 16): string[] {
    if (!bot.entities || !bot.entity) return [];

    const allEntities = Object.values(bot.entities);
    const mcData = minecraftData(bot.version);

    const nearbyEntities = allEntities.filter((e: Entity) => {
        if (e.id !== bot.entity.id &&
            e.position.distanceTo(bot.entity.position) < radius) {
            const block = bot.blockAt(e.position);
            return block && bot.canSeeBlock(block);
        }
        return false;
    });

    // Sort by distance
    nearbyEntities.sort((a, b) =>
        a.position.distanceTo(bot.entity.position) -
        b.position.distanceTo(bot.entity.position)
    );

    return nearbyEntities.map((entity: Entity) => {
        let name = entity.name || '';

        // Handle item entities
        if ((name === 'item' || name === 'Item') && entity.metadata) {
            const metadata = entity.metadata as any[];
            if (metadata.length > 8 && metadata[8]) {
                const itemCount = metadata[8].itemCount;
                const itemId = metadata[8].itemId;
                if (mcData.items[itemId]?.displayName) {
                    name = itemCount > 0
                        ? `${itemCount} ${mcData.items[itemId].displayName}`
                        : mcData.items[itemId].displayName;
                }
            }
        }

        // Handle player entities
        if (name === 'player' && entity.username) {
            name = entity.username;
        }

        const distance = Math.round(entity.position.distanceTo(bot.entity.position));
        return `${name} (${distance} blocks away)`;
    }).filter(item => item !== '');
}

// Get time of day as string
function getTimeOfDay(bot: Bot): string {
    if (!bot.time) return 'unknown';
    const timeOfDay = bot.time.timeOfDay / 24000;

    if (timeOfDay < 0.25) return 'morning';
    else if (timeOfDay < 0.5) return 'noon';
    else if (timeOfDay < 0.75) return 'evening';
    else return 'night';
}

// Get weather observation
function getWeather(bot: Bot): string {
    if (bot.thunderState > 0) return 'thunderstorm';
    else if (bot.isRaining) return 'raining';
    else return 'clear';
}

// Get inventory summary
function getInventorySummary(bot: Bot): Record<string, number> {
    const inventory = bot.inventory;
    const items: Record<string, number> = {};

    inventory.items().forEach((item: Item) => {
        const itemName = item.name;
        items[itemName] = (items[itemName] || 0) + item.count;
    });

    return items;
}

export const lookAround = async (
    bot: Bot,
    params: ISkillParams,
    serviceParams: ISkillServiceParams,
): Promise<boolean> => {
    const skillName = 'lookAround';
    const requiredParams: string[] = [];
    const isParamsValid = validateSkillParams(
        { ...serviceParams },
        requiredParams,
        skillName,
    );
    if (!isParamsValid) {
        serviceParams.cancelExecution?.();
        bot.emit(
            'alteraBotEndObservation',
            `Mistake: You didn't provide all of the required parameters ${requiredParams.join(', ')} for the ${skillName} skill.`,
        );
        return false;
    }

    bot.emit(
        'alteraBotStartObservation',
        `🔍 SCANNING ENVIRONMENT 🔍`,
    );

    const mcData = minecraftData(bot.version);

    try {
        bot.emit('alteraBotStartObservation', 'Looking around to observe the environment...');

        // Gather all observations
        const observations: string[] = [];

        // Location
        const pos = bot.entity.position;
        observations.push(`You are at coordinates X:${Math.floor(pos.x)}, Y:${Math.floor(pos.y)}, Z:${Math.floor(pos.z)}.`);

        // Health and food
        observations.push(`Your health is ${bot.health}/20 and hunger is ${bot.food}/20.`);

        // Time and weather
        const timeOfDay = getTimeOfDay(bot);
        const weather = getWeather(bot);
        observations.push(`It is ${timeOfDay} and the weather is ${weather}.`);

        // Biome
        const block = bot.blockAt(bot.entity.position);
        if (block && block.biome) {
            const biomeName = mcData.biomes[block.biome.id]?.name || 'unknown';
            observations.push(`You are in a ${biomeName} biome.`);
        }

        // Held item
        const heldItem = bot.heldItem;
        if (heldItem) {
            observations.push(`You are holding ${heldItem.name}.`);
        } else {
            observations.push(`You are not holding anything.`);
        }

        // Nearby blocks with importance weighting
        const nearbyBlocks = getNearbyBlocks(bot, 16);
        if (nearbyBlocks.length > 0) {
            observations.push(`\nYou see these blocks around you:`);
            
            // Define importance weights using regex patterns for better matching
            const blockImportancePatterns: Array<[RegExp, number]> = [
                // Critical/Valuable (10)
                [/diamond/, 10],
                [/emerald/, 10], 
                [/ancient_debris/, 10],
                [/netherite/, 10],
                [/beacon/, 10],
                
                // Important resources (8-9)
                [/enchant/, 9],
                [/anvil/, 8],
                [/spawner/, 8],
                [/shulker/, 9],
                [/(iron|gold|copper)_ore/, 8],
                [/deepslate.*ore/, 8],
                
                // Dangerous (8-9)
                [/lava/, 9],
                [/fire/, 9],
                [/tnt/, 8],
                [/wither/, 7],
                [/magma/, 6],
                
                // Useful interactables (7-8)
                [/double_chest/, 9],  // Double chests are more valuable
                [/double_trapped_chest/, 9],
                [/chest/, 8],
                [/barrel/, 7],
                [/hopper/, 7],
                [/dropper/, 6],
                [/dispenser/, 6],
                [/crafting/, 7],
                [/furnace/, 7],
                [/blast_furnace/, 7],
                [/smoker/, 7],
                [/brewing/, 7],
                [/cauldron/, 6],
                [/composter/, 5],
                
                // Ores (6-7)
                [/coal_ore/, 7],
                [/lapis/, 7],
                [/redstone_ore/, 7],
                [/quartz/, 6],
                
                // Food/Farming (6-7)
                [/fully grown/, 7],
                [/mature/, 7],
                [/farmland/, 5],
                [/hay_block/, 5],
                
                // Navigation/Utility (5-7)
                [/portal/, 8],
                [/bed/, 7],
                [/respawn/, 8],
                [/ladder/, 6],
                [/scaffolding/, 6],
                [/door/, 5],
                [/gate/, 5],
                [/torch/, 4],
                [/lantern/, 4],
                
                // Wood types (3)
                [/(oak|birch|spruce|jungle|acacia|dark_oak|mangrove|cherry|bamboo)_(log|wood|planks)/, 3],
                [/stripped/, 3],
                
                // Stone variants (2)
                [/(stone|andesite|diorite|granite|deepslate|blackstone|basalt)$/, 2],
                [/cobblestone/, 2],
                [/brick/, 3],
                [/smooth/, 2],
                [/polished/, 2],
                
                // Glass/Decorative (2)
                [/glass/, 2],
                [/wool/, 2],
                [/carpet/, 2],
                [/concrete/, 2],
                
                // Common terrain (1)
                [/dirt/, 1],
                [/grass_block/, 1],
                [/sand/, 2],
                [/gravel/, 2],
                [/clay/, 3],
                
                // Vegetation (1)
                [/leaves/, 1],
                [/flower/, 2],
                [/grass$/, 1],
                [/fern/, 1],
                
                // Liquids (3)
                [/water/, 3],
                
                // Ignore
                [/air/, 0]
            ];
            
            // Calculate importance scores
            const blockScores: Record<string, { count: number, importance: number, score: number }> = {};
            nearbyBlocks.forEach(block => {
                if (!blockScores[block]) {
                    // Find importance using regex patterns
                    let importance = 3; // Default importance for unmatched blocks
                    for (const [pattern, weight] of blockImportancePatterns) {
                        if (pattern.test(block.toLowerCase())) {
                            importance = Math.max(importance, weight);
                        }
                    }
                    
                    blockScores[block] = {
                        count: 0,
                        importance: importance,
                        score: 0
                    };
                }
                blockScores[block].count++;
            });
            
            // Calculate final scores (importance * sqrt(count) to balance rarity vs quantity)
            Object.values(blockScores).forEach(block => {
                block.score = block.importance * Math.sqrt(block.count);
            });
            
            // Sort by score (highest first)
            const sortedBlocks = Object.entries(blockScores)
                .sort((a, b) => b[1].score - a[1].score)
                .filter(([_, data]) => data.importance > 0); // Filter out air
            
            // Group by importance level for better readability
            const importantBlocks = sortedBlocks.filter(([_, d]) => d.importance >= 7);
            const usefulBlocks = sortedBlocks.filter(([_, d]) => d.importance >= 4 && d.importance < 7);
            const commonBlocks = sortedBlocks.filter(([_, d]) => d.importance < 4 && d.importance > 0);
            
            // Report important blocks first
            if (importantBlocks.length > 0) {
                observations.push(`Important blocks nearby:`);
                importantBlocks.slice(0, 10).forEach(([block, data]) => {
                    observations.push(`- ${data.count} ${block}`);
                });
            }
            
            // Then useful blocks
            if (usefulBlocks.length > 0) {
                observations.push(`Useful blocks:`);
                usefulBlocks.slice(0, 8).forEach(([block, data]) => {
                    observations.push(`- ${data.count} ${block}`);
                });
            }
            
            // Finally common blocks (summarized)
            if (commonBlocks.length > 0) {
                const topCommon = commonBlocks.slice(0, 5);
                if (topCommon.length > 0) {
                    observations.push(`Common blocks: ${topCommon.map(([b, d]) => `${b} (${d.count})`).join(', ')}`);
                }
            }
        }

        // Nearby entities
        const nearbyEntities = getNearbyEntities(bot, 16);
        if (nearbyEntities.length > 0) {
            observations.push(`\nYou see these entities nearby:`);
            nearbyEntities.forEach(entity => {
                observations.push(`- ${entity}`);
            });
        }

        // Inventory summary
        const inventory = getInventorySummary(bot);
        const itemCount = Object.keys(inventory).length;
        if (itemCount > 0) {
            observations.push(`\nYour inventory contains ${itemCount} different items:`);
            const sortedInventory = Object.entries(inventory)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10); // Show top 10 items

            sortedInventory.forEach(([item, count]) => {
                observations.push(`- ${item}: ${count}`);
            });

            if (itemCount > 10) {
                observations.push(`... and ${itemCount - 10} other item types`);
            }
        } else {
            observations.push(`\nYour inventory is empty.`);
        }

        // Check if drowning
        if (bot.oxygenLevel && bot.oxygenLevel < 20) {
            observations.push(`\nWARNING: You are underwater! Oxygen level: ${bot.oxygenLevel}/20`);
        }

        // Current interface
        if ((bot as any).currentInterface) {
            const currentInterface = (bot as any).currentInterface;
            observations.push(`\nYou have a ${currentInterface.title || 'interface'} open.`);
        }

        // Combine all observations
        const fullObservation = observations.join('\n');
        bot.emit('alteraBotEndObservation', fullObservation);

        return true;
    } catch (error) {
        console.error(`Error in lookAround skill: ${error}`);
        bot.emit('alteraBotEndObservation', `Failed to look around: ${error}`);
        return false;
    }
}


