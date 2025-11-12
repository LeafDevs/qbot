import SpotifyWebApi from 'spotify-web-api-node';
import fs from 'fs';
import path from 'path';

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

// Helper function to format full error response for logging
function formatErrorResponse(error: any): string {
    try {
        return JSON.stringify({
            statusCode: error.statusCode,
            message: error.message,
            body: error.body,
            headers: error.headers,
            stack: error.stack,
        }, null, 2);
    } catch {
        return String(error);
    }
}


// Types
export interface SpotifyUser {
    discordId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    spotifyId?: string;
}

export interface CurrentlyPlaying {
    discordId: string;
    track?: {
        name: string;
        artist: string;
        artistId?: string; // Primary artist ID for fetching artist image
        artistImageUrl?: string; // Primary artist profile image
        album?: string;
        url: string;
        imageUrl?: string;
        duration: number;
        progress: number;
        isPlaying: boolean;
    };
    lastUpdated: number;
    lastTrackId?: string; // Track identifier: "name|artist" to detect song changes
}

// Storage
const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'spotify-users.json');
const PLAYING_FILE = path.join(DATA_DIR, 'spotify-playing.json');
const CHANNELS_FILE = path.join(DATA_DIR, 'spotify-channels.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'spotify-messages.json'); // Store message IDs for updates

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load users from file
function loadUsers(): Map<string, SpotifyUser> {
    if (!fs.existsSync(USERS_FILE)) {
        return new Map();
    }
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf-8');
        const users = JSON.parse(data);
        return new Map(Object.entries(users));
    } catch (error) {
        console.error('Error loading Spotify users:', error);
        return new Map();
    }
}

// Save users to file
function saveUsers(users: Map<string, SpotifyUser>): void {
    try {
        const data = Object.fromEntries(users);
        fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving Spotify users:', error);
    }
}

// Load currently playing data
function loadCurrentlyPlaying(): Map<string, CurrentlyPlaying> {
    if (!fs.existsSync(PLAYING_FILE)) {
        return new Map();
    }
    try {
        const data = fs.readFileSync(PLAYING_FILE, 'utf-8');
        const playing = JSON.parse(data);
        return new Map(Object.entries(playing));
    } catch (error) {
        console.error('Error loading currently playing:', error);
        return new Map();
    }
}

// Save currently playing data
function saveCurrentlyPlaying(playing: Map<string, CurrentlyPlaying>): void {
    try {
        const data = Object.fromEntries(playing);
        fs.writeFileSync(PLAYING_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving currently playing:', error);
    }
}

// Load channel configurations
function loadChannels(): Map<string, string> { // discordId -> channelId
    if (!fs.existsSync(CHANNELS_FILE)) {
        return new Map();
    }
    try {
        const data = fs.readFileSync(CHANNELS_FILE, 'utf-8');
        const channels = JSON.parse(data);
        return new Map(Object.entries(channels));
    } catch (error) {
        console.error('Error loading Spotify channels:', error);
        return new Map();
    }
}

// Save channel configurations
function saveChannels(channels: Map<string, string>): void {
    try {
        const data = Object.fromEntries(channels);
        fs.writeFileSync(CHANNELS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving Spotify channels:', error);
    }
}

// Load message IDs for updates
function loadMessages(): Map<string, string> { // discordId -> messageId
    if (!fs.existsSync(MESSAGES_FILE)) {
        return new Map();
    }
    try {
        const data = fs.readFileSync(MESSAGES_FILE, 'utf-8');
        const messages = JSON.parse(data);
        return new Map(Object.entries(messages));
    } catch (error) {
        console.error('Error loading Spotify messages:', error);
        return new Map();
    }
}

// Save message IDs
function saveMessages(messages: Map<string, string>): void {
    try {
        const data = Object.fromEntries(messages);
        fs.writeFileSync(MESSAGES_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving Spotify messages:', error);
    }
}

// Spotify Service Class
export class SpotifyService {
    private users: Map<string, SpotifyUser>;
    private currentlyPlaying: Map<string, CurrentlyPlaying>;
    private channels: Map<string, string>; // discordId -> channelId
    private messages: Map<string, string>; // discordId -> messageId
    private clientId: string;
    private clientSecret: string;
    private redirectUri: string;

    constructor(clientId: string, clientSecret: string, redirectUri: string) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
        this.users = loadUsers();
        this.currentlyPlaying = loadCurrentlyPlaying();
        this.channels = loadChannels();
        this.messages = loadMessages();
    }

    // Get authorization URL for OAuth
    getAuthorizationUrl(state: string, scopes: string[] = ['user-read-currently-playing', 'user-read-playback-state', 'user-top-read']): string {
        const spotifyApi = new SpotifyWebApi({
            clientId: this.clientId,
            clientSecret: this.clientSecret,
            redirectUri: this.redirectUri,
        });

        return spotifyApi.createAuthorizeURL(scopes, state);
    }

    // Exchange authorization code for tokens
    async exchangeCodeForTokens(code: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
        const spotifyApi = new SpotifyWebApi({
            clientId: this.clientId,
            clientSecret: this.clientSecret,
            redirectUri: this.redirectUri,
        });

        try {
            const data = await spotifyApi.authorizationCodeGrant(code);
            return {
                accessToken: data.body.access_token,
                refreshToken: data.body.refresh_token,
                expiresIn: data.body.expires_in,
            };
        } catch (error) {
            console.error('Error exchanging code for tokens:', error);
            return null;
        }
    }

    // Link a user's Spotify account
    linkUser(discordId: string, accessToken: string, refreshToken: string, expiresIn: number): void {
        const expiresAt = Date.now() + (expiresIn * 1000);
        this.users.set(discordId, {
            discordId,
            accessToken,
            refreshToken,
            expiresAt,
        });
        saveUsers(this.users);
    }

    // Unlink a user's Spotify account
    // Note: In shared channel architecture, channel config persists independently
    // We only remove user-specific data (tokens, currently playing, messages)
    unlinkUser(discordId: string): boolean {
        const removed = this.users.delete(discordId);
        if (removed) {
            saveUsers(this.users);
            this.currentlyPlaying.delete(discordId);
            saveCurrentlyPlaying(this.currentlyPlaying);
            // Remove user's message ID (they won't be posting anymore)
            this.messages.delete(discordId);
            saveMessages(this.messages);
            // DO NOT remove channel config - shared channel persists independently
            // The channel will remain configured for other users even if this user unlinks
        }
        return removed;
    }

    // Check if user is linked
    isLinked(discordId: string): boolean {
        return this.users.has(discordId);
    }

    // Refresh access token for a user
    async refreshUserToken(discordId: string): Promise<boolean> {
        const user = this.users.get(discordId);
        if (!user) {
            return false;
        }

        const spotifyApi = new SpotifyWebApi({
            clientId: this.clientId,
            clientSecret: this.clientSecret,
            refreshToken: user.refreshToken,
        });

        try {
            spotifyLog(`[Spotify] 🔑 Refreshing access token for user ${discordId}`);
            const data = await spotifyApi.refreshAccessToken();
            const newAccessToken = data.body.access_token;
            const expiresIn = data.body.expires_in;

            // Update user token
            user.accessToken = newAccessToken;
            user.expiresAt = Date.now() + (expiresIn * 1000);
            this.users.set(discordId, user);
            saveUsers(this.users);

            spotifyLog(`[Spotify] ✅ Token refreshed successfully (expires in ${expiresIn}s)`);
            return true;
        } catch (error: any) {
            spotifyError(`[Spotify] ❌ Error refreshing token for user ${discordId}:`);
            spotifyError(`[Spotify] Full error response:\n${formatErrorResponse(error)}`);
            // If refresh fails, user may have revoked access - unlink them
            spotifyWarn(`[Spotify] Token refresh failed for user ${discordId}, they may have revoked access. Unlinking...`);
            this.unlinkUser(discordId);
            return false;
        }
    }

    // Get user's Spotify API instance (with refreshed token if needed)
    async getUserApi(discordId: string): Promise<SpotifyWebApi | null> {
        const user = this.users.get(discordId);
        if (!user) {
            spotifyWarn(`[Spotify] User ${discordId} not found in users map`);
            return null;
        }

        const now = Date.now();
        const timeUntilExpiry = user.expiresAt - now;
        spotifyLog(`[Spotify] Getting API for user ${discordId}, token expires in ${Math.floor(timeUntilExpiry / 1000)}s`);

        const spotifyApi = new SpotifyWebApi({
            clientId: this.clientId,
            clientSecret: this.clientSecret,
            accessToken: user.accessToken,
            refreshToken: user.refreshToken,
        });

        // Check if token needs refresh
        if (now >= user.expiresAt - 60000) { // Refresh 1 minute before expiry
            spotifyLog(`[Spotify] Token for user ${discordId} needs refresh (expires in ${Math.floor(timeUntilExpiry / 1000)}s)`);
            const refreshed = await this.refreshUserToken(discordId);
            if (!refreshed) {
                spotifyWarn(`[Spotify] Token refresh failed for user ${discordId}, returning null`);
                return null;
            }
            // Get updated user data after refresh
            const updatedUser = this.users.get(discordId);
            if (updatedUser) {
                spotifyApi.setAccessToken(updatedUser.accessToken);
                spotifyLog(`[Spotify] Updated API instance with new token for user ${discordId}`);
            } else {
                spotifyWarn(`[Spotify] User ${discordId} not found after token refresh`);
                return null;
            }
        }

        return spotifyApi;
    }

    // Get currently playing track for a user
    async getCurrentlyPlaying(discordId: string): Promise<CurrentlyPlaying['track'] | null> {
        let api = await this.getUserApi(discordId);
        if (!api) {
            spotifyWarn(`[Spotify] Failed to get API instance for user ${discordId} - user may not be linked or token refresh failed`);
            return null;
        }

        try {
            if (!api) {
                spotifyWarn(`[Spotify] API instance is null for user ${discordId}`);
                return null;
            }
            
            let response = await api.getMyCurrentPlayingTrack();
            
            // Log response details for debugging
            spotifyLog(`[Spotify] API response for user ${discordId}:`, {
                statusCode: response.statusCode,
                hasBody: !!response.body,
                hasItem: !!response.body?.item,
                isPlaying: response.body?.is_playing,
                itemType: response.body?.item?.type,
                itemName: response.body?.item?.name,
                progressMs: response.body?.progress_ms,
            });
            
            // Handle 204 No Content (user not playing)
            // Note: 204 can also mean the API doesn't have permission to see playback
            if (response.statusCode === 204) {
                // Check if this is happening consistently - if so, might be a scope issue
                const existing = this.currentlyPlaying.get(discordId);
                const consecutive204s = existing && !existing.track && existing.lastUpdated && (Date.now() - existing.lastUpdated < 30000);
                
                if (consecutive204s) {
                    spotifyWarn(`[Spotify] User ${discordId} consistently returning 204 No Content. This likely means:
- Token lacks 'user-read-currently-playing' scope (user should re-link), OR
- User's Spotify privacy settings block playback visibility`);
                } else {
                    spotifyLog(`[Spotify] User ${discordId} returned 204 No Content - not currently playing`);
                }
                
                const playing: CurrentlyPlaying = {
                    discordId,
                    lastUpdated: Date.now(),
                };
                this.currentlyPlaying.set(discordId, playing);
                saveCurrentlyPlaying(this.currentlyPlaying);
                return null;
            }
            
            if (!response.body || !response.body.item) {
                // User is not currently playing anything
                spotifyLog(`[Spotify] User ${discordId} is not currently playing (no item in response). Status: ${response.statusCode}, Body: ${JSON.stringify(response.body)}`);
                const playing: CurrentlyPlaying = {
                    discordId,
                    lastUpdated: Date.now(),
                };
                this.currentlyPlaying.set(discordId, playing);
                saveCurrentlyPlaying(this.currentlyPlaying);
                return null;
            }

            const item = response.body.item;
            
            // Check if it's a track (not an episode)
            if (item.type !== 'track') {
                // User is playing an episode/podcast, not a track
                const playing: CurrentlyPlaying = {
                    discordId,
                    lastUpdated: Date.now(),
                };
                this.currentlyPlaying.set(discordId, playing);
                saveCurrentlyPlaying(this.currentlyPlaying);
                return null;
            }

            const primaryArtist = item.artists[0];
            const artistId = primaryArtist?.id;
            
            // Fetch artist details to get profile image
            let artistImageUrl: string | undefined;
            if (artistId && api) {
                try {
                    const artistData = await api.getArtist(artistId);
                    artistImageUrl = artistData.body.images?.[0]?.url;
                } catch (error: any) {
                    // Handle rate limiting (429) - skip artist image if rate limited
                    if (error.statusCode === 429) {
                        const retryAfter = error.headers?.['retry-after'] || error.headers?.['Retry-After'];
                        spotifyWarn(`[Spotify] Rate limited when fetching artist image for ${artistId}. Retry after: ${retryAfter}s`);
                    } else if (error.statusCode === 403) {
                        // Token issue - skip artist image
                        spotifyWarn(`[Spotify] Auth error fetching artist image for ${artistId}, skipping`);
                    } else {
                        // Other errors - continue without artist image
                        spotifyWarn(`[Spotify] Could not fetch artist image for ${artistId} (${error.statusCode || 'unknown'}): ${error.message || 'Unknown error'}`);
                        spotifyWarn(`[Spotify] Full error response:\n${formatErrorResponse(error)}`);
                    }
                }
            }

            const track = {
                name: item.name,
                artist: item.artists.map((a: { name: string }) => a.name).join(', '),
                artistId: artistId,
                artistImageUrl: artistImageUrl,
                album: item.album?.name,
                url: item.external_urls.spotify,
                imageUrl: item.album?.images?.[0]?.url,
                duration: item.duration_ms,
                progress: response.body.progress_ms || 0,
                isPlaying: response.body.is_playing || false,
            };

            // Create track ID for change detection
            const trackId = `${track.name}|${track.artist}`;
            
            // Get existing playing data to preserve lastTrackId
            const existing = this.currentlyPlaying.get(discordId);
            const lastTrackId = existing?.lastTrackId;

            const playing: CurrentlyPlaying = {
                discordId,
                track,
                lastUpdated: Date.now(),
                lastTrackId: trackId, // Store current track ID
            };
            this.currentlyPlaying.set(discordId, playing);
            saveCurrentlyPlaying(this.currentlyPlaying);

            spotifyLog(`[Spotify] ✅ Successfully retrieved track for user ${discordId}: "${track.name}" by ${track.artist}`);
            return track;
        } catch (error: any) {
            // Check if it's a 403 Forbidden error (expired/invalid token)
            // Try multiple ways to extract status code
            const statusCode = error.statusCode 
                || error.status 
                || (error.body && error.body.error && error.body.error.status)
                || (error.response && error.response.statusCode)
                || (error.response && error.response.status);
            
            // Convert to number for comparison (handle string "403" vs number 403)
            const statusCodeNum = statusCode ? Number(statusCode) : null;
            
            spotifyLog(`[Spotify] Error caught for user ${discordId}, statusCode: ${statusCode} (${statusCodeNum}), error keys: ${Object.keys(error || {}).join(', ')}`);
            spotifyError(`[Spotify] Full error for debugging:\n${formatErrorResponse(error)}`);
            
            if (statusCodeNum === 403 || statusCode === 403 || statusCode === '403') {
                spotifyWarn(`[Spotify] Got 403 error for user ${discordId}, attempting token refresh...`);
                
                // Attempt to refresh the token
                const refreshed = await this.refreshUserToken(discordId);
                if (refreshed) {
                    // Retry the API call with refreshed token
                    try {
                        api = await this.getUserApi(discordId);
                        if (!api) {
                            return null;
                        }
                        const retryResponse = await api.getMyCurrentPlayingTrack();
                        
                        spotifyLog(`[Spotify] Retry API response for user ${discordId}:`, {
                            statusCode: retryResponse.statusCode,
                            hasBody: !!retryResponse.body,
                            hasItem: !!retryResponse.body?.item,
                            isPlaying: retryResponse.body?.is_playing,
                            itemType: retryResponse.body?.item?.type,
                            itemName: retryResponse.body?.item?.name,
                        });
                        
                        // Handle 204 No Content (user not playing)
                        if (retryResponse.statusCode === 204) {
                            spotifyLog(`[Spotify] User ${discordId} returned 204 No Content on retry - not currently playing`);
                            const playing: CurrentlyPlaying = {
                                discordId,
                                lastUpdated: Date.now(),
                            };
                            this.currentlyPlaying.set(discordId, playing);
                            saveCurrentlyPlaying(this.currentlyPlaying);
                            return null;
                        }
                        
                        if (!retryResponse.body || !retryResponse.body.item) {
                            spotifyLog(`[Spotify] User ${discordId} is not currently playing after retry (no item in response). Status: ${retryResponse.statusCode}`);
                            const playing: CurrentlyPlaying = {
                                discordId,
                                lastUpdated: Date.now(),
                            };
                            this.currentlyPlaying.set(discordId, playing);
                            saveCurrentlyPlaying(this.currentlyPlaying);
                            return null;
                        }

                        const item = retryResponse.body.item;
                        
                        if (item.type !== 'track') {
                            const playing: CurrentlyPlaying = {
                                discordId,
                                lastUpdated: Date.now(),
                            };
                            this.currentlyPlaying.set(discordId, playing);
                            saveCurrentlyPlaying(this.currentlyPlaying);
                            return null;
                        }

                        const primaryArtist = item.artists[0];
                        const artistId = primaryArtist?.id;
                        
                        let artistImageUrl: string | undefined;
                        if (artistId && api) {
                            try {
                                const artistData = await api.getArtist(artistId);
                                artistImageUrl = artistData.body.images?.[0]?.url;
                            } catch (artistError: any) {
                                // Handle rate limiting (429) - skip artist image if rate limited
                                if (artistError.statusCode === 429) {
                                    const retryAfter = artistError.headers?.['retry-after'] || artistError.headers?.['Retry-After'];
                                    spotifyWarn(`[Spotify] Rate limited when fetching artist image for ${artistId}. Retry after: ${retryAfter}s`);
                                } else if (artistError.statusCode === 403) {
                                    spotifyWarn(`[Spotify] Auth error fetching artist image for ${artistId}, skipping`);
                                } else {
                                    spotifyWarn(`[Spotify] Could not fetch artist image for ${artistId} (${artistError.statusCode || 'unknown'}): ${artistError.message || 'Unknown error'}`);
                                    spotifyWarn(`[Spotify] Full error response:\n${formatErrorResponse(artistError)}`);
                                }
                            }
                        }

                        const track = {
                            name: item.name,
                            artist: item.artists.map((a: { name: string }) => a.name).join(', '),
                            artistId: artistId,
                            artistImageUrl: artistImageUrl,
                            album: item.album?.name,
                            url: item.external_urls.spotify,
                            imageUrl: item.album?.images?.[0]?.url,
                            duration: item.duration_ms,
                            progress: retryResponse.body.progress_ms || 0,
                            isPlaying: retryResponse.body.is_playing || false,
                        };

                        const trackId = `${track.name}|${track.artist}`;
                        const existing = this.currentlyPlaying.get(discordId);
                        const lastTrackId = existing?.lastTrackId;

                        const playing: CurrentlyPlaying = {
                            discordId,
                            track,
                            lastUpdated: Date.now(),
                            lastTrackId: trackId,
                        };
                        this.currentlyPlaying.set(discordId, playing);
                        saveCurrentlyPlaying(this.currentlyPlaying);

                        spotifyLog(`[Spotify] ✅ Successfully retried after token refresh for user ${discordId}`);
                        return track;
                    } catch (retryError: any) {
                        spotifyError(`[Spotify] ❌ Retry failed after token refresh for user ${discordId}:`);
                        spotifyError(`[Spotify] Full error response:\n${formatErrorResponse(retryError)}`);
                        return null;
                    }
                } else {
                    // Token refresh failed, user may have revoked access
                    spotifyError(`[Spotify] ❌ Token refresh failed for user ${discordId}, they may need to re-link`);
                    return null;
                }
            }
            
            // Handle rate limiting (429)
            if (statusCode === 429) {
                const retryAfter = error.headers?.['retry-after'] || error.headers?.['Retry-After'];
                spotifyWarn(`[Spotify] Rate limited for user ${discordId}. Retry after: ${retryAfter}s`);
                return null;
            }
            
            // For other errors, log and return null
            const errorMessage = error.message || error.body?.error?.message || String(error.message || 'Unknown error');
            spotifyError(`[Spotify] Error getting currently playing for user ${discordId} (${statusCode || 'unknown'}): ${errorMessage}`);
            spotifyError(`[Spotify] Full error response:\n${formatErrorResponse(error)}`);
            
            // If we got a 403 but didn't catch it above, try refreshing token anyway
            if (statusCodeNum === 403 || statusCode === 403 || statusCode === '403' || error.statusCode === 403) {
                spotifyWarn(`[Spotify] Detected 403 in fallback handler for user ${discordId}, attempting token refresh...`);
                const refreshed = await this.refreshUserToken(discordId);
                if (refreshed) {
                    spotifyLog(`[Spotify] Token refreshed in fallback handler, retrying API call...`);
                    // Retry once more
                    try {
                        api = await this.getUserApi(discordId);
                        if (api) {
                            const finalRetry = await api.getMyCurrentPlayingTrack();
                            
                            if (finalRetry.body?.item && finalRetry.body.item.type === 'track') {
                                const item = finalRetry.body.item;
                                const track = {
                                    name: item.name,
                                    artist: item.artists.map((a: { name: string }) => a.name).join(', '),
                                    artistId: item.artists[0]?.id,
                                    artistImageUrl: undefined,
                                    album: item.album?.name,
                                    url: item.external_urls.spotify,
                                    imageUrl: item.album?.images?.[0]?.url,
                                    duration: item.duration_ms,
                                    progress: finalRetry.body.progress_ms || 0,
                                    isPlaying: finalRetry.body.is_playing || false,
                                };
                                
                                const trackId = `${track.name}|${track.artist}`;
                                const playing: CurrentlyPlaying = {
                                    discordId,
                                    track,
                                    lastUpdated: Date.now(),
                                    lastTrackId: trackId,
                                };
                                this.currentlyPlaying.set(discordId, playing);
                                saveCurrentlyPlaying(this.currentlyPlaying);
                                
                                spotifyLog(`[Spotify] ✅ Successfully retrieved track after fallback retry for user ${discordId}: "${track.name}" by ${track.artist}`);
                                return track;
                            }
                        }
                    } catch (finalError: any) {
                        spotifyError(`[Spotify] Final retry failed for user ${discordId}:`, finalError);
                    }
                }
            }
            
            return null;
        }
    }

    // Get all currently playing tracks
    getAllCurrentlyPlaying(): Map<string, CurrentlyPlaying> {
        return new Map(this.currentlyPlaying);
    }

    // Get all linked users
    getAllLinkedUsers(): string[] {
        return Array.from(this.users.keys());
    }

    // Poll all users for currently playing tracks
    // Adds a small delay between requests to avoid rate limiting
    async pollAllUsers(): Promise<void> {
        const userIds = Array.from(this.users.keys());
        if (userIds.length === 0) {
            return;
        }
        spotifyLog(`[Spotify] Polling ${userIds.length} user(s) for currently playing tracks`);
        
        // Process users sequentially with a small delay between requests
        for (let i = 0; i < userIds.length; i++) {
            const userId = userIds[i];
            if (!userId) continue;
            
            try {
                await this.getCurrentlyPlaying(userId);
                
                // Add a small delay between requests (except after the last one)
                if (i < userIds.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
                }
            } catch (error: any) {
                spotifyError(`[Spotify] Error polling user ${userId}:`);
                spotifyError(`[Spotify] Full error response:\n${formatErrorResponse(error)}`);
            }
        }
    }

    // Channel management
    setUserChannel(discordId: string, channelId: string): void {
        this.channels.set(discordId, channelId);
        saveChannels(this.channels);
    }

    removeUserChannel(discordId: string): boolean {
        const removed = this.channels.delete(discordId);
        if (removed) {
            saveChannels(this.channels);
            this.messages.delete(discordId);
            saveMessages(this.messages);
        }
        return removed;
    }

    getUserChannel(discordId: string): string | undefined {
        return this.channels.get(discordId);
    }

    getAllChannels(): Map<string, string> {
        return new Map(this.channels);
    }

    // Get the shared Spotify channel (uses the first user's channel)
    getSpotifyChannel(): string | undefined {
        const firstChannel = this.channels.values().next().value;
        return firstChannel;
    }

    // Message management
    setUserMessage(discordId: string, messageId: string): void {
        if (messageId) {
            this.messages.set(discordId, messageId);
        } else {
            this.messages.delete(discordId);
        }
        saveMessages(this.messages);
    }

    getUserMessage(discordId: string): string | undefined {
        return this.messages.get(discordId);
    }

    clearUserMessage(discordId: string): void {
        this.messages.delete(discordId);
        saveMessages(this.messages);
    }

    // Check if song changed
    hasSongChanged(discordId: string, currentTrack: { name: string; artist: string }): boolean {
        const playing = this.currentlyPlaying.get(discordId);
        if (!playing || !playing.lastTrackId) {
            return true; // No previous track, consider it changed
        }
        const currentTrackId = `${currentTrack.name}|${currentTrack.artist}`;
        return playing.lastTrackId !== currentTrackId;
    }

    // Get last track ID for a user
    getLastTrackId(discordId: string): string | undefined {
        const playing = this.currentlyPlaying.get(discordId);
        return playing?.lastTrackId;
    }

    // Get user's top tracks
    async getTopTracks(discordId: string, timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term', limit: number = 10): Promise<Array<{ name: string; artist: string; album: string; url: string; imageUrl?: string; popularity: number }> | null> {
        let api = await this.getUserApi(discordId);
        if (!api) {
            return null;
        }

        try {
            const response = await api.getMyTopTracks({
                time_range: timeRange,
                limit: limit,
            });

            if (!response.body.items || response.body.items.length === 0) {
                return [];
            }

            return response.body.items.map((track: any) => ({
                name: track.name,
                artist: track.artists.map((a: { name: string }) => a.name).join(', '),
                album: track.album.name,
                url: track.external_urls.spotify,
                imageUrl: track.album.images?.[0]?.url,
                popularity: track.popularity || 0,
            }));
        } catch (error: any) {
            // Check if it's a 403 Forbidden error (expired/invalid token)
            const statusCode = error.statusCode || (error.body && error.body.error && error.body.error.status);
            if (statusCode === 403) {
                spotifyWarn(`[Spotify] Got 403 error for top tracks for user ${discordId}, attempting token refresh...`);
                
                // Attempt to refresh the token
                const refreshed = await this.refreshUserToken(discordId);
                if (refreshed) {
                    // Retry the API call with refreshed token
                    try {
                        api = await this.getUserApi(discordId);
                        if (!api) {
                            return null;
                        }
                        const retryResponse = await api.getMyTopTracks({
                            time_range: timeRange,
                            limit: limit,
                        });

                        if (!retryResponse.body.items || retryResponse.body.items.length === 0) {
                            return [];
                        }

                        spotifyLog(`[Spotify] ✅ Successfully retried top tracks after token refresh for user ${discordId}`);
                        return retryResponse.body.items.map((track: any) => ({
                            name: track.name,
                            artist: track.artists.map((a: { name: string }) => a.name).join(', '),
                            album: track.album.name,
                            url: track.external_urls.spotify,
                            imageUrl: track.album.images?.[0]?.url,
                            popularity: track.popularity || 0,
                        }));
                    } catch (retryError: any) {
                        spotifyError(`[Spotify] ❌ Retry failed after token refresh for top tracks for user ${discordId}:`);
                        spotifyError(`[Spotify] Full error response:\n${formatErrorResponse(retryError)}`);
                        return null;
                    }
                } else {
                    // Token refresh failed, user may have revoked access
                    spotifyError(`[Spotify] ❌ Token refresh failed for user ${discordId}, they may need to re-link`);
                    return null;
                }
            }
            
            // Handle rate limiting (429)
            if (statusCode === 429) {
                const retryAfter = error.headers?.['retry-after'] || error.headers?.['Retry-After'];
                spotifyWarn(`[Spotify] Rate limited for top tracks for user ${discordId}. Retry after: ${retryAfter}s`);
                return null;
            }
            
            // For other errors, log and return null
            const errorMessage = error.message || error.body?.error?.message || 'Unknown error';
            spotifyError(`[Spotify] Error getting top tracks for user ${discordId} (${statusCode || 'unknown'}): ${errorMessage}`);
            spotifyError(`[Spotify] Full error response:\n${formatErrorResponse(error)}`);
            return null;
        }
    }
}

// Singleton instance (will be initialized in index.ts)
let spotifyServiceInstance: SpotifyService | null = null;

export function getSpotifyService(): SpotifyService {
    if (!spotifyServiceInstance) {
        const clientId = process.env.SPOTIFY_CLIENT_ID;
        const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
        const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/callback';

        if (!clientId || !clientSecret) {
            throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in environment variables');
        }

        spotifyServiceInstance = new SpotifyService(clientId, clientSecret, redirectUri);
    }
    return spotifyServiceInstance;
}

