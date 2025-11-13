import { SlashCommandBuilder, ChatInputCommandInteraction, type Client, EmbedBuilder, type TextChannel, PermissionFlagsBits, type User } from 'discord.js';
import { getSpotifyService } from '../integrations/spotify.js';
import { addState } from '../integrations/spotify-oauth.js';
import crypto from 'crypto';

// Sound visualizer GIF URL - you can replace this with your own visualizer GIF
// Some options:
// - Upload your own visualizer GIF to imgur/imgbb/etc
// - Use: https://i.imgur.com/your-gif-id.gif
// - Or use a service that generates visualizers
const VISUALIZER_GIF_URL = 'https://i.imgur.com/8Z7XK9L.gif'; // Placeholder - replace with your visualizer GIF

// Extract dominant color from image URL using a color extraction API
// We'll use a simple approach: fetch image and use color-thief-like algorithm
async function getDominantColor(imageUrl: string): Promise<number> {
    try {
        // Use a color extraction API service
        // For now, we'll use a simple hash-based approach that gives consistent colors
        // In production, you might want to use a proper image processing library
        
        // Fetch the image to get some data
        const response = await fetch(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        
        if (!response.ok) {
            return 0x1DB954; // Default Spotify green if fetch fails
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Use a color extraction algorithm
        // Sample colors from different parts of the image buffer
        // This is a simplified approach - for better results, decode the actual image
        
        // Get colors from different positions in the buffer
        const samples: number[] = [];
        const sampleSize = Math.min(buffer.length, 10000); // Sample first 10KB
        
        for (let i = 0; i < sampleSize - 2; i += 3) {
            const r = buffer[i] || 0;
            const g = buffer[i + 1] || 0;
            const b = buffer[i + 2] || 0;
            
            // Skip very dark or very light pixels
            const brightness = (r + g + b) / 3;
            if (brightness > 20 && brightness < 240) {
                samples.push((r << 16) | (g << 8) | b);
            }
        }
        
        if (samples.length === 0) {
            return 0x1DB954; // Default if no good samples
        }
        
        // Find the most common color bucket
        const colorBuckets = new Map<number, number>();
        const bucketSize = 16; // Group similar colors together
        
        for (const color of samples) {
            const r = (color >> 16) & 0xFF;
            const g = (color >> 8) & 0xFF;
            const b = color & 0xFF;
            
            // Quantize colors into buckets
            const rBucket = Math.floor(r / bucketSize) * bucketSize;
            const gBucket = Math.floor(g / bucketSize) * bucketSize;
            const bBucket = Math.floor(b / bucketSize) * bucketSize;
            
            const bucketKey = (rBucket << 16) | (gBucket << 8) | bBucket;
            colorBuckets.set(bucketKey, (colorBuckets.get(bucketKey) || 0) + 1);
        }
        
        // Find the most common bucket
        let maxCount = 0;
        let dominantColor = 0x1DB954;
        
        for (const [color, count] of colorBuckets.entries()) {
            if (count > maxCount) {
                maxCount = count;
                dominantColor = color;
            }
        }
        
        // Ensure the color is vibrant enough
        const r = (dominantColor >> 16) & 0xFF;
        const g = (dominantColor >> 8) & 0xFF;
        const b = dominantColor & 0xFF;
        
        const brightness = (r + g + b) / 3;
        const saturation = Math.max(r, g, b) - Math.min(r, g, b);
        
        // If color is too dark, lighten it; if too light, darken it
        if (brightness < 50) {
            // Too dark, brighten it
            const factor = 50 / brightness;
            dominantColor = (
                (Math.min(255, Math.floor(r * factor)) << 16) |
                (Math.min(255, Math.floor(g * factor)) << 8) |
                Math.min(255, Math.floor(b * factor))
            );
        } else if (brightness > 200 && saturation < 30) {
            // Too light and not saturated, darken it
            dominantColor = (
                (Math.floor(r * 0.7) << 16) |
                (Math.floor(g * 0.7) << 8) |
                Math.floor(b * 0.7)
            );
        }
        
        return dominantColor;
    } catch (error) {
        console.error('Error extracting dominant color:', error);
        return 0x1DB954; // Default Spotify green
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('spotify')
        .setDescription('Manage your Spotify integration')
        .addSubcommand(subcommand =>
            subcommand
                .setName('link')
                .setDescription('Link your Spotify account to display what you\'re playing')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('unlink')
                .setDescription('Unlink your Spotify account')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Check your current Spotify playback status')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('complete')
                .setDescription('Complete Spotify account linking with authorization code (fallback method)')
                .addStringOption(option =>
                    option
                        .setName('code')
                        .setDescription('The authorization code from Spotify')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('channel')
                .setDescription('Set the shared Spotify channel where all users\' Spotify statuses will be displayed')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('The channel to display Spotify statuses in (shared for all users)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove-channel')
                .setDescription('Remove the channel where your Spotify status is displayed')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('top-tracks')
                .setDescription('View your top 10 Spotify tracks')
                .addStringOption(option =>
                    option
                        .setName('period')
                        .setDescription('Time period for top tracks')
                        .setRequired(true)
                        .addChoices(
                            { name: 'All Time', value: 'long_term' },
                            { name: 'This Year', value: 'medium_term' },
                            { name: 'This Month', value: 'short_term' }
                        )
                )
        ),
    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        const subcommand = interaction.options.getSubcommand();
        const spotifyService = getSpotifyService();
        const discordId = interaction.user.id;

        try {
            switch (subcommand) {
                case 'link':
                    await handleLink(interaction, spotifyService, discordId);
                    break;
                case 'unlink':
                    await handleUnlink(interaction, spotifyService, discordId);
                    break;
                case 'status':
                    await handleStatus(interaction, spotifyService, discordId);
                    break;
                case 'complete':
                    await handleComplete(interaction, spotifyService, discordId);
                    break;
                case 'channel':
                    await handleChannel(interaction, spotifyService, discordId, client);
                    break;
                case 'remove-channel':
                    await handleRemoveChannel(interaction, spotifyService, discordId);
                    break;
                case 'top-tracks':
                    await handleTopTracks(interaction, spotifyService, discordId);
                    break;
            }
        } catch (error) {
            console.error(`Error in spotify ${subcommand} command:`, error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'An error occurred while executing this command.',
                    ephemeral: true,
                });
            }
        }
    },
};

async function handleLink(interaction: ChatInputCommandInteraction, spotifyService: ReturnType<typeof getSpotifyService>, discordId: string) {
    // Check if already linked
    if (spotifyService.isLinked(discordId)) {
        await interaction.reply({
            content: 'Your Spotify account is already linked! Use `/spotify unlink` to unlink it.',
            ephemeral: true,
        });
        return;
    }

    // Generate state for OAuth
    const state = crypto.randomBytes(32).toString('hex');
    addState(state, discordId);

    // Get authorization URL
    const authUrl = spotifyService.getAuthorizationUrl(state);
    const callbackPort = process.env.SPOTIFY_CALLBACK_PORT;

    let message = `Click this link to authorize Spotify:\n${authUrl}\n\n`;
    
    if (callbackPort) {
        message += `After authorizing, your account will be automatically linked.`;
    } else {
        message += `After authorizing, you'll be redirected. Copy the code from the URL and use \`/spotify complete\` with that code.`;
    }

    await interaction.reply({
        content: message,
        ephemeral: true,
    });
}

async function handleUnlink(interaction: ChatInputCommandInteraction, spotifyService: ReturnType<typeof getSpotifyService>, discordId: string) {
    if (!spotifyService.isLinked(discordId)) {
        await interaction.reply({
            content: 'Your Spotify account is not linked. Use `/spotify link` to link it.',
            ephemeral: true,
        });
        return;
    }

    const unlinked = spotifyService.unlinkUser(discordId);
    
    if (unlinked) {
        // Also remove channel configuration
        spotifyService.removeUserChannel(discordId);
        await interaction.reply({
            content: '✅ Successfully unlinked your Spotify account.',
            ephemeral: true,
        });
    } else {
        await interaction.reply({
            content: 'Failed to unlink your account. Please try again.',
            ephemeral: true,
        });
    }
}

async function handleStatus(interaction: ChatInputCommandInteraction, spotifyService: ReturnType<typeof getSpotifyService>, discordId: string) {
    if (!spotifyService.isLinked(discordId)) {
        await interaction.reply({
            content: 'Your Spotify account is not linked. Use `/spotify link` to link it.',
            ephemeral: true,
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const track = await spotifyService.getCurrentlyPlaying(discordId);

    if (!track) {
        await interaction.editReply({
            content: 'You are not currently playing anything on Spotify.',
        });
        return;
    }

    const embed = await createTrackEmbed(track, interaction.user);
    await interaction.editReply({ embeds: [embed] });
}

async function handleComplete(interaction: ChatInputCommandInteraction, spotifyService: ReturnType<typeof getSpotifyService>, discordId: string) {
    const code = interaction.options.getString('code', true);

    const tokens = await spotifyService.exchangeCodeForTokens(code);
    
    if (!tokens) {
        await interaction.reply({
            content: 'Failed to exchange authorization code. Please try linking again with `/spotify link`.',
            ephemeral: true,
        });
        return;
    }

    spotifyService.linkUser(
        discordId,
        tokens.accessToken,
        tokens.refreshToken,
        tokens.expiresIn
    );

    await interaction.reply({
        content: '✅ Successfully linked your Spotify account! Your currently playing tracks will now be tracked.',
        ephemeral: true,
    });
}

async function handleChannel(interaction: ChatInputCommandInteraction, spotifyService: ReturnType<typeof getSpotifyService>, discordId: string, client: Client) {
    // Check if user is an admin
    const adminsEnv = process.env.ADMINS;
    const admins = adminsEnv ? adminsEnv.split(',').map(id => id.trim()) : [];
    
    if (!admins.includes(discordId)) {
        await interaction.reply({
            content: '❌ Only admins can set the Spotify channel.',
            ephemeral: true,
        });
        return;
    }
    
    if (!spotifyService.isLinked(discordId)) {
        await interaction.reply({
            content: 'Your Spotify account is not linked. Use `/spotify link` to link it first.',
            ephemeral: true,
        });
        return;
    }

    const channel = interaction.options.getChannel('channel', true);
    
    if (!channel || channel.type !== 0) { // 0 = TextChannel
        await interaction.reply({
            content: 'Please select a valid text channel.',
            ephemeral: true,
        });
        return;
    }

    // Check bot permissions
    const textChannel = channel as TextChannel;
    const botMember = await interaction.guild?.members.fetch(client.user!.id);
    
    if (!botMember?.permissionsIn(textChannel).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        await interaction.reply({
            content: 'I don\'t have permission to send messages or embeds in that channel.',
            ephemeral: true,
        });
        return;
    }

    // Set the channel (this becomes the shared Spotify channel for all users)
    spotifyService.setUserChannel(discordId, channel.id);
    
    await interaction.reply({
        content: `✅ The Spotify channel has been set to ${channel}. All users' Spotify statuses will be displayed here and update every 30 seconds.`,
        ephemeral: true,
    });

    // Send initial status
    const track = await spotifyService.getCurrentlyPlaying(discordId);
    if (track) {
        const embed = await createTrackEmbed(track, interaction.user);
        const content = createStatusMessage(interaction.user, track);
        const message = await textChannel.send({ content, embeds: [embed] });
        spotifyService.setUserMessage(discordId, message.id);
    }
}

async function handleRemoveChannel(interaction: ChatInputCommandInteraction, spotifyService: ReturnType<typeof getSpotifyService>, discordId: string) {
    // Check if user is an admin
    const adminsEnv = process.env.ADMINS;
    const admins = adminsEnv ? adminsEnv.split(',').map(id => id.trim()) : [];
    
    if (!admins.includes(discordId)) {
        await interaction.reply({
            content: '❌ Only admins can remove the Spotify channel.',
            ephemeral: true,
        });
        return;
    }
    
    const removed = spotifyService.removeUserChannel(discordId);
    
    if (removed) {
        await interaction.reply({
            content: '✅ Removed the Spotify status channel.',
            ephemeral: true,
        });
    } else {
        await interaction.reply({
            content: 'No Spotify status channel is currently set.',
            ephemeral: true,
        });
    }
}

async function handleTopTracks(interaction: ChatInputCommandInteraction, spotifyService: ReturnType<typeof getSpotifyService>, discordId: string) {
    if (!spotifyService.isLinked(discordId)) {
        await interaction.reply({
            content: 'Your Spotify account is not linked. Use `/spotify link` to link it.',
            ephemeral: true,
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const period = interaction.options.getString('period', true) as 'short_term' | 'medium_term' | 'long_term';
    
    const periodNames = {
        'short_term': 'This Month',
        'medium_term': 'This Year',
        'long_term': 'All Time',
    };

    const tracks = await spotifyService.getTopTracks(discordId, period, 10);

    if (tracks === null) {
        await interaction.editReply({
            content: '❌ Failed to fetch your top tracks. Please try again later.',
        });
        return;
    }

    if (tracks.length === 0) {
        await interaction.editReply({
            content: `You don't have enough listening data for ${periodNames[period].toLowerCase()} yet. Keep listening to build your top tracks!`,
        });
        return;
    }

    const embed = createTopTracksEmbed(tracks, interaction.user, periodNames[period]);
    await interaction.editReply({ embeds: [embed] });
}

export function createStatusMessage(user: User, track: { name: string; artist: string }): string {
    // Use displayName or username instead of mention to avoid pinging
    const userName = user.displayName || user.username;
    return `${userName} is listening to **${track.name}** by ${track.artist}`;
}

export async function createTrackEmbed(track: { name: string; artist: string; artistImageUrl?: string; album?: string; url: string; imageUrl?: string; duration: number; progress: number; isPlaying: boolean }, user: User): Promise<EmbedBuilder> {
    const statusEmoji = track.isPlaying ? '▶️' : '⏸️';
    const progressPercent = Math.floor((track.progress / track.duration) * 100);

    // Extract dominant color from album cover, fallback to Spotify green
    let embedColor = 0x1DB954; // Default Spotify green
    if (track.imageUrl) {
        try {
            embedColor = await getDominantColor(track.imageUrl);
        } catch (error) {
            console.error('Error getting dominant color:', error);
        }
    }

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({ 
            name: 'Now Playing on Spotify',
            iconURL: user.displayAvatarURL({ extension: 'png', size: 128 })
        })
        .setTitle(track.name)
        .setDescription(`**${track.artist}**${track.album ? ` • ${track.album}` : ''}`)
        .setURL(track.url)
        .setFooter({ 
            text: `${formatTime(track.progress)} / ${formatTime(track.duration)} • ${progressPercent}% • ${track.isPlaying ? 'Playing' : 'Paused'}`,
            iconURL: track.artistImageUrl || 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/spotify.svg'
        })
        .setTimestamp();

    if (track.imageUrl) {
        embed.setThumbnail(track.imageUrl);
    }

    return embed;
}

function formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function createTopTracksEmbed(tracks: Array<{ name: string; artist: string; album: string; url: string; imageUrl?: string; popularity: number }>, user: User, periodName: string): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(0x1DB954) // Spotify green
        .setAuthor({
            name: `${user.displayName || user.username}'s Top Tracks`,
            iconURL: user.displayAvatarURL({ extension: 'png', size: 128 }),
        })
        .setTitle(`🎵 Top 10 Tracks - ${periodName}`)
        .setTimestamp()
        .setFooter({ text: 'Spotify Top Tracks' });

    // Build the track list
    const trackList = tracks.map((track, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        return `${medal} **[${track.name}](${track.url})**\n   ${track.artist} • ${track.album}`;
    }).join('\n\n');

    embed.setDescription(trackList);

    // Set thumbnail to the first track's album art if available
    if (tracks[0]?.imageUrl) {
        embed.setThumbnail(tracks[0].imageUrl);
    }

    return embed;
}

