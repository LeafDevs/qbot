import { getSpotifyService } from './spotify.js';
import fs from 'fs';
import path from 'path';

// Store pending OAuth states
const DATA_DIR = path.join(process.cwd(), 'data');
const STATES_FILE = path.join(DATA_DIR, 'oauth-states.json');

function loadStates(): Map<string, string> {
    if (!fs.existsSync(STATES_FILE)) {
        return new Map();
    }
    try {
        const data = fs.readFileSync(STATES_FILE, 'utf-8');
        const states = JSON.parse(data);
        return new Map(Object.entries(states));
    } catch (error) {
        console.error('Error loading OAuth states:', error);
        return new Map();
    }
}

function saveStates(states: Map<string, string>): void {
    try {
        const data = Object.fromEntries(states);
        fs.writeFileSync(STATES_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving OAuth states:', error);
    }
}

function addState(state: string, discordId: string): void {
    const states = loadStates();
    states.set(state, discordId);
    saveStates(states);
}

function getState(state: string): string | undefined {
    const states = loadStates();
    return states.get(state);
}

function removeState(state: string): void {
    const states = loadStates();
    states.delete(state);
    saveStates(states);
}

// Export for use in commands
export { addState, getState, removeState };

// Start callback server if CALLBACK_PORT is set
const CALLBACK_PORT = process.env.SPOTIFY_CALLBACK_PORT ? parseInt(process.env.SPOTIFY_CALLBACK_PORT) : null;

if (CALLBACK_PORT) {
    startCallbackServer(CALLBACK_PORT);
}

function startCallbackServer(port: number) {
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/callback';
    const redirectUrl = new URL(redirectUri);
    const callbackPath = redirectUrl.pathname || '/callback';
    
    const server = Bun.serve({
        port,
        async fetch(req) {
            const url = new URL(req.url);
            
            if (url.pathname === callbackPath || url.pathname === '/callback') {
                const code = url.searchParams.get('code');
                const state = url.searchParams.get('state');
                const error = url.searchParams.get('error');
                
                if (error) {
                    return new Response(
                        `Error: ${error}. Please try again with /spotify-link`,
                        { status: 400, headers: { 'Content-Type': 'text/html' } }
                    );
                }
                
                if (!code || !state) {
                    return new Response(
                        'Missing code or state parameter. Please try again with /spotify-link',
                        { status: 400, headers: { 'Content-Type': 'text/html' } }
                    );
                }
                
                const discordId = getState(state);
                if (!discordId) {
                    return new Response(
                        'Invalid or expired state. Please try again with /spotify-link',
                        { status: 400, headers: { 'Content-Type': 'text/html' } }
                    );
                }
                
                try {
                    const spotifyService = getSpotifyService();
                    const tokens = await spotifyService.exchangeCodeForTokens(code);
                    
                    if (!tokens) {
                        return new Response(
                            'Failed to exchange authorization code. Please try again with /spotify-link',
                            { status: 500, headers: { 'Content-Type': 'text/html' } }
                        );
                    }
                    
                    spotifyService.linkUser(
                        discordId,
                        tokens.accessToken,
                        tokens.refreshToken,
                        tokens.expiresIn
                    );
                    
                    removeState(state);
                    
                    return new Response(
                        `✅ Successfully linked your Spotify account! You can close this window and return to Discord.`,
                        { headers: { 'Content-Type': 'text/html' } }
                    );
                } catch (error) {
                    console.error('Error in callback:', error);
                    return new Response(
                        'An error occurred while linking your account. Please try again with /spotify-link',
                        { status: 500, headers: { 'Content-Type': 'text/html' } }
                    );
                }
            }
            
            return new Response('Not Found', { status: 404 });
        },
    });
    
    const protocol = redirectUri.startsWith('https') ? 'https' : 'http';
    console.log(`Spotify OAuth callback server running on ${protocol}://localhost:${port}${callbackPath}`);
}

