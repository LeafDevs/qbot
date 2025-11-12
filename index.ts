import { Client, GatewayIntentBits, Collection, REST, Routes, Events, SlashCommandBuilder, type Interaction } from 'discord.js';
import path from 'path';
import fs from 'fs';
import { table } from 'console';

// Config - Set your Discord Bot Token and Client ID here
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // Put a guild id if you want guild-only commands (for dev)

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// @ts-expect-error - commands is not defined in the Client type
client.commands = new Collection();

// Load Commands
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.existsSync(commandsPath)
  ? fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'))
  : [];

const commandStatusArr: { Name: string; Type: string; Status: string }[] = [];

const commandsForSync: any[] = [];

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    let command;
    try {
        command = require(filePath);
        command = command.default || command;
        if (
            command.data &&
            command.data instanceof SlashCommandBuilder &&
            typeof command.execute === 'function'
        ) {
            // @ts-expect-error - commands is not defined in the Client type
            client.commands.set(command.data.name, command);
            commandsForSync.push(command.data.toJSON());
            commandStatusArr.push({ Name: command.data.name, Type: "Command", Status: "OK" });
        } else {
            commandStatusArr.push({ Name: file, Type: "Command", Status: "Not OK" });
        }
    } catch (e) {
        commandStatusArr.push({ Name: file, Type: "Command", Status: "Not OK" });
    }
}

// Load Events
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.existsSync(eventsPath)
  ? fs.readdirSync(eventsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'))
  : [];

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    try {
        const eventModule = require(filePath);
        const event = eventModule.default || eventModule;
        if (event && event.name && typeof event.execute === 'function') {
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, client));
            } else {
                client.on(event.name, (...args) => event.execute(...args, client));
            }
            commandStatusArr.push({ Name: event.name, Type: "Event", Status: "OK" });
        } else {
            commandStatusArr.push({ Name: file, Type: "Event", Status: "Not OK" });
        }
    } catch (e) {
        commandStatusArr.push({ Name: file, Type: "Event", Status: "Not OK" });
    }
}

// Sync slash commands
async function syncCommands() {
    if (!TOKEN || !CLIENT_ID) {
        console.error("Missing required environment variables: TOKEN or CLIENT_ID");
        return;
    }
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        if (commandsForSync.length > 0) {
            if (GUILD_ID) {
                await rest.put(
                    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), 
                    { body: commandsForSync }
                );
            } else {
                await rest.put(
                    Routes.applicationCommands(CLIENT_ID), 
                    { body: commandsForSync }
                );
            }
            console.log("Slash commands synced!");
        }
    } catch (error) {
        console.error("Error syncing commands:", error);
    }
}

// Register slash command handler
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isCommand()) return;
    // @ts-expect-error - commands is not defined in the Client type
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error(error);
        try {
            await interaction.reply({ content: "There was an error executing this command!", ephemeral: true });
        } catch {}
    }
});

client.once(Events.ClientReady, async () => {
    console.log(`Ready! Logged in as ${client.user?.tag}`);
    table(commandStatusArr);
    await syncCommands();
});

if (!TOKEN) {
    console.error("Missing required environment variable: DISCORD_TOKEN");
    process.exit(1);
}
client.login(TOKEN);