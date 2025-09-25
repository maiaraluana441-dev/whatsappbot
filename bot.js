const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const cron = require('node-cron');
const moment = require('moment');

// Configurações
const config = {
    prefix: '!',
    adminOnly: ['ban', 'promote', 'demote', 'removeall', 'add', 'rename', 'desc', 'creatgrup'],
    dataDir: './data/'
};

// Criar diretório de dados se não existir
if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
}

// Inicializar cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './session'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// Dados do bot
let botData = {
    groups: {},
    chatbot: {},
    antiwords: ['puta', 'merda', 'caralho', 'porra', 'fdp'],
    autoPost: {}
};

// Carregar dados salvos
function loadData() {
    try {
        if (fs.existsSync(config.dataDir + 'botdata.json')) {
            const data = fs.readFileSync(config.dataDir + 'botdata.json', 'utf8');
            botData = JSON.parse(data);
        }
    } catch (error) {
        console.log('Erro ao carregar dados:', error.message);
    }
}

// Salvar dados
function saveData() {
    try {
        fs.writeFileSync(config.dataDir + 'botdata.json', JSON.stringify(botData, null, 2));
    } catch (error) {
        console.log('Erro ao salvar dados:', error.message);
    }
}

// Inicializar dados do grupo
function initGroupData(groupId) {
    if (!botData.groups[groupId]) {
        botData.groups[groupId] = {
            welcome: {
                enabled: false,
                message: 'Bem-vindo(a) ao grupo {user}! 👋',
                media: null
            },
            welcomePv: {
                enabled: false,
                message: 'Olá {user}! Bem-vindo(a) ao grupo {group}! 👋',
                media: null
            },
            goodbye: {
                enabled: false,
                message: 'Tchau {user}! 👋 Foi bom ter você no grupo.',
                media: null
            },
            antilink: {
                enabled: false,
                ban: false
            },
            antiwords: {
                enabled: false,
                ban: false,
                words: []
            },
            chatbot: {
                enabled: false
            }
        };
    }
}

// Verificar se usuário é admin
async function isAdmin(chat, userId) {
    if (chat.isGroup) {
        const participant = chat.participants.find(p => p.id._serialized === userId);
        return participant && participant.isAdmin;
    }
    return false;
}

// Verificar se bot é admin
async function isBotAdmin(chat) {
    if (chat.isGroup) {
        const botParticipant = chat.participants.find(p => p.id._serialized === client.info.wid._serialized);
        return botParticipant && botParticipant.isAdmin;
    }
    return false;
}

// Detectar links
function hasLink(text) {
    const linkRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[^\s]+\.(com|net|org|br|co|io|app|me|tv|gg|ly|bit\.ly|tinyurl|short|link))/gi;
    return linkRegex.test(text);
}

// Detectar palavrões
function hasBadWords(text, groupWords) {
    const allWords = [...botData.antiwords, ...groupWords];
    const words = text.toLowerCase().split(' ');
    return words.some(word => allWords.includes(word));
}

// Processar variáveis na mensagem
function processVariables(message, user, group) {
    return message
        .replace(/{user}/g, user)
        .replace(/{group}/g, group || 'Grupo');
}

// Event: QR Code
client.on('qr', (qr) => {
    console.log('🔄 QR Code recebido, escaneie com seu WhatsApp:');
    qrcode.generate(qr, { small: true });
});

// Event: Pronto
client.on('ready', () => {
    console.log('✅ Bot conectado e pronto!');
    console.log('📱 Número:', client.info.wid.user);
    loadData();
});

// Event: Novo membro no grupo
client.on('group_join', async (notification) => {
    const chat = await notification.getChat();
    const groupData = botData.groups[chat.id._serialized];
    
    if (groupData && groupData.welcome.enabled) {
        const user = notification.id.participant.split('@')[0];
        const welcomeMsg = processVariables(groupData.welcome.message, `@${user}`, chat.name);
        
        if (groupData.welcome.media) {
            const media = MessageMedia.fromFilePath(groupData.welcome.media);
            await chat.sendMessage(media, { caption: welcomeMsg, mentions: [notification.id.participant] });
        } else {
            await chat.sendMessage(welcomeMsg, { mentions: [notification.id.participant] });
        }
    }
    
    // Mensagem privada de boas-vindas
    if (groupData && groupData.welcomePv.enabled) {
        const contact = await client.getContactById(notification.id.participant);
        const welcomePvMsg = processVariables(groupData.welcomePv.message, contact.name || contact.number, chat.name);
        
        if (groupData.welcomePv.media) {
            const media = MessageMedia.fromFilePath(groupData.welcomePv.media);
            await contact.sendMessage(media, { caption: welcomePvMsg });
        } else {
            await contact.sendMessage(welcomePvMsg);
        }
    }
});

// Event: Membro saiu do grupo
client.on('group_leave', async (notification) => {
    const chat = await notification.getChat();
    const groupData = botData.groups[chat.id._serialized];
    
    if (groupData && groupData.goodbye.enabled) {
        const user = notification.id.participant.split('@')[0];
        const goodbyeMsg = processVariables(groupData.goodbye.message, user, chat.name);
        
        if (groupData.goodbye.media) {
            const media = MessageMedia.fromFilePath(groupData.goodbye.media);
            await chat.sendMessage(media, { caption: goodbyeMsg });
        } else {
            await chat.sendMessage(goodbyeMsg);
        }
    }
});

// Event: Mensagem recebida
client.on('message', async (message) => {
    // Ignorar mensagens do próprio bot
    if (message.fromMe) return;
    
    const chat = await message.getChat();
    const contact = await message.getContact();
    
    // Só processar grupos
    if (!chat.isGroup) return;
    
    const groupId = chat.id._serialized;
    initGroupData(groupId);
    const groupData = botData.groups[groupId];
    
    // Verificar anti-link
    if (groupData.antilink.enabled && hasLink(message.body)) {
        const isUserAdmin = await isAdmin(chat, message.author);
        if (!isUserAdmin) {
            await message.delete(true);
            await message.reply('❌ Links não são permitidos neste grupo!');
            
            if (groupData.antilink.ban) {
                const isBotAdm = await isBotAdmin(chat);
                if (isBotAdm) {
                    await chat.removeParticipants([message.author]);
                    await chat.sendMessage(`🔨 @${message.author.split('@')[0]} foi removido por enviar link.`, {
                        mentions: [message.author]
                    });
                }
            }
            return;
        }
    }
    
    // Verificar anti-palavrões
    if (groupData.antiwords.enabled && hasBadWords(message.body, groupData.antiwords.words)) {
        const isUserAdmin = await isAdmin(chat, message.author);
        if (!isUserAdmin) {
            await message.delete(true);
            await message.reply('❌ Linguagem inapropriada não é permitida neste grupo!');
            
            if (groupData.antiwords.ban) {
                const isBotAdm = await isBotAdmin(chat);
                if (isBotAdm) {
                    await chat.removeParticipants([message.author]);
                    await chat.sendMessage(`🔨 @${message.author.split('@')[0]} foi removido por usar linguagem inapropriada.`, {
                        mentions: [message.author]
                    });
                }
            }
            return;
        }
    }
    
    // Chatbot
    if (groupData.chatbot.enabled && botData.chatbot[message.body.toLowerCase()]) {
        const response = botData.chatbot[message.body.toLowerCase()];
        if (response.type === 'text') {
            await message.reply(response.content);
        } else if (response.type === 'media') {
            const media = MessageMedia.fromFilePath(response.content);
            await chat.sendMessage(media);
        }
        return;
    }
    
    // Processar comandos
    if (!message.body.startsWith(config.prefix)) return;
    
    const args = message.body.slice(config.prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    // Verificar se comando requer admin
    if (config.adminOnly.includes(command)) {
        const isUserAdmin = await isAdmin(chat, message.author);
        if (!isUserAdmin) {
            await message.reply('❌ Este comando é apenas para administradores!');
            return;
        }
    }
    
    // COMANDOS GERAIS
    if (command === 'help') {
        const helpMsg = `🤖 *ADMIN BOT - COMANDOS DISPONÍVEIS*

*COMANDOS GERAIS:*
• !help - Lista de comandos
• !ping - Testar bot
• !info - Info do grupo
• !extracto cont - Extrair contatos

*BOAS-VINDAS:*
• !welcome on/off - Ativar/desativar
• !welcome set <mensagem> - Definir mensagem
• !welcome media <caminho> - Definir mídia
• !welcomepv on/off - Mensagens privadas
• !welcomepv set <mensagem> - Definir mensagem PV
• !welcomepv media <caminho> - Definir mídia PV
• !goodbye on/off - Ativar/desativar
• !goodbye set <mensagem> - Definir mensagem
• !goodbye media <caminho> - Definir mídia

*MODERAÇÃO (Admins):*
• !antilink on/off - Anti-link
• !antilink ban on/off - Banir por link
• !antiwords on/off - Anti-palavrões
• !antiwords add <palavra> - Adicionar palavra
• !antiwords remove <palavra> - Remover palavra
• !antiwords ban on/off - Banir por palavrão
• !antiwords list - Listar palavras
• !ban @user - Banir usuário
• !removeall - REMOVE TODOS

*ADMINISTRAÇÃO (Admins):*
• !promote @user - Promover admin
• !demote @user - Rebaixar admin
• !add <numero> - Adicionar membro
• !tagall <mensagem> - Marcar todos
• !tagallcut <mensagem> - Marca invisível
• !rename <nome> - Renomear grupo
• !desc <descrição> - Alterar descrição
• !creatgrup <nome> - Criar grupo

*CHATBOT:*
• !chatbot on/off - Ativar/desativar
• !chatbot add <gatilho>=<resposta> - Adicionar
• !chatbot media <gatilho> <caminho> - Definir mídia
• !chatbot remove <gatilho> - Remover
• !chatbot list - Listar gatilhos
• !mensege post on/off - Postagem automática
• !mensege post minutos <min> <msg> - Programar posts
• !poll <pergunta>=<op1>=<op2> - Enquete
• !poll resulte - Resultado da enquete

*Admim-bot - Tecnologia*`;
        
        await message.reply(helpMsg);
    }
    
    else if (command === 'ping') {
        const start = Date.now();
        const pingMsg = await message.reply('🏓 Pong!');
        const latency = Date.now() - start;
        await pingMsg.edit(`🏓 Pong!\n⏱️ Latência: ${latency}ms\n✅ Bot online e funcionando!`);
    }
    
    else if (command === 'info') {
        const groupInfo = `📊 *INFORMAÇÕES DO GRUPO*

📝 *Nome:* ${chat.name}
👥 *Participantes:* ${chat.participants.length}
📱 *ID:* ${chat.id._serialized}
📅 *Criado em:* ${moment.unix(chat.createdAt.seconds).format('DD/MM/YYYY HH:mm')}
👑 *Admins:* ${chat.participants.filter(p => p.isAdmin).length}

*Configurações do Bot:*
🎉 Boas-vindas: ${groupData.welcome.enabled ? '✅' : '❌'}
🔒 Anti-link: ${groupData.antilink.enabled ? '✅' : '❌'}
🚫 Anti-palavrões: ${groupData.antiwords.enabled ? '✅' : '❌'}
🤖 Chatbot: ${groupData.chatbot.enabled ? '✅' : '❌'}`;
        
        await message.reply(groupInfo);
    }
    
    else if (command === 'extracto' && args[0] === 'cont') {
        let contacts = '*📞 CONTATOS DO GRUPO:*\n\n';
        chat.participants.forEach((participant, index) => {
            const number = participant.id.user;
            contacts += `${index + 1}. +${number}\n`;
        });
        await message.reply(contacts);
    }
    
    // COMANDOS DE BOAS-VINDAS
    else if (command === 'welcome') {
        if (args[0] === 'on') {
            groupData.welcome.enabled = true;
            await message.reply('✅ Boas-vindas ativadas!');
        } else if (args[0] === 'off') {
            groupData.welcome.enabled = false;
            await message.reply('❌ Boas-vindas desativadas!');
        } else if (args[0] === 'set') {
            const welcomeMsg = args.slice(1).join(' ');
            if (welcomeMsg) {
                groupData.welcome.message = welcomeMsg;
                await message.reply('✅ Mensagem de boas-vindas definida!');
            } else {
                await message.reply('❌ Digite a mensagem após "set"');
            }
        } else if (args[0] === 'media') {
            const mediaPath = args.slice(1).join(' ');
            if (mediaPath) {
                groupData.welcome.media = mediaPath;
                await message.reply('✅ Mídia de boas-vindas definida!');
            } else {
                await message.reply('❌ Digite o caminho da mídia após "media"');
            }
        }
        saveData();
    }
    
    else if (command === 'welcomepv') {
        if (args[0] === 'on') {
            groupData.welcomePv.enabled = true;
            await message.reply('✅ Boas-vindas privadas ativadas!');
        } else if (args[0] === 'off') {
            groupData.welcomePv.enabled = false;
            await message.reply('❌ Boas-vindas privadas desativadas!');
        } else if (args[0] === 'set') {
            const welcomeMsg = args.slice(1).join(' ');
            if (welcomeMsg) {
                groupData.welcomePv.message = welcomeMsg;
                await message.reply('✅ Mensagem de boas-vindas privada definida!');
            }
        } else if (args[0] === 'media') {
            const mediaPath = args.slice(1).join(' ');
            if (mediaPath) {
                groupData.welcomePv.media = mediaPath;
                await message.reply('✅ Mídia de boas-vindas privada definida!');
            }
        }
        saveData();
    }
    
    else if (command === 'goodbye') {
        if (args[0] === 'on') {
            groupData.goodbye.enabled = true;
            await message.reply('✅ Despedidas ativadas!');
        } else if (args[0] === 'off') {
            groupData.goodbye.enabled = false;
            await message.reply('❌ Despedidas desativadas!');
        } else if (args[0] === 'set') {
            const goodbyeMsg = args.slice(1).join(' ');
            if (goodbyeMsg) {
                groupData.goodbye.message = goodbyeMsg;
                await message.reply('✅ Mensagem de despedida definida!');
            }
        } else if (args[0] === 'media') {
            const mediaPath = args.slice(1).join(' ');
            if (mediaPath) {
                groupData.goodbye.media = mediaPath;
                await message.reply('✅ Mídia de despedida definida!');
            }
        }
        saveData();
    }
    
    // COMANDOS DE MODERAÇÃO
    else if (command === 'antilink') {
        if (args[0] === 'on') {
            groupData.antilink.enabled = true;
            await message.reply('✅ Anti-link ativado!');
        } else if (args[0] === 'off') {
            groupData.antilink.enabled = false;
            await message.reply('❌ Anti-link desativado!');
        } else if (args[0] === 'ban') {
            if (args[1] === 'on') {
                groupData.antilink.ban = true;
                await message.reply('✅ Banimento por link ativado!');
            } else if (args[1] === 'off') {
                groupData.antilink.ban = false;
                await message.reply('❌ Banimento por link desativado!');
            }
        }
        saveData();
    }
    
    else if (command === 'antiwords') {
        if (args[0] === 'on') {
            groupData.antiwords.enabled = true;
            await message.reply('✅ Anti-palavrões ativado!');
        } else if (args[0] === 'off') {
            groupData.antiwords.enabled = false;
            await message.reply('❌ Anti-palavrões desativado!');
        } else if (args[0] === 'add') {
            const word = args[1]?.toLowerCase();
            if (word && !groupData.antiwords.words.includes(word)) {
                groupData.antiwords.words.push(word);
                await message.reply(`✅ Palavra "${word}" adicionada à lista!`);
            } else {
                await message.reply('❌ Palavra inválida ou já existe!');
            }
        } else if (args[0] === 'remove') {
            const word = args[1]?.toLowerCase();
            const index = groupData.antiwords.words.indexOf(word);
            if (index > -1) {
                groupData.antiwords.words.splice(index, 1);
                await message.reply(`✅ Palavra "${word}" removida da lista!`);
            } else {
                await message.reply('❌ Palavra não encontrada!');
            }
        } else if (args[0] === 'ban') {
            if (args[1] === 'on') {
                groupData.antiwords.ban = true;
                await message.reply('✅ Banimento por palavrão ativado!');
            } else if (args[1] === 'off') {
                groupData.antiwords.ban = false;
                await message.reply('❌ Banimento por palavrão desativado!');
            }
        } else if (args[0] === 'list') {
            const allWords = [...botData.antiwords, ...groupData.antiwords.words];
            await message.reply(`📋 *Palavras proibidas:*\n${allWords.join(', ')}`);
        }
        saveData();
    }
    
    else if (command === 'ban') {
        const mentionedUser = message.mentionedIds[0];
        if (mentionedUser) {
            const isBotAdm = await isBotAdmin(chat);
            if (isBotAdm) {
                await chat.removeParticipants([mentionedUser]);
                await message.reply(`🔨 Usuário removido do grupo!`);
            } else {
                await message.reply('❌ Bot precisa ser admin para remover membros!');
            }
        } else {
            await message.reply('❌ Marque um usuário para banir!');
        }
    }
    
    else if (command === 'removeall') {
        const isBotAdm = await isBotAdmin(chat);
        if (isBotAdm) {
            const nonAdminParticipants = chat.participants.filter(p => !p.isAdmin && p.id._serialized !== client.info.wid._serialized);
            if (nonAdminParticipants.length > 0) {
                await chat.removeParticipants(nonAdminParticipants.map(p => p.id._serialized));
                await message.reply(`🧹 ${nonAdminParticipants.length} membros removidos do grupo!`);
            } else {
                await message.reply('❌ Não há membros para remover!');
            }
        } else {
            await message.reply('❌ Bot precisa ser admin para remover membros!');
        }
    }
    
    // COMANDOS DE ADMINISTRAÇÃO
    else if (command === 'promote') {
        const mentionedUser = message.mentionedIds[0];
        if (mentionedUser) {
            const isBotAdm = await isBotAdmin(chat);
            if (isBotAdm) {
                await chat.promoteParticipants([mentionedUser]);
                await message.reply('👑 Usuário promovido a administrador!');
            } else {
                await message.reply('❌ Bot precisa ser admin para promover membros!');
            }
        } else {
            await message.reply('❌ Marque um usuário para promover!');
        }
    }
    
    else if (command === 'demote') {
        const mentionedUser = message.mentionedIds[0];
        if (mentionedUser) {
            const isBotAdm = await isBotAdmin(chat);
            if (isBotAdm) {
                await chat.demoteParticipants([mentionedUser]);
                await message.reply('📉 Usuário rebaixado de administrador!');
            } else {
                await message.reply('❌ Bot precisa ser admin para rebaixar membros!');
            }
        } else {
            await message.reply('❌ Marque um usuário para rebaixar!');
        }
    }
    
    else if (command === 'add') {
        const number = args[0];
        if (number) {
            const isBotAdm = await isBotAdmin(chat);
            if (isBotAdm) {
                try {
                    const formattedNumber = number.replace(/\D/g, '');
                    await chat.addParticipants([`${formattedNumber}@c.us`]);
                    await message.reply(`✅ Número ${formattedNumber} adicionado ao grupo!`);
                } catch (error) {
                    await message.reply('❌ Erro ao adicionar usuário. Verifique o número.');
                }
            } else {
                await message.reply('❌ Bot precisa ser admin para adicionar membros!');
            }
        } else {
            await message.reply('❌ Digite o número para adicionar!');
        }
    }
    
    else if (command === 'tagall') {
        const tagMsg = args.join(' ') || 'Marcação geral';
        let mentions = [];
        let mentionText = `📢 *${tagMsg}*\n\n`;
        
        chat.participants.forEach(participant => {
            const number = participant.id.user;
            mentions.push(participant.id._serialized);
            mentionText += `@${number} `;
        });
        
        await chat.sendMessage(mentionText, { mentions });
    }
    
    else if (command === 'tagallcut') {
        const tagMsg = args.join(' ') || 'Marcação invisível';
        let mentions = [];
        
        chat.participants.forEach(participant => {
            mentions.push(participant.id._serialized);
        });
        
        await chat.sendMessage(`📢 *${tagMsg}*`, { mentions });
    }
    
    else if (command === 'rename') {
        const newName = args.join(' ');
        if (newName) {
            const isBotAdm = await isBotAdmin(chat);
            if (isBotAdm) {
                await chat.setSubject(newName);
                await message.reply(`✅ Nome do grupo alterado para: ${newName}`);
            } else {
                await message.reply('❌ Bot precisa ser admin para alterar o nome!');
            }
        } else {
            await message.reply('❌ Digite o novo nome do grupo!');
        }
    }
    
    else if (command === 'desc') {
        const newDesc = args.join(' ');
        if (newDesc) {
            const isBotAdm = await isBotAdmin(chat);
            if (isBotAdm) {
                await chat.setDescription(newDesc);
                await message.reply('✅ Descrição do grupo alterada!');
            } else {
                await message.reply('❌ Bot precisa ser admin para alterar a descrição!');
            }
        } else {
            await message.reply('❌ Digite a nova descrição do grupo!');
        }
    }
    
    else if (command === 'creatgrup') {
        const groupName = args.join(' ');
        if (groupName) {
            try {
                await client.createGroup(groupName, [message.author]);
                await message.reply(`✅ Grupo "${groupName}" criado com sucesso!`);
            } catch (error) {
                await message.reply('❌ Erro ao criar grupo!');
            }
        } else {
            await message.reply('❌ Digite o nome do grupo!');
        }
    }
    
    // COMANDOS DE CHATBOT
    else if (command === 'chatbot') {
        if (args[0] === 'on') {
            groupData.chatbot.enabled = true;
            await message.reply('🤖 Chatbot ativado!');
        } else if (args[0] === 'off') {
            groupData.chatbot.enabled = false;
            await message.reply('🤖 Chatbot desativado!');
        } else if (args[0] === 'add') {
            const triggerResponse = args.slice(1).join(' ');
            if (triggerResponse.includes('=')) {
                const [trigger, response] = triggerResponse.split('=');
                botData.chatbot[trigger.toLowerCase().trim()] = {
                    type: 'text',
                    content: response.trim()
                };
                await message.reply(`✅ Gatilho "${trigger.trim()}" adicionado!`);
            } else {
                await message.reply('❌ Use o formato: !chatbot add gatilho=resposta');
            }
        } else if (args[0] === 'media') {
            const trigger = args[1];
            const mediaPath = args.slice(2).join(' ');
            if (trigger && mediaPath) {
                botData.chatbot[trigger.toLowerCase()] = {
                    type: 'media',
                    content: mediaPath
                };
                await message.reply(`✅ Mídia definida para gatilho "${trigger}"!`);
            }
        } else if (args[0] === 'remove') {
            const trigger = args[1];
            if (trigger && botData.chatbot[trigger.toLowerCase()]) {
                delete botData.chatbot[trigger.toLowerCase()];
                await message.reply(`✅ Gatilho "${trigger}" removido!`);
            } else {
                await message.reply('❌ Gatilho não encontrado!');
            }
        } else if (args[0] === 'list') {
            const triggers = Object.keys(botData.chatbot);
            if (triggers.length > 0) {
                await message.reply(`🤖 *Gatilhos ativos:*\n${triggers.join('\n')}`);
            } else {
                await message.reply('❌ Nenhum gatilho configurado!');
            }
        }
        saveData();
    }
    
    else if (command === 'mensege' && args[0] === 'post') {
        if (args[1] === 'on') {
            if (!botData.autoPost[groupId]) botData.autoPost[groupId] = {};
            botData.autoPost[groupId].enabled = true;
            await message.reply('✅ Postagens automáticas ativadas!');
        } else if (args[1] === 'off') {
            if (botData.autoPost[groupId]) {
                botData.autoPost[groupId].enabled = false;
            }
            await message.reply('❌ Postagens automáticas desativadas!');
        } else if (args[1] === 'minutos') {
            const minutes = parseInt(args[2]);
            const postMsg = args.slice(3).join(' ');
            if (minutes && postMsg) {
                if (!botData.autoPost[groupId]) botData.autoPost[groupId] = {};
                botData.autoPost[groupId] = {
                    enabled: true,
                    interval: minutes,
                    message: postMsg
                };
                
                // Configurar cron job
                cron.schedule(`*/${minutes} * * * *`, () => {
                    if (botData.autoPost[groupId] && botData.autoPost[groupId].enabled) {
                        client.sendMessage(groupId, botData.autoPost[groupId].message);
                    }
                });
                
                await message.reply(`✅ Postagem automática configurada para ${minutes} minutos!`);
            }
        }
        saveData();
    }
    
    else if (command === 'poll') {
        if (args[0] === 'resulte') {
            await message.reply('📊 Para ver resultados, clique nos 3 pontinhos da enquete e selecione "Ver votos"');
        } else {
            const pollData = args.join(' ');
            if (pollData.includes('=')) {
                const parts = pollData.split('=');
                if (parts.length >= 3) {
                    const question = parts[0].trim();
                    const options = parts.slice(1).map(opt => opt.trim());
                    
                    try {
                        await chat.sendMessage(`📊 *ENQUETE*\n\n*${question}*`, {
                            poll: {
                                name: question,
                                options: options,
                                selectableCount: 1
                            }
                        });
                    } catch (error) {
                        await message.reply('❌ Erro ao criar enquete. Use: !poll pergunta=opção1=opção2');
                    }
                } else {
                    await message.reply('❌ Use: !poll pergunta=opção1=opção2');
                }
            }
        }
    }
});

// Inicializar bot
client.initialize();

// Salvar dados a cada 5 minutos
setInterval(saveData, 5 * 60 * 1000);

// Tratar erros
process.on('uncaughtException', (error) => {
    console.log('Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Rejeição não tratada:', reason);
});

console.log('🚀 Iniciando WhatsApp Bot...');
console.log('📁 Dados salvos em:', config.dataDir);
console.log('⚡ Bot desenvolvido por: Admim-bot - Tecnologia');
