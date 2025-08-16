import { Bot } from 'mineflayer';
import { ISkillServiceParams, ISkillParams } from '../../types/skillType.js';
import { validateSkillParams } from '../index.js';
import { Screenshot3D } from '../../screenshot3d.js';

// Cache screenshot instances per bot
const screenshotInstances = new Map<string, Screenshot3D>();

/**
 * Captures a 3D screenshot of what the bot currently sees
 * 
 * @param {Bot} bot - The Mineflayer bot instance
 * @param {object} params - No parameters needed
 * @param {object} serviceParams - additional parameters for the skill function
 * @returns {Promise<boolean>} - Returns true if successful
 */
export const captureScreenshot = async (
    bot: Bot,
    params: ISkillParams,
    serviceParams: ISkillServiceParams,
): Promise<boolean> => {
    const skillName = 'captureScreenshot';
    const requiredParams: string[] = [];
    const isParamsValid = validateSkillParams(
        params,
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

    try {
        bot.emit('alteraBotStartObservation', '📸 Capturing 3D screenshot...');

        // Get the viewer port for this bot
        const viewerPort = (bot as any).viewerPort || 3007;
        const viewerUrl = `http://localhost:${viewerPort}`;
        
        // Get or create screenshot instance for this bot
        const botId = bot.username || 'default';
        let screenshot3d = screenshotInstances.get(botId);
        
        if (!screenshot3d) {
            screenshot3d = new Screenshot3D(viewerUrl);
            await screenshot3d.initialize();
            screenshotInstances.set(botId, screenshot3d);
        }
        
        // Check if viewer is accessible
        const viewerReady = await screenshot3d.checkViewerStatus();
        if (!viewerReady) {
            bot.emit(
                'alteraBotEndObservation',
                `Failed to capture screenshot: Web viewer not accessible at ${viewerUrl}. Make sure the viewer is running.`
            );
            return false;
        }
        
        // Capture the 3D screenshot
        const base64Image = await screenshot3d.capture();
        
        // Get bot position for context
        const pos = bot.entity.position;
        const positionStr = `X:${Math.floor(pos.x)}, Y:${Math.floor(pos.y)}, Z:${Math.floor(pos.z)}`;
        
        // Return the screenshot as a formatted message
        // Note: In a real MCP implementation, you might want to save this to a file
        // or return it in a different format depending on your needs
        bot.emit(
            'alteraBotEndObservation',
            `![3D Screenshot](data:image/jpeg;base64,${base64Image})\n\n` +
            `📸 3D screenshot captured successfully!\n` +
            `📍 Position: ${positionStr}\n` +
            `🌐 Viewer: ${viewerUrl}`
        );
        
        return true;
    } catch (error) {
        console.error(`Error in captureScreenshot skill: ${error}`);
        
        // Try to cleanup on error
        const botId = bot.username || 'default';
        const screenshot3d = screenshotInstances.get(botId);
        if (screenshot3d) {
            await screenshot3d.cleanup();
            screenshotInstances.delete(botId);
        }
        
        bot.emit(
            'alteraBotEndObservation',
            `Failed to capture screenshot: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
    }
};

// Cleanup function to be called when bot disconnects
export const cleanupScreenshot = async (botUsername: string) => {
    const screenshot3d = screenshotInstances.get(botUsername);
    if (screenshot3d) {
        await screenshot3d.cleanup();
        screenshotInstances.delete(botUsername);
    }
};