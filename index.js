const express = require("express");
const path = require("path");
const fs = require("fs-extra");
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    delay
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/pair", async (req, res) => {
    const number = (req.query.number || "").replace(/[^0-9]/g, "");
    if (!number) return res.json({ error: "Invalid phone number" });

    const sessionIdFolder = `./temp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    fs.ensureDirSync(sessionIdFolder);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionIdFolder);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: "silent" }),
            printQRInTerminal: false,
            auth: state,
            browser: ["RFK-BOT", "Chrome", "1.0.0"]
        });

        sock.ev.on("creds.update", saveCreds);

        if (!sock.authState.creds.registered) {
            await delay(2000);
            const code = await sock.requestPairingCode(number);
            if (!res.headersSent) res.json({ code });
        }

        sock.ev.on("connection.update", async ({ connection }) => {
            if (connection === "open") {
                await delay(3000);
                const credsPath = path.join(sessionIdFolder, "creds.json");
                if (fs.existsSync(credsPath)) {
                    const credsData = fs.readFileSync(credsPath);
                    const sessionString = "RFK-BOT~" + credsData.toString("base64");

                    const userJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
                    await sock.sendMessage(userJid, { text: sessionString });
                    await sock.sendMessage(userJid, {
                        text:
                            `╭━━━〔 ☭ 乂𝐑𝐅𝐊 𝐁𝐎𝐓乂 ☭ 〕━━━╮\n` +
                            `┃ ✅ *Session ID Generated!*\n` +
                            `┃ 📋 മുകളിലുള്ള *RFK-BOT~...* കോഡ്\n` +
                            `┃    കോപ്പി ചെയ്ത് *SESSION_ID* ആയി\n` +
                            `┃    Railway / Render-ൽ നൽകുക.\n` +
                            `╰━━━〔 ☭ 𝐑𝐅𝐊 𝐌𝐎𝐃𝐒 ☭ 〕━━━╯`
                    });
                }
                await delay(2000);
                fs.removeSync(sessionIdFolder);
                sock.end();
            }
        });
    } catch (err) {
        fs.removeSync(sessionIdFolder);
        if (!res.headersSent) res.json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`🚀 RFK Pairing Server running on port ${PORT}`));
