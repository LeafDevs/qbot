import type { Client, TextChannel, User } from "discord.js";
import { getSpotifyService } from '../integrations/spotify.js';
import { createTrackEmbed, createStatusMessage } from '../commands/spotify.js';

// Polling interval in milliseconds (30 seconds)
const POLLING_INTERVAL = 30000;

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
    for (const [discordId, channelId] of channels.entries()) {
        try {
            // Check if user is still linked
            if (!spotifyService.isLinked(discordId)) {
                console.log(`User ${discordId} is no longer linked, removing channel config`);
                spotifyService.removeUserChannel(discordId);
                cleanedChannels++;
                continue;
            }
            
            // Check if channel still exists
            const channel = await client.channels.fetch(channelId) as TextChannel | null;
            if (!channel) {
                console.log(`Channel ${channelId} not found, removing config for user ${discordId}`);
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
    console.log(`[Spotify] Starting polling cycle at ${new Date().toISOString()}`);
    
    // Poll all users for currently playing tracks
    await spotifyService.pollAllUsers();
    
    // Update channel messages for users with channels configured
    const channels = spotifyService.getAllChannels();
    
    if (channels.size === 0) {
        console.log(`[Spotify] No channels configured, skipping update`);
        return;
    }
    
    console.log(`[Spotify] Updating ${channels.size} channel(s)`);
    
    for (const [discordId, channelId] of channels.entries()) {
        try {
            const channel = await client.channels.fetch(channelId) as TextChannel | null;
            if (!channel) {
                console.warn(`[Spotify] Channel ${channelId} not found, removing from config`);
                spotifyService.removeUserChannel(discordId);
                continue;
            }

            // Get previous track ID BEFORE calling getCurrentlyPlaying (which updates it)
            const previousTrackId = spotifyService.getLastTrackId(discordId);
            
            const track = await spotifyService.getCurrentlyPlaying(discordId);
            const messageId = spotifyService.getUserMessage(discordId);

            if (track) {
                // Fetch user to get proper mention
                let user: User;
                try {
                    user = await client.users.fetch(discordId);
                } catch (error) {
                    console.error(`[Spotify] Error fetching user ${discordId}:`, error);
                    continue;
                }

                const embed = createTrackEmbed(track, discordId);
                const content = createStatusMessage(user, track);
                
                // Check if song changed by comparing with previous track ID
                const currentTrackId = `${track.name}|${track.artist}`;
                const songChanged = !previousTrackId || previousTrackId !== currentTrackId;
                
                if (songChanged) {
                    // Song changed - always send a new message
                    console.log(`[Spotify] 🎵 NEW SONG detected for ${user.tag} (${user.id})`);
                    console.log(`[Spotify]   Previous: ${previousTrackId || 'none'}`);
                    console.log(`[Spotify]   Current: ${currentTrackId}`);
                    console.log(`[Spotify]   Channel: #${channel.name} (${channelId})`);
                    
                    const newMessage = await channel.send({ content, embeds: [embed] });
                    spotifyService.setUserMessage(discordId, newMessage.id);
                    
                    console.log(`[Spotify] ✅ Sent new message (ID: ${newMessage.id}) for "${track.name}" by ${track.artist}`);
                } else if (messageId) {
                    // Same song - edit existing message
                    try {
                        const message = await channel.messages.fetch(messageId);
                        await message.edit({ content, embeds: [embed] });
                        
                        console.log(`[Spotify] 🔄 Updated message for ${user.tag} (${user.id})`);
                        console.log(`[Spotify]   Song: "${track.name}" by ${track.artist}`);
                        console.log(`[Spotify]   Progress: ${Math.floor((track.progress / track.duration) * 100)}% (${Math.floor(track.progress / 1000)}s / ${Math.floor(track.duration / 1000)}s)`);
                        console.log(`[Spotify]   Message ID: ${messageId}`);
                    } catch (error) {
                        // Message might have been deleted, send a new one
                        console.warn(`[Spotify] ⚠️  Message ${messageId} not found for ${user.tag}, sending new message`);
                        const newMessage = await channel.send({ content, embeds: [embed] });
                        spotifyService.setUserMessage(discordId, newMessage.id);
                        console.log(`[Spotify] ✅ Sent replacement message (ID: ${newMessage.id})`);
                    }
                } else {
                    // No message ID - send new message (shouldn't happen if song hasn't changed, but handle it)
                    console.log(`[Spotify] 📝 No message ID found for ${user.tag}, sending initial message`);
                    const message = await channel.send({ content, embeds: [embed] });
                    spotifyService.setUserMessage(discordId, message.id);
                    console.log(`[Spotify] ✅ Sent initial message (ID: ${message.id})`);
                }
            } else {
                // User is not playing anything
                try {
                    const user = await client.users.fetch(discordId);
                    console.log(`[Spotify] ⏸️  ${user.tag} (${user.id}) is not currently playing anything`);
                } catch (error) {
                    console.log(`[Spotify] ⏸️  User ${discordId} is not currently playing anything`);
                }
            }
        } catch (error) {
            console.error(`[Spotify] ❌ Error updating channel for user ${discordId}:`, error);
        }
    }
    
    console.log(`[Spotify] Completed polling cycle`);
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