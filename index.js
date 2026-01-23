process.env.TZ = 'America/Sao_Paulo';

import makeWASocket, { 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion,
    jidNormalizedUser 
} from '@whiskeysockets/baileys';

import pino from 'pino';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import * as DB from './db.js';

// CONFIGURAÇÃO DE SEGURANÇA
const MEU_LID = '5521995210939@s.whatsapp.net'; 
const PREFIX = '!';

const logger = pino({ level: 'info' });
DB.initDb();

// Tratamento de Erros
process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Rejeição não tratada'));
process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Exceção não capturada');
    process.exit(1);
});

const toCents = (txt) => {
    const val = parseFloat(txt.replace(',', '.'));
    return isNaN(val) ? null : Math.round(val * 100);
};

const toBRL = (cents) => (cents / 100).toLocaleString('pt-br', { style: 'currency', currency: 'BRL' });

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        if (u.qr) qrcode.generate(u.qr, { small: true });
        if (u.connection === 'close') {
            const code = (u.lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (code !== 401) start();
        } else if (u.connection === 'open') {
            console.log('🚀 Sistema Financeiro Online e Seguro');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        if (!m.message) return;

        // 1. EXTRAÇÃO ROBUSTA DE TEXTO (Precisa vir antes de tudo)
        const text = (
            m.message.conversation || 
            m.message.extendedTextMessage?.text || 
            m.message.imageMessage?.caption || 
            m.message.videoMessage?.caption || 
            ""
        ).trim();

        const jid = m.key.remoteJid;
        const isMe = m.key.fromMe;

        // 2. FILTROS INICIAIS (Status, Canais e Anti-Loop)
        if (jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;
        
        // Blindagem: Se for eu, só continua se for um comando. 
        // Se for outra pessoa e não tiver prefixo, ignora também.
        if (!text.startsWith(PREFIX)) return;
        if (isMe && !text.startsWith(PREFIX)) return; 

        // 3. IDENTIFICAÇÃO DO USUÁRIO
        const sender = jidNormalizedUser(m.key.participant || jid);

        console.log('--- PROCESSANDO COMANDO ---');
        console.log(`DE: ${isMe ? 'MEU NÚMERO' : sender}`);
        console.log(`TEXTO: ${text}`);

        // 4. MESSAGE GUARD (Anti-duplicação)
        // Ignora o guard se for você mesmo testando, para facilitar
        if (!isMe && !DB.MessageGuard.isNew(m.key.id)) {
            console.log(`IGNORADO: Mensagem repetida`);
            return;
        }

        // 5. DEFINIÇÃO DE COMANDO E CARGOS
        const args = text.slice(PREFIX.length).trim().split(/ +/);
        const cmd = args.shift().toLowerCase();
        
        // Se for "fromMe", forçamos a role 'owner' para evitar erro de dígito 9
        const role = isMe ? 'owner' : DB.UserRepo.getRole(sender, MEU_LID);
        const isAuthorized = DB.GroupRepo.isAuthorized(jid);

        console.log(`ROLE: ${role} | AUTORIZADO: ${isAuthorized}`);

        try {
            // HIERARQUIA 1: ADM PRINCIPAL (Owner)
            if (role === 'owner') {
                if (cmd === 'addgrupo') { 
                    DB.GroupRepo.add(jid); 
                    return sock.sendMessage(jid, { text: '✅ Grupo autorizado para registros financeiros.' }); 
                }
                if (cmd === 'removegrupo') { 
                    DB.GroupRepo.remove(jid); 
                    return sock.sendMessage(jid, { text: '🚫 Grupo removido da lista autorizada.' }); 
                }
                
                const target = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (cmd === 'addadmin' && target) {
                    DB.UserRepo.setRole(target, 'admin', sender);
                    return sock.sendMessage(jid, { text: `👑 @${target.split('@')[0]} promovido a ADMIN.`, mentions: [target] });
                }
                if (cmd === 'removeadmin' && target) {
                    DB.UserRepo.remove(target);
                    return sock.sendMessage(jid, { text: '✅ Admin removido.' });
                }
            }

            // Bloqueio de segurança: Se o grupo não for autorizado, o bot não responde comandos abaixo
            if (!isAuthorized && role !== 'owner') return;

            // HIERARQUIA 2: ADMIN
            if (['owner', 'admin'].includes(role)) {
                const target = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (cmd === 'addmod' && target) {
                    DB.UserRepo.setRole(target, 'mod', sender);
                    return sock.sendMessage(jid, { text: `🛡️ @${target.split('@')[0]} promovido a MODERADOR.`, mentions: [target] });
                }
                
                // Auditoria e Deleção
                if (cmd === 'delultimo') {
                    DB.FinanceRepo.deleteN(jid, 1, sender);
                    return sock.sendMessage(jid, { text: '🗑️ Último registro removido com sucesso.' });
                }
                if (cmd === 'delid') {
                    const id = parseInt(args[0]);
                    const ok = DB.FinanceRepo.deleteById(id, sender);
                    return sock.sendMessage(jid, { text: ok ? `✅ Registro ID ${id} removido.` : '❌ ID não encontrado.' });
                }
            }

            // HIERARQUIA 3: QUALQUER CARGO (Mod, Admin, Owner)
            if (role) {
                if (cmd === 'entrada' || cmd === 'saida') {
                    const val = toCents(args[0]);
                    const d = args.slice(1).join(' ');
                    if (!val || !d) return sock.sendMessage(jid, { text: '❌ Use: !entrada 10,00 Descrição' });
                    
                    DB.FinanceRepo.add(jid, sender, cmd === 'entrada' ? 'IN' : 'OUT', val, d);
                    return sock.sendMessage(jid, { text: `✅ *${cmd.toUpperCase()} REGISTRADA*\n💰 Valor: ${toBRL(val)}\n📝 Desc: ${d}` });
                }
                if (cmd === 'saldo') {
                    const s = DB.FinanceRepo.getBalance(jid);
                    return sock.sendMessage(jid, { text: `📊 *FECHAMENTO ATUAL*\n\n💰 Saldo em Caixa: *${toBRL(s)}*` });
                }

                // --- COMANDO !AJUDA ---
                if (cmd === 'ajuda' || cmd === 'menu') {
                    const menu = `📖 *MENU DE COMANDOS* 📖\n\n` +
                        `*OPERACIONAIS:*\n` +
                        `!entrada [valor] [desc]\n` +
                        `!saida [valor] [desc]\n` +
                        `!saldo (Resumo do caixa)\n` +
                        `!rel (Relatório detalhado)\n` +
                        `!filtro [texto] (Busca registros)\n\n` +
                        `*GESTÃO:*\n` +
                        `!delultimo (Apaga o anterior)\n` +
                        `!delid [ID] (Apaga por ID)`;
                    return sock.sendMessage(jid, { text: menu });
                }

                // --- COMANDO !REL ---
                if (cmd === 'rel') {
                    const s = DB.FinanceRepo.getBalance(jid);
                    const report = DB.FinanceRepo.getFullReport(jid);
                    if (report.length === 0) return sock.sendMessage(jid, { text: '📭 Nenhuma transação encontrada.' });

                    let msg = `📋 *RELATÓRIO FINANCEIRO*\n\n`;
                    report.forEach(r => {
                        const userNum = r.user_jid.split('@')[0];
                        const emoji = r.type === 'IN' ? '🔹' : '🔸';
                        msg += `${emoji} *ID: ${r.id}* | ${toBRL(r.amount_cents)}\n`;
                        msg += `📝 ${r.description}\n`;
                        msg += `👤 Por: @${userNum}\n`;
                        const dataBr = new Date(r.timestamp + ' UTC').toLocaleString('pt-BR', {
                            timeZone: 'America/Sao_Paulo',
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        msg += `📅 ${dataBr}\n`;
                        msg += `──────────────────────────\n`;
                    });
                        msg += `📊 *FECHAMENTO ATUAL*\n\n💰 Saldo em Caixa: *${toBRL(s)}*`;

                    return sock.sendMessage(jid, { 
                        text: msg, 
                        mentions: report.map(r => r.user_jid),

                    });
                    
                }

                // --- COMANDO !FILTRO ---
                if (cmd === 'filtro') {
                    const busca = args.join(' ');
                    if (!busca) return sock.sendMessage(jid, { text: '❌ Use: !filtro [descrição]' });

                    const results = DB.FinanceRepo.filterByDesc(jid, busca);
                    if (results.length === 0) return sock.sendMessage(jid, { text: '🔍 Nenhum resultado para: ' + busca });

                    let msg = `🔍 *RESULTADOS PARA:* "${busca}"\n\n`;
                    results.forEach(r => {
                        const emoji = r.type === 'IN' ? '🔹' : '🔸';
                        msg += `${emoji} *ID: ${r.id}* - ${toBRL(r.amount_cents)}\n`;
                        msg += `📝 ${r.description}\n`;
                        msg += `📅 ${new Date(r.timestamp).toLocaleDateString('pt-BR')}\n\n`;
                    });

                    return sock.sendMessage(jid, { text: msg });
                }
            }

        } catch (e) {
            logger.error(e);
            return sock.sendMessage(jid, { text: '❌ Ocorreu um erro ao processar o comando.' });
        }
    });
}

start();