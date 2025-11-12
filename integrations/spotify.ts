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
    unlinkUser(discordId: string): boolean {
        const removed = this.users.delete(discordId);
        if (removed) {
            saveUsers(this.users);
            this.currentlyPlaying.delete(discordId);
            saveCurrentlyPlaying(this.currentlyPlaying);
            // Also remove channel and message
            this.channels.delete(discordId);
            saveChannels(this.channels);
            this.messages.delete(discordId);
            saveMessages(this.messages);
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
        } catch (error) {
            spotifyError(`[Spotify] ❌ Error refreshing token for user ${discordId}:`, error);
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
            return null;
        }

        const spotifyApi = new SpotifyWebApi({
            clientId: this.clientId,
            clientSecret: this.clientSecret,
            accessToken: user.accessToken,
            refreshToken: user.refreshToken,
        });

        // Check if token needs refresh
        if (Date.now() >= user.expiresAt - 60000) { // Refresh 1 minute before expiry
            const refreshed = await this.refreshUserToken(discordId);
            if (!refreshed) {
                return null;
            }
            // Get updated user data after refresh
            const updatedUser = this.users.get(discordId);
            if (updatedUser) {
                spotifyApi.setAccessToken(updatedUser.accessToken);
            }
        }

        return spotifyApi;
    }

    // Get currently playing track for a user
    async getCurrentlyPlaying(discordId: string): Promise<CurrentlyPlaying['track'] | null> {
        let api = await this.getUserApi(discordId);
        if (!api) {
            return null;
        }

        try {
            const response = await api.getMyCurrentPlayingTrack();
            
            if (!response.body.item) {
                // User is not currently playing anything
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
            if (artistId) {
                try {
                    const artistData = await api.getArtist(artistId);
                    artistImageUrl = artistData.body.images?.[0]?.url;
                } catch (error) {
                    // If fetching artist fails, continue without artist image
                    spotifyWarn(`[Spotify] Could not fetch artist image for ${artistId}:`, error);
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

            return track;
        } catch (error: any) {
            // Check if it's a 403 Forbidden error (expired/invalid token)
            if (error.statusCode === 403 || (error.body && error.statusCode === 403)) {
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
                        
                        if (!retryResponse.body.item) {
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
                        if (artistId) {
                            try {
                                const artistData = await api.getArtist(artistId);
                                artistImageUrl = artistData.body.images?.[0]?.url;
                            } catch (artistError) {
                                spotifyWarn(`[Spotify] Could not fetch artist image for ${artistId}:`, artistError);
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
                    } catch (retryError) {
                        spotifyError(`[Spotify] ❌ Retry failed after token refresh for user ${discordId}:`, retryError);
                        return null;
                    }
                } else {
                    // Token refresh failed, user may have revoked access
                    spotifyError(`[Spotify] ❌ Token refresh failed for user ${discordId}, they may need to re-link`);
                    return null;
                }
            }
            
            // For other errors, log and return null
            spotifyError(`[Spotify] Error getting currently playing for user ${discordId}:`, error);
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
    // Staggers requests by 1 second per user to avoid hitting rate limits
    async pollAllUsers(): Promise<void> {
        const userIds = Array.from(this.users.keys());
        if (userIds.length === 0) {
            return;
        }
        spotifyLog(`[Spotify] Polling ${userIds.length} user(s) for currently playing tracks (staggered by 1s)`);
        
        // Process users sequentially with 1 second delay between each
        for (let i = 0; i < userIds.length; i++) {
            const userId = userIds[i];
            if (!userId) continue;
            
            try {
                await this.getCurrentlyPlaying(userId);
            } catch (error) {
                spotifyError(`[Spotify] Error polling user ${userId}:`, error);
            }
            
            // Wait 1 second before next request (except for the last user)
            if (i < userIds.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
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
            if (error.statusCode === 403 || (error.body && error.statusCode === 403)) {
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
                    } catch (retryError) {
                        spotifyError(`[Spotify] ❌ Retry failed after token refresh for top tracks for user ${discordId}:`, retryError);
                        return null;
                    }
                } else {
                    // Token refresh failed, user may have revoked access
                    spotifyError(`[Spotify] ❌ Token refresh failed for user ${discordId}, they may need to re-link`);
                    return null;
                }
            }
            
            // For other errors, log and return null
            spotifyError(`[Spotify] Error getting top tracks for user ${discordId}:`, error);
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

