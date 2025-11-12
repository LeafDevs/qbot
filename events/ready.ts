import type { Client } from "discord.js";

export default {
    name: 'clientReady',
    once: true,
    execute(client: Client) {
        console.log(`Logged in as ${client.user?.tag ?? 'unknown'}`);
    }
}