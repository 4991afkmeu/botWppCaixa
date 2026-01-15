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
//Segurança
  const DEV_MODE = true // ❗ coloque false em produção
  let aguardandoConfirmacaoReset = false
  const FRASE_RESET = 'CONFIRMAR RESET TOTAL'

  
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
          if (!(await finalizarMensagem(msg))) return

          const [, valor, ...desc] = command.split(' ')
          salvar('entrada', valor, desc.join(' '))
          return enviar(sock, from, '✅ Entrada registrada')
        }
      
        if (command.startsWith('saida') || command.startsWith('saída')) {
          if (!(await finalizarMensagem(msg))) return

          const [, valor, ...desc] = command.split(' ')
          salvar('saida', valor, desc.join(' '))
          return enviar(sock, from, '❌ Saída registrada')
        }
      
        if (command === 'saldo') {
          if (!(await finalizarMensagem(msg))) return

          const saldo = await calcularSaldo()
          return enviar(
            sock,
            from,
            `💰 Saldo atual: R$ ${saldo.toFixed(2)}`
          )
        }

        if (command === 'saldocompleto') {
          if (!(await finalizarMensagem(msg))) return
          
          const texto = await gerarSaldoCompletoTexto()
          return enviar(sock, from, texto)
        }
        
        if (command === 'resetbanco') {
          if (!DEV_MODE) {
            return enviar(sock, from, '❌ Reset desativado')
          }
        
          if (!(await finalizarMensagem(msg))) return
        
          aguardandoConfirmacaoReset = true
        
          return enviar(
            sock,
            from,
        `⚠️ ATENÇÃO ⚠️
        
        Esse comando APAGA TODO O BANCO.
        
        Para confirmar, envie exatamente:
        ${PREFIXO}confirmar ${FRASE_RESET}
        `
          )
        }
        
        if (command === `confirmar ${FRASE_RESET.toLowerCase()}`) {
          if (!DEV_MODE || !aguardandoConfirmacaoReset) return
        
          if (!(await finalizarMensagem(msg))) return
        
          aguardandoConfirmacaoReset = false
          await limparBanco()
        
          return enviar(
            sock,
            from,
        '🧹 Banco de dados limpo com sucesso'
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

  async function finalizarMensagem(msg) {
    const messageId = msg.key.id
    if (await jaProcessada(messageId)) return false
    marcarComoProcessada(messageId)
    return true
  }

  
  async function gerarSaldoCompletoTexto() {
    const rows = await buscarMovimentacoes()
  
    let texto = '📊 *SALDO COMPLETO*\n\n'
    let saldo = 0
    let totalEntradas = 0
    let totalSaidas = 0
  
    for (const r of rows) {
      const data = new Date(r.data + 'Z')
      .toLocaleString('pt-BR', {
        rimeZone: 'America/Sao_paulo'
      })
  
      if (r.tipo === 'entrada') {
        saldo += r.valor
        totalEntradas += r.valor
        texto += `🟢 *Entrada*\n`
      } else {
        saldo -= r.valor
        totalSaidas += r.valor
        texto += `🔴 *Saída*\n`
      }
  
      texto += `💵 Valor: R$ ${r.valor.toFixed(2)}\n`
      texto += `📝 Desc: ${r.descricao || '-'}\n`
      texto += `📅 Data: ${data}\n\n`
    }
  
    texto += `━━━━━━━━━━━━━━━\n`
    texto += `💰 *TOTAL ENTRADAS: R$ ${totalEntradas.toFixed(2)}*\n`
    texto += `💰 *TOTAL SAÍDAS: R$ ${totalSaidas.toFixed(2)}*\n`
    texto += `💰 *SALDO FINAL: R$ ${saldo.toFixed(2)}*`

  
    return texto
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

  function buscarMovimentacoes() {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT tipo, valor, descricao, data
         FROM movimentacoes
         ORDER BY data ASC`,
        (err, rows) => {
          if (err) reject(err)
          else resolve(rows)
        }
      )
    })
  }

  function limparBanco() {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('DELETE FROM movimentacoes')
        db.run('DELETE FROM mensagens_processadas')
        resolve()
      })
    })
  }
  
  
  
  startBot()
  