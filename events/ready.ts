import type { Client, TextChannel, User } from "discord.js";
import { getSpotifyService } from '../integrations/spotify.js';
import { createTrackEmbed, createStatusMessage } from '../commands/spotify.js';

// Check if Spotify debug logging is muted
function shouldMuteSpotifyDebug(): boolean {
    return process.env.MUTE_SPOTIFY_DEBUG === 'true';
}

// Helper function for Spotify debug logs
function spotifyLog(...args: any[]): void {
    if (!shouldMuteSpotifyDebug()) {
        console.log(...args);
    }
}

function spotifyWarn(...args: any[]): void {
    if (!shouldMuteSpotifyDebug()) {
        console.warn(...args);
    }
}

// Error logs should always show (not muted)
function spotifyError(...args: any[]): void {
    console.error(...args);
}

// Polling interval in milliseconds (10 seconds)
const POLLING_INTERVAL = 2000;

let pollingInterval: NodeJS.Timeout | null = null;
let clientInstance: Client | null = null;

export default {
    name: 'clientReady',
    once: true,
    execute(client: Client) {
        console.log(`Logged in as ${client.user?.tag ?? 'unknown'}`);
        clientInstance = client;
        
        // Initialize Spotify polling if credentials are available
        try {
            const spotifyService = getSpotifyService();
            console.log('Spotify service initialized. Starting polling...');
            
            // Validate and clean up persisted data on startup
            validatePersistedData(spotifyService, client).then(() => {
                // Start polling for currently playing tracks
                startPolling(spotifyService, client);
            }).catch(console.error);
        } catch (error) {
            console.warn('Spotify service not initialized. Make sure SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are set.');
        }
    },
};

function startPolling(spotifyService: ReturnType<typeof getSpotifyService>, client: Client) {
    // Poll immediately on startup
    pollAndUpdateChannels(spotifyService, client).catch(console.error);
    
    // Then poll at regular intervals
    pollingInterval = setInterval(() => {
        pollAndUpdateChannels(spotifyService, client).catch(console.error);
    }, POLLING_INTERVAL);
    
    console.log(`Spotify polling started (interval: ${POLLING_INTERVAL / 1000}s)`);
}

async function validatePersistedData(spotifyService: ReturnType<typeof getSpotifyService>, client: Client) {
    console.log('Validating persisted Spotify data...');
    const channels = spotifyService.getAllChannels();
    const linkedUsers = spotifyService.getAllLinkedUsers();
    
    let cleanedChannels = 0;
    let cleanedMessages = 0;
    
    // Check each configured channel
    // Note: In shared channel architecture, channel config persists independently of user link status
    // We only validate that the channel exists in Discord
    for (const [discordId, channelId] of channels.entries()) {
        try {
            // Check if channel still exists
            const channel = await client.channels.fetch(channelId) as TextChannel | null;
            if (!channel) {
                console.log(`Channel ${channelId} not found, removing config`);
                spotifyService.removeUserChannel(discordId);
                cleanedChannels++;
                continue;
            }
            
            // Check if message still exists
            const messageId = spotifyService.getUserMessage(discordId);
            if (messageId) {
                try {
                    await channel.messages.fetch(messageId);
                    // Message exists, all good
                } catch (error) {
                    // Message was deleted, clear the message ID but keep the channel
                    console.log(`Message ${messageId} not found for user ${discordId}, will send new message on next update`);
                    spotifyService.clearUserMessage(discordId); // Clear invalid message ID
                    cleanedMessages++;
                }
            }
        } catch (error) {
            console.error(`Error validating data for user ${discordId}:`, error);
            // Remove invalid channel config on error
            spotifyService.removeUserChannel(discordId);
            cleanedChannels++;
        }
    }
    
    // Clean up orphaned message IDs (users with messages but no channels)
    for (const discordId of linkedUsers) {
        const messageId = spotifyService.getUserMessage(discordId);
        if (messageId && !channels.has(discordId)) {
            // User has a message ID but no channel config
            spotifyService.clearUserMessage(discordId);
            cleanedMessages++;
        }
    }
    
    if (cleanedChannels > 0 || cleanedMessages > 0) {
        console.log(`Cleaned up ${cleanedChannels} invalid channel configs and ${cleanedMessages} invalid message IDs`);
    }
    
    const activeChannels = spotifyService.getAllChannels().size;
    console.log(`Found ${activeChannels} active Spotify channel configurations`);
    
    // Log summary of persisted data
    console.log(`Persisted data summary: ${linkedUsers.length} linked users, ${activeChannels} channel configs`);
}

async function pollAndUpdateChannels(spotifyService: ReturnType<typeof getSpotifyService>, client: Client) {
    spotifyLog(`[Spotify] Starting polling cycle at ${new Date().toISOString()}`);
    
    // Get the shared Spotify channel (uses first user's channel)
    const spotifyChannelId = spotifyService.getSpotifyChannel();
    
    if (!spotifyChannelId) {
        spotifyLog(`[Spotify] No Spotify channel configured, skipping update`);
        return;
    }
    
    // Get all linked users
    const linkedUsers = spotifyService.getAllLinkedUsers();
    
    if (linkedUsers.length === 0) {
        spotifyLog(`[Spotify] No linked users, skipping update`);
        return;
    }
    
    // Get previous track IDs BEFORE polling (which updates them)
    const previousTrackIds = new Map<string, string | undefined>();
    for (const discordId of linkedUsers) {
        previousTrackIds.set(discordId, spotifyService.getLastTrackId(discordId));
    }
    
    // Poll all users for currently playing tracks
    await spotifyService.pollAllUsers();
    
    // Fetch the shared Spotify channel
    const channel = await client.channels.fetch(spotifyChannelId) as TextChannel | null;
    if (!channel) {
        spotifyWarn(`[Spotify] Spotify channel ${spotifyChannelId} not found`);
        return;
    }
    
    spotifyLog(`[Spotify] Updating Spotify channel for ${linkedUsers.length} user(s)`);
    
    // Update messages for all linked users in the shared channel
    for (const discordId of linkedUsers) {
        try {
            // Get the previous track ID we captured BEFORE polling
            const previousTrackId = previousTrackIds.get(discordId);
            
            // Get current track (already polled, but we need the track object)
            const currentlyPlaying = spotifyService.getAllCurrentlyPlaying().get(discordId);
            const track = currentlyPlaying?.track || null;
            const messageId = spotifyService.getUserMessage(discordId);

            if (track) {
                // Fetch user to get proper mention
                let user: User;
                try {
                    user = await client.users.fetch(discordId);
                } catch (error) {
                    spotifyError(`[Spotify] Error fetching user ${discordId}:`, error);
                    continue;
                }

                const embed = createTrackEmbed(track, user);
                const content = createStatusMessage(user, track);
                
                // Check if song changed by comparing full track ID (name|artist format)
                // previousTrackId is stored as "name|artist"
                const currentTrackId = `${track.name}|${track.artist}`;
                const songChanged = !previousTrackId || previousTrackId !== currentTrackId;
                
                if (songChanged) {
                    spotifyLog(`[Spotify] 🎵 NEW SONG detected for ${user.tag} (${user.id})`);
                    spotifyLog(`[Spotify]   Previous: ${previousTrackId || 'none'}`);
                    spotifyLog(`[Spotify]   Current: ${currentTrackId}`);
                }
                
                // Always try to edit existing message first
                if (messageId) {
                    try {
                        const message = await channel.messages.fetch(messageId);
                        
                        // Check if it's a Drake song and roll for 5% chance to ping @everyone (only on song change)
                        let messageContent = content;
                        if (songChanged) {
                            const isDrakeSong = track.artist.toLowerCase().includes('drake');
                            const shouldPingEveryone = isDrakeSong && Math.random() < 0.05;
                            
                            if (shouldPingEveryone) {
                                messageContent = `@everyone look at this loser doing a drake and drive\n\n${content}`;
                                spotifyLog(`[Spotify] 🎲 DRAKE DETECTED! Rolling ping... SUCCESS! Pinging @everyone`);
                            }
                        }
                        
                        await message.edit({ content: messageContent, embeds: [embed] });
                        
                        if (songChanged) {
                            spotifyLog(`[Spotify] ✅ Edited message (ID: ${messageId}) for new song "${track.name}" by ${track.artist}`);
                        } else {
                            spotifyLog(`[Spotify] 🔄 Updated message for ${user.tag} (${user.id})`);
                            spotifyLog(`[Spotify]   Song: "${track.name}" by ${track.artist}`);
                            spotifyLog(`[Spotify]   Progress: ${Math.floor((track.progress / track.duration) * 100)}% (${Math.floor(track.progress / 1000)}s / ${Math.floor(track.duration / 1000)}s)`);
                            spotifyLog(`[Spotify]   Message ID: ${messageId}`);
                        }
                    } catch (error) {
                        // Message might have been deleted, send a new one
                        spotifyWarn(`[Spotify] ⚠️  Message ${messageId} not found for ${user.tag}, sending new message`);
                        
                        // Check if it's a Drake song and roll for 5% chance to ping @everyone (only on song change)
                        let messageContent = content;
                        if (songChanged) {
                            const isDrakeSong = track.artist.toLowerCase().includes('drake');
                            const shouldPingEveryone = isDrakeSong && Math.random() < 0.05;
                            
                            if (shouldPingEveryone) {
                                messageContent = `@everyone look at this loser doing a drake and drive\n\n${content}`;
                                spotifyLog(`[Spotify] 🎲 DRAKE DETECTED! Rolling ping... SUCCESS! Pinging @everyone`);
                            }
                        }
                        
                        const newMessage = await channel.send({ content: messageContent, embeds: [embed] });
                        spotifyService.setUserMessage(discordId, newMessage.id);
                        spotifyLog(`[Spotify] ✅ Sent replacement message (ID: ${newMessage.id})`);
                    }
                } else {
                    // No message ID - send initial message
                    spotifyLog(`[Spotify] 📝 No message ID found for ${user.tag}, sending initial message`);
                    
                    // Check if it's a Drake song and roll for 5% chance to ping @everyone (only on song change)
                    let messageContent = content;
                    if (songChanged) {
                        const isDrakeSong = track.artist.toLowerCase().includes('drake');
                        const shouldPingEveryone = isDrakeSong && Math.random() < 0.05;
                        
                        if (shouldPingEveryone) {
                            messageContent = `@everyone look at this loser doing a drake and drive\n\n${content}`;
                            spotifyLog(`[Spotify] 🎲 DRAKE DETECTED! Rolling ping... SUCCESS! Pinging @everyone`);
                        }
                    }
                    
                    const message = await channel.send({ content: messageContent, embeds: [embed] });
                    spotifyService.setUserMessage(discordId, message.id);
                    spotifyLog(`[Spotify] ✅ Sent initial message (ID: ${message.id})`);
                }
            } else {
                // User is not playing anything
                try {
                    const user = await client.users.fetch(discordId);
                    spotifyLog(`[Spotify] ⏸️  ${user.tag} (${user.id}) is not currently playing anything`);
                } catch (error) {
                    spotifyLog(`[Spotify] ⏸️  User ${discordId} is not currently playing anything`);
                }
            }
        } catch (error) {
            spotifyError(`[Spotify] ❌ Error updating channel for user ${discordId}:`, error);
        }
    }
    
    spotifyLog(`[Spotify] Completed polling cycle`);
}

// Cleanup on process exit
process.on('SIGINT', () => {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        console.log('Spotify polling stopped');
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        console.log('Spotify polling stopped');
    }
    process.exit(0);
});