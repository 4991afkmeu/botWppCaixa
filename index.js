const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
  } = require('@whiskeysockets/baileys')
  
  const qrcode = require('qrcode-terminal')
  const db = require('./db')
  const MEU_NUMERO = '5521995210939@s.whatsapp.net'
  const GRUPO_AUTORIZADO = '120363422819250668@g.us'
  const PREFIXO ='!'
  
  async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')
  
    const sock = makeWASocket({
      auth: state
    })
  
    sock.ev.on('creds.update', saveCreds)
  
    // 🔑 QR CODE e status da conexão
    sock.ev.on('connection.update', (update) => {
      const { connection, qr } = update
  
      if (qr) {
        qrcode.generate(qr, { small: true })
      }
  
      if (connection === 'open') {
        console.log('✅ WhatsApp conectado com sucesso')
      }
  
      if (connection === 'close') {
        console.log('❌ Conexão encerrada, tentando reconectar...')
        startBot()
      }
    })
  
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0]
        if (!msg?.message) return
      
        // 🔑 origem
        const from = msg.key.remoteJid
      
        // 🔹 só grupos
        if (!from.endsWith('@g.us')) return
      
        // 🔒 grupo autorizado
        if (from !== GRUPO_AUTORIZADO) return
      
        // 📩 texto
        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text
      
        if (!text) return
      
        // 🔑 prefixo obrigatório
        if (!text.startsWith(PREFIXO)) return
      
        // 🔁 proteção contra loop (respostas do bot)
        if (
          msg.key.fromMe &&
          (
            text.includes('✅') ||
            text.includes('❌') ||
            text.includes('💰')
          )
        ) return
      
        // 🔁 DEDUPLICAÇÃO (AGORA NO LUGAR CERTO)
        const messageId = msg.key.id
        if (await jaProcessada(messageId)) return
        marcarComoProcessada(messageId)
      
        // 👤 identifica o autor corretamente
        const autor = msg.key.fromMe
          ? MEU_NUMERO
          : msg.key.participant
      
        // 🔒 só você
        if (autor !== MEU_NUMERO) return
      
        const command = text
          .slice(PREFIXO.length)
          .toLowerCase()
          .trim()
      
        // 👇 comandos
        if (command.startsWith('entrada')) {
          const [, valor, ...desc] = command.split(' ')
          salvar('entrada', valor, desc.join(' '))
          return enviar(sock, from, '✅ Entrada registrada')
        }
      
        if (command.startsWith('saida') || command.startsWith('saída')) {
          const [, valor, ...desc] = command.split(' ')
          salvar('saida', valor, desc.join(' '))
          return enviar(sock, from, '❌ Saída registrada')
        }
      
        if (command === 'saldo') {
          const saldo = await calcularSaldo()
          return enviar(
            sock,
            from,
            `💰 Saldo atual: R$ ${saldo.toFixed(2)}`
          )
        }
      
        // fallback
        enviar(
          sock,
          from,
      `❓ Comandos:
      ${PREFIXO}entrada valor descrição
      ${PREFIXO}saida valor descrição
      ${PREFIXO}saldo`
        )
      })
      
      
        
  }
  
  function salvar(tipo, valor, descricao) {
    db.run(
      'INSERT INTO movimentacoes (tipo, valor, descricao) VALUES (?, ?, ?)',
      [tipo, Number(valor), descricao]
    )
  }
  
  function calcularSaldo() {
    return new Promise(resolve => {
      db.all('SELECT tipo, valor FROM movimentacoes', (err, rows) => {
        let saldo = 0
        rows.forEach(r => {
          saldo += r.tipo === 'entrada' ? r.valor : -r.valor
        })
        resolve(saldo)
      })
    })
  }
  
  function enviar(sock, to, text) {
    return sock.sendMessage(to, { text })
  }
  function jaProcessada(id) {
    return new Promise(resolve => {
      db.get(
        'SELECT id FROM mensagens_processadas WHERE id = ?',
        [id],
        (err, row) => resolve(!!row)
      )
    })
  }
  
  function marcarComoProcessada(id) {
    db.run(
      'INSERT OR IGNORE INTO mensagens_processadas (id) VALUES (?)',
      [id]
    )
  }
  
  
  startBot()
  