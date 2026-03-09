import fs from "fs";
import path from "path";
import { parse } from "smol-toml";
import { render } from "ink";
import { authenticate } from "./api.js";
import { App } from "./app.js";

interface Config {
    connection: {
        url: string;
        username: string;
        password: string;
    };
}

const CONFIG_PATH = path.join(process.cwd(), "config.toml");

function loadConfig(): Config {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error(`Config file not found: ${CONFIG_PATH}`);
        console.error(
            "Copy config.example.toml to config.toml and fill in your settings.",
        );
        process.exit(1);
    }

    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return parse(raw) as unknown as Config;
}

async function main(): Promise<void> {
    const config = loadConfig();
    const { url, username, password } = config.connection;

    console.log(`Connecting to ${url}...`);
    const sid = await authenticate(url, username, password);

    render(<App url={url} sid={sid} />);
}

main();
