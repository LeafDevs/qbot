import { type Client, SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";

export default {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!'),
    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        await interaction.reply({ content: `${client.ws.ping}ms`, ephemeral: true });
    }
}