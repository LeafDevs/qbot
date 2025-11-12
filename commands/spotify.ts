import { SlashCommandBuilder, ChatInputCommandInteraction, type Client, EmbedBuilder, type TextChannel, PermissionFlagsBits, type User } from 'discord.js';
import { getSpotifyService } from '../integrations/spotify.js';
import { addState } from '../integrations/spotify-oauth.js';
import crypto from 'crypto';

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
                .setDescription('Set the channel where your Spotify status will be displayed')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('The channel to display your Spotify status in')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove-channel')
                .setDescription('Remove the channel where your Spotify status is displayed')
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

    const embed = createTrackEmbed(track, interaction.user);
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

    spotifyService.setUserChannel(discordId, channel.id);
    
    await interaction.reply({
        content: `✅ Your Spotify status will now be displayed in ${channel}. It will update every 30 seconds.`,
        ephemeral: true,
    });

    // Send initial status
    const track = await spotifyService.getCurrentlyPlaying(discordId);
    if (track) {
        const embed = createTrackEmbed(track, interaction.user);
        const content = createStatusMessage(interaction.user, track);
        const message = await textChannel.send({ content, embeds: [embed] });
        spotifyService.setUserMessage(discordId, message.id);
    }
}

async function handleRemoveChannel(interaction: ChatInputCommandInteraction, spotifyService: ReturnType<typeof getSpotifyService>, discordId: string) {
    const removed = spotifyService.removeUserChannel(discordId);
    
    if (removed) {
        await interaction.reply({
            content: '✅ Removed your Spotify status channel.',
            ephemeral: true,
        });
    } else {
        await interaction.reply({
            content: 'You don\'t have a Spotify status channel set.',
            ephemeral: true,
        });
    }
}

export function createStatusMessage(user: User, track: { name: string; artist: string }): string {
    // Use displayName or username instead of mention to avoid pinging
    const userName = user.displayName || user.username;
    return `${userName} is listening to **${track.name}** by ${track.artist}`;
}

export function createTrackEmbed(track: { name: string; artist: string; album?: string; url: string; imageUrl?: string; duration: number; progress: number; isPlaying: boolean }, user: User): EmbedBuilder {
    const statusEmoji = track.isPlaying ? '▶️' : '⏸️';
    const progressPercent = Math.floor((track.progress / track.duration) * 100);

    const embed = new EmbedBuilder()
        .setColor(0x1DB954) // Spotify green
        .setAuthor({ 
            name: 'Now Playing on Spotify',
            iconURL: user.displayAvatarURL({ extension: 'png', size: 128 })
        })
        .setTitle(track.name)
        .setDescription(`**${track.artist}**${track.album ? ` • ${track.album}` : ''}`)
        .setURL(track.url)
        .setFooter({ 
            text: `${formatTime(track.progress)} / ${formatTime(track.duration)} • ${progressPercent}% • ${track.isPlaying ? 'Playing' : 'Paused'}`,
            iconURL: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/spotify.svg'
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

