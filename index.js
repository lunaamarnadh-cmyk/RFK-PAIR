const express = require("express");
const path = require("path");
const fs = require("fs-extra");
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
    delay
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

async function createShortSession(credsBuffer) {
    try {
        const params = new URLSearchParams();
        params.append("content", credsBuffer.toString("utf8"));
        params.append("syntax", "json");
        params.append("expiry_days", "365");

        const response = await fetch("https://dpaste.com/api/v2/", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString()
        });

        if (response.ok) {
            const pasteUrl = (await response.text()).trim();
            const shortId = pasteUrl.split("/").pop();
            if (shortId && shortId.length < 25) {
                return `RFK-BOT~${shortId}`;
            }
        }
    } catch (e) {
        console.error("Short session upload failed, falling back to base64:", e.message);
    }
    return "RFK-BOT~" + credsBuffer.toString("base64");
}

app.get("/pair", async (req, res) => {
    const number = (req.query.number || "").replace(/[^0-9]/g, "");
    if (!number) return res.json({ error: "Invalid phone number" });

    const sessionIdFolder = `./temp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    fs.ensureDirSync(sessionIdFolder);

    async function startPairing() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(sessionIdFolder);
            const { version } = await fetchLatestBaileysVersion();

            const sock = makeWASocket({
                version,
                logger: pino({ level: "silent" }),
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
                },
                browser: Browsers.ubuntu("Chrome")
            });

            sock.ev.on("creds.update", saveCreds);

            if (!sock.authState.creds.registered) {
                await delay(2000);
                const code = await sock.requestPairingCode(number);
                if (!res.headersSent) res.json({ code });
            }

            sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
                if (connection === "open") {
                    await delay(4000);
                    const credsPath = path.join(sessionIdFolder, "creds.json");
                    if (fs.existsSync(credsPath)) {
                        const credsData = fs.readFileSync(credsPath);
                        const sessionString = await createShortSession(credsData);

                        const userJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
                        await sock.sendMessage(userJid, { text: sessionString });
                        await sock.sendMessage(userJid, {
                            text:
                                `╭━━━〔 ☭ 乂𝐑𝐅𝐊 𝐁𝐎𝐓乂 ☭ 〕━━━╮\n` +
                                `┃ ✅ *Session ID Generated!*\n` +
                                `┃ 📋 മുകളിലുള്ള *${sessionString}* കോഡ്\n` +
                                `┃    കോപ്പി ചെയ്ത് *SESSION_ID* ആയി\n` +
                                `┃    Railway / Render-ൽ നൽകുക.\n` +
                                `╰━━━〔 ☭ 𝐑𝐅𝐊 𝐌𝐎𝐃𝐒 ☭ 〕━━━╯`
                        });
                    }
                    await delay(3000);
                    fs.removeSync(sessionIdFolder);
                    sock.end();
                } else if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 515) {
                        startPairing();
                    }
                }
            });
        } catch (err) {
            fs.removeSync(sessionIdFolder);
            if (!res.headersSent) res.json({ error: err.message });
        }
    }

    startPairing();
});

app.listen(PORT, () => console.log(`🚀 RFK Pairing Server running on port ${PORT}`));
