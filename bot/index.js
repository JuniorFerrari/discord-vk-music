require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const {
    Shoukaku,
    Connectors
} = require('shoukaku');


// --------------------------------------------------
// Discord
// --------------------------------------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// --------------------------------------------------
// Lavalink / Shoukaku
// --------------------------------------------------

const nodes = [
    {
        name: 'Local',
        url: `${process.env.LAVALINK_HOST}:${process.env.LAVALINK_PORT}`,
        auth: process.env.LAVALINK_PASSWORD,
        secure: false
    }
];

const shoukaku = new Shoukaku(
    new Connectors.DiscordJS(client),
    nodes
);

const queues = new Map();
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

shoukaku.on('ready', (name) => {
    console.log(`Lavalink подключён: ${name}`);
});

shoukaku.on('error', (name, error) => {
    console.error(`Ошибка Lavalink (${name}):`, error);
});

shoukaku.on('close', (name, code, reason) => {
    console.log(
        `Lavalink отключён: ${name}, code=${code}, reason=${reason}`
    );
});


// --------------------------------------------------
// Slash commands
// --------------------------------------------------

const commands = [

    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Проверить работу бота'),

    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Найти и воспроизвести музыку из VK или YouTube')
        .addStringOption(option =>
            option
                .setName('query')
                .setDescription('Название песни или ссылка VK/YouTube')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Показать очередь воспроизведения'),

    new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Показать текущий трек'),

    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Пропустить текущий трек'),

    new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Поставить музыку на паузу'),

    new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Продолжить воспроизведение'),

    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Остановить музыку и очистить очередь')

].map(command => command.toJSON());


// --------------------------------------------------
// Discord ready
// --------------------------------------------------

client.once('clientReady', async () => {

    console.log(`Discord подключён: ${client.user.tag}`);

    try {

        const rest = new REST({ version: '10' })
            .setToken(process.env.DISCORD_TOKEN);

        await rest.put(
            Routes.applicationGuildCommands(
                process.env.DISCORD_CLIENT_ID,
                process.env.DISCORD_GUILD_ID
            ),
            {
                body: commands
            }
        );

        console.log('Slash-команды зарегистрированы');

    } catch (error) {

        console.error(
            'Ошибка регистрации команд:',
            error
        );

    }

});

function formatDuration(milliseconds) {

    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
        return 'live';
    }

    const totalSeconds = Math.floor(milliseconds / 1000);

    const minutes = Math.floor(totalSeconds / 60);

    const seconds = String(
        totalSeconds % 60
    ).padStart(2, '0');

    return `${minutes}:${seconds}`;
}

function formatTrack(track) {

    const author = track.info.author || 'Неизвестный исполнитель';
    const title = track.info.title || 'Без названия';
    const duration = formatDuration(track.info.length);

    return `${author} — ${title} \`${duration}\``;
}

function extractQueryCandidate(query) {

    const trimmedQuery = query.trim();
    const markdownLinkMatch = trimmedQuery.match(/^\[[^\]]+\]\((https?:\/\/[^)\s]+)\)$/i);
    const rawUrlMatch = trimmedQuery.match(/https?:\/\/\S+/i);

    return markdownLinkMatch
        ? markdownLinkMatch[1]
        : rawUrlMatch
            ? rawUrlMatch[0].replace(/[>)\].,]+$/g, '')
            : trimmedQuery;
}

function isYoutubeUrl(candidate) {

    return /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(candidate) ||
        /^https?:\/\/music\.youtube\.com\//i.test(candidate);
}

function getPlayableIdentifier(query) {

    const trimmedQuery = query.trim();
    const candidate = extractQueryCandidate(trimmedQuery);

    if (/^https?:\/\/(www\.)?(vk\.com|vk\.ru)\//i.test(candidate)) {
        return candidate.replace(
            /^https?:\/\/(www\.)?vk\.ru\//i,
            'https://vk.com/'
        );
    }

    if (isYoutubeUrl(candidate)) {
        return candidate;
    }

    return `ytsearch:${trimmedQuery}`;
}

function getGuildQueue(guildId) {

    let queue = queues.get(guildId);

    if (!queue) {

        queue = {
            current: null,
            tracks: [],
            textChannelId: null,
            voiceChannelId: null,
            player: null,
            idleTimer: null,
            destroyed: false
        };

        queues.set(guildId, queue);
    }

    return queue;
}

function getQueueSummary(queue) {

    const lines = [];

    if (queue.current) {
        lines.push(`Сейчас играет: **${formatTrack(queue.current)}**`);
    }

    if (queue.tracks.length === 0) {
        lines.push('Очередь пуста.');
        return lines.join('\n');
    }

    const upcoming = queue.tracks
        .slice(0, 10)
        .map((track, index) => `${index + 1}. ${formatTrack(track)}`)
        .join('\n');

    lines.push('Дальше в очереди:');
    lines.push(upcoming);

    if (queue.tracks.length > 10) {
        lines.push(`И ещё ${queue.tracks.length - 10} трек(ов).`);
    }

    return lines.join('\n');
}

async function sendToQueueChannel(guildId, message) {

    const queue = queues.get(guildId);

    if (!queue || !queue.textChannelId) {
        return;
    }

    const channel = await client.channels
        .fetch(queue.textChannelId)
        .catch(() => null);

    if (channel && channel.isTextBased()) {
        await channel.send(message).catch(() => null);
    }
}

function clearIdleTimer(queue) {

    if (queue.idleTimer) {
        clearTimeout(queue.idleTimer);
        queue.idleTimer = null;
    }
}

function scheduleIdleDisconnect(guildId) {

    const queue = queues.get(guildId);

    if (!queue || queue.destroyed || queue.current || queue.tracks.length > 0) {
        return;
    }

    clearIdleTimer(queue);

    queue.idleTimer = setTimeout(async () => {

        const latestQueue = queues.get(guildId);

        if (
            !latestQueue ||
            latestQueue.destroyed ||
            latestQueue.current ||
            latestQueue.tracks.length > 0
        ) {
            return;
        }

        await sendToQueueChannel(
            guildId,
            'Выхожу из голосового канала: 5 минут ничего не играло.'
        );

        await destroyQueue(guildId);

    }, IDLE_TIMEOUT_MS);
}

async function destroyQueue(guildId) {

    const queue = queues.get(guildId);

    if (!queue) {
        return;
    }

    queue.destroyed = true;
    queue.current = null;
    queue.tracks = [];
    clearIdleTimer(queue);

    if (queue.player) {
        await queue.player.destroy().catch(() => null);
    }

    queues.delete(guildId);
}

async function playNext(guildId) {

    const queue = queues.get(guildId);

    if (!queue || queue.destroyed) {
        return;
    }

    const nextTrack = queue.tracks.shift();

    if (!nextTrack) {

        queue.current = null;
        await sendToQueueChannel(guildId, 'Очередь закончилась.');
        scheduleIdleDisconnect(guildId);
        return;
    }

    clearIdleTimer(queue);
    queue.current = nextTrack;

    await queue.player.playTrack({
        track: {
            encoded: nextTrack.encoded
        }
    });

    await sendToQueueChannel(
        guildId,
        `▶️ Сейчас играет: **${formatTrack(nextTrack)}**`
    );
}

function bindPlayerEvents(player, guildId) {

    if (player.queueEventsBound) {
        return;
    }

    player.queueEventsBound = true;

    player.on('start', event => {
        console.log(`[Lavalink] Трек запущен (${guildId}):`, {
            track: event.track,
            timestamp: Date.now()
        });
    });

    player.on('end', async event => {

        if (event.reason === 'replaced') {
            return;
        }

        await playNext(guildId);
    });

    player.on('stuck', async () => {
        await sendToQueueChannel(
            guildId,
            'Трек завис, включаю следующий.'
        );
        await playNext(guildId);
    });

    player.on('exception', async event => {
        console.error(`[Lavalink] Ошибка трека (${guildId}):`, event);

        await sendToQueueChannel(
            guildId,
            'Не удалось воспроизвести трек, включаю следующий.'
        );

        await playNext(guildId);
    });

    player.on('closed', async () => {
        const queue = queues.get(guildId);

        if (queue) {
            clearIdleTimer(queue);
        }

        queues.delete(guildId);
    });
}

async function ensurePlayer(interaction, voiceChannel) {

    const queue = getGuildQueue(interaction.guildId);
    let player = shoukaku.players.get(interaction.guildId);

    const botVoiceChannelId =
        interaction.guild.members.me.voice.channelId;

    if (player) {

        if (
            botVoiceChannelId &&
            botVoiceChannelId !== voiceChannel.id
        ) {
            throw new Error('BOT_IN_ANOTHER_CHANNEL');
        }

    } else {

        console.log(
            `Подключаемся к голосовому каналу: ${voiceChannel.name}`
        );

        player = await shoukaku.joinVoiceChannel({
            guildId: interaction.guildId,
            channelId: voiceChannel.id,
            shardId: interaction.guild.shardId,
            deaf: true
        });

        console.log(
            `Подключились к голосовому каналу: ${voiceChannel.name}`
        );
    }

    bindPlayerEvents(player, interaction.guildId);

    queue.player = player;
    queue.voiceChannelId = voiceChannel.id;
    queue.textChannelId = interaction.channelId;
    queue.destroyed = false;
    clearIdleTimer(queue);

    return queue;
}

async function ensureSameVoice(interaction) {

    const memberVoiceChannel = interaction.member.voice.channel;
    const botVoiceChannelId =
        interaction.guild.members.me.voice.channelId;

    if (!memberVoiceChannel) {
        await interaction.reply({
            content: 'Сначала зайди в голосовой канал.',
            ephemeral: true
        });
        return false;
    }

    if (
        botVoiceChannelId &&
        botVoiceChannelId !== memberVoiceChannel.id
    ) {
        await interaction.reply({
            content: 'Ты должен быть в том же голосовом канале, что и бот.',
            ephemeral: true
        });
        return false;
    }

    return true;
}

// --------------------------------------------------
// Commands
// --------------------------------------------------

client.on('interactionCreate', async interaction => {

    if (!interaction.isChatInputCommand()) {
        return;
    }


    // -----------------------------
    // /ping
    // -----------------------------

    if (interaction.commandName === 'ping') {

        await interaction.reply('Pong!');
        return;

    }


    // -----------------------------
    // /play
    // -----------------------------

    if (interaction.commandName === 'play') {

        await interaction.deferReply();

        try {

            const member = interaction.member;

            const voiceChannel =
                member.voice.channel;

            if (!voiceChannel) {

                await interaction.editReply(
                    'Сначала зайди в голосовой канал.'
                );

                return;

            }


            // Получаем Lavalink node

            const node = shoukaku.getIdealNode();

            if (!node) {

                await interaction.editReply(
                    'Lavalink сейчас недоступен.'
                );

                return;

            }


            // Что ввёл пользователь

            const query =
                interaction.options.getString(
                    'query',
                    true
                );


            // VK/YouTube ссылки используем как есть, обычный текст ищем в YouTube.

            const identifier = getPlayableIdentifier(query);


            console.log(
                `Поиск: ${identifier}`
            );


            // Поиск через Lavalink

            const result =
                await node.rest.resolve(identifier);


            if (
                !result ||
                result.loadType === 'empty' ||
                !result.data
            ) {

                await interaction.editReply(
                    'Ничего не найдено.'
                );

                return;

            }


            // -----------------------------
            // Выбираем трек
            // -----------------------------

            let selectedTracks = [];


            if (result.loadType === 'track') {

                // Прямая ссылка на конкретный трек
                selectedTracks = [result.data];

            }

            else if (result.loadType === 'search') {

                // Берём максимум первые 5 результатов
                const tracks = result.data.slice(0, 5);

                if (tracks.length === 0) {

                    await interaction.editReply(
                        'Ничего не найдено.'
                    );

                    return;
                }


                // Формируем список найденных треков
                const trackList = tracks
                    .map((item, index) => {

                        const duration =
                            formatDuration(item.info.length);

                        return (
                            `**${index + 1}.** ` +
                            `${item.info.author} — ${item.info.title} ` +
                            `\`${duration}\``
                        );

                    })
                    .join('\n');


                // Кнопки 1–5
                const row = new ActionRowBuilder();

                tracks.forEach((item, index) => {

                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`track_${index}`)
                            .setLabel(String(index + 1))
                            .setStyle(ButtonStyle.Primary)
                    );

                });


                await interaction.editReply({
                    content:
                        `Результаты поиска для **${query}**:\n\n` +
                        trackList +
                        '\n\nВыбери трек:',
                    components: [row]
                });


                // Ждём кнопку только от пользователя,
                // который вызвал /play
                let buttonInteraction;

                try {

                    buttonInteraction =
                        await interaction.channel.awaitMessageComponent({
                            filter: componentInteraction =>
                                componentInteraction.user.id ===
                                interaction.user.id &&
                                componentInteraction.customId.startsWith(
                                    'track_'
                                ),

                            time: 30_000
                        });

                } catch {

                    await interaction.editReply({
                        content:
                            'Время выбора трека истекло.',
                        components: []
                    });

                    return;
                }


                // Получаем номер выбранного трека
                const selectedIndex =
                    Number(
                        buttonInteraction.customId.replace(
                            'track_',
                            ''
                        )
                    );


                selectedTracks = [tracks[selectedIndex]];


                // Убираем кнопки и подтверждаем выбор
                await buttonInteraction.update({
                    content:
                        `Выбрано: **${formatTrack(selectedTracks[0])}**`,
                    components: []
                });

            }

            else if (result.loadType === 'playlist') {

                selectedTracks = result.data.tracks || [];

            }


            if (selectedTracks.length === 0) {

                await interaction.editReply(
                    'Не удалось выбрать трек.'
                );

                return;

            }


            console.log(
                `Добавлено треков: ${selectedTracks.length}`
            );


            // -----------------------------
            // Подключение к Discord Voice
            // -----------------------------

            let queue;

            try {
                queue = await ensurePlayer(interaction, voiceChannel);
            } catch (error) {

                if (error.message === 'BOT_IN_ANOTHER_CHANNEL') {
                    await interaction.editReply(
                        'Я уже нахожусь в другом голосовом канале.'
                    );
                    return;
                }

                throw error;
            }


            // -----------------------------
            // Очередь
            // -----------------------------

            const wasIdle = !queue.current;
            queue.tracks.push(...selectedTracks);

            if (wasIdle) {
                await playNext(interaction.guildId);
            }

            if (selectedTracks.length === 1) {

                const track = selectedTracks[0];

                await interaction.editReply(
                    wasIdle
                        ? `▶️ Запускаю: **${formatTrack(track)}**`
                        : `Добавлено в очередь: **${formatTrack(track)}**\n` +
                          `Позиция: ${queue.tracks.length}`
                );

            } else {

                await interaction.editReply(
                    `Добавлено треков из плейлиста: ${selectedTracks.length}\n` +
                    getQueueSummary(queue)
                );
            }

        } catch (error) {

            console.error(
                'Ошибка /play:',
                error
            );

            await interaction.editReply(
                'Произошла ошибка при воспроизведении.'
            );

        }

    }

    // -----------------------------
    // /queue
    // -----------------------------

    if (interaction.commandName === 'queue') {

        const queue = queues.get(interaction.guildId);

        if (!queue || (!queue.current && queue.tracks.length === 0)) {
            await interaction.reply('Очередь пуста.');
            return;
        }

        await interaction.reply(getQueueSummary(queue));
        return;
    }


    // -----------------------------
    // /nowplaying
    // -----------------------------

    if (interaction.commandName === 'nowplaying') {

        const queue = queues.get(interaction.guildId);

        if (!queue || !queue.current) {
            await interaction.reply('Сейчас ничего не играет.');
            return;
        }

        await interaction.reply(
            `Сейчас играет: **${formatTrack(queue.current)}**`
        );
        return;
    }


    // -----------------------------
    // /skip
    // -----------------------------

    if (interaction.commandName === 'skip') {

        if (!await ensureSameVoice(interaction)) {
            return;
        }

        const queue = queues.get(interaction.guildId);

        if (!queue || !queue.player || !queue.current) {
            await interaction.reply('Сейчас ничего не играет.');
            return;
        }

        await interaction.reply('Пропускаю текущий трек.');
        await queue.player.stopTrack();
        return;
    }


    // -----------------------------
    // /pause
    // -----------------------------

    if (interaction.commandName === 'pause') {

        if (!await ensureSameVoice(interaction)) {
            return;
        }

        const queue = queues.get(interaction.guildId);

        if (!queue || !queue.player || !queue.current) {
            await interaction.reply('Сейчас ничего не играет.');
            return;
        }

        if (queue.player.paused) {
            await interaction.reply('Музыка уже на паузе.');
            return;
        }

        await queue.player.setPaused(true);
        await interaction.reply('Пауза.');
        return;
    }


    // -----------------------------
    // /resume
    // -----------------------------

    if (interaction.commandName === 'resume') {

        if (!await ensureSameVoice(interaction)) {
            return;
        }

        const queue = queues.get(interaction.guildId);

        if (!queue || !queue.player || !queue.current) {
            await interaction.reply('Сейчас ничего не играет.');
            return;
        }

        if (!queue.player.paused) {
            await interaction.reply('Музыка уже играет.');
            return;
        }

        await queue.player.setPaused(false);
        await interaction.reply('Продолжаю.');
        return;
    }


    // -----------------------------
    // /stop
    // -----------------------------

    if (interaction.commandName === 'stop') {

        if (!await ensureSameVoice(interaction)) {
            return;
        }

        const queue = queues.get(interaction.guildId);

        if (!queue || !queue.player) {
            await interaction.reply('Сейчас ничего не играет.');
            return;
        }

        await destroyQueue(interaction.guildId);
        await interaction.reply('Остановил музыку и очистил очередь.');
        return;
    }

});


// --------------------------------------------------
// Login
// --------------------------------------------------

client.login(
    process.env.DISCORD_TOKEN
);
