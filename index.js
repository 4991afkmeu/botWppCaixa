import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys'

import qrcode from 'qrcode-terminal'
import db from './db.js'


// ================= CONFIG =================
const NUMEROS_AUTORIZADOS = [
  '43142963323117@lid', // IEIDY
  '149770056265729@lid' // EU

]
const GRUPOS_AUTORIZADOS = [
  '120363422819250668@g.us', // grupo principal
  '120363422795378941@g.us', // LUCAS
  '120363423088236492@g.us'  // MATHEUS
]

const PREFIXO = '!'

// 🔐 Segurança
const DEV_MODE = true // ⚠️ false em produção
let aguardandoConfirmacaoReset = false
const FRASE_RESET = 'CONFIRMAR RESET TOTAL'
// ==========================================

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')

  const sock = makeWASocket({ auth: state })
  sock.ev.on('creds.update', saveCreds)

  // 🔑 Conexão
  sock.ev.on('connection.update', ({ connection, qr }) => {
    if (qr) qrcode.generate(qr, { small: true })

    if (connection === 'open') {
      console.log('✅ WhatsApp conectado')
    }

    if (connection === 'close') {
      console.log('❌ Conexão encerrada, reconectando...')
      startBot()
    }
  })

  // 📩 MENSAGENS
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg?.message) return

    const from = msg.key.remoteJid

    const grupo = from

    // 🔹 apenas grupos
    if (!from.endsWith('@g.us')) return

    // 🔒 grupo autorizado
    if (!GRUPOS_AUTORIZADOS.includes(from)) return

    // 📩 texto
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text

    if (!text) return
    if (!text.startsWith(PREFIXO)) return

    // 🔁 ignora respostas do bot
    if (
      msg.key.fromMe &&
      (text.includes('✅') || text.includes('❌') || text.includes('💰'))
    ) return

    // 👤 autor correto
    // 👤 autor correto
  const autor = msg.key.participant
  console.log('Autor detectado:', autor)


// 🔒 só usuários autorizados
if (!NUMEROS_AUTORIZADOS.includes(autor)) return


    // 🔒 só usuários autorizados
    if (!NUMEROS_AUTORIZADOS.includes(autor)) return


    // 🔁 evita duplicidade
    if (!(await finalizarMensagem(msg, grupo))) return

    const command = text
      .slice(PREFIXO.length)
      .toLowerCase()
      .trim()

    // ============ COMANDOS ============

    if (command.startsWith('entrada')) {
      const [, valor, ...desc] = command.split(' ')
      salvar('entrada', valor, desc.join(' '), grupo)
      return enviar(sock, from, '✅ Entrada registrada')
    }

    if (command.startsWith('saida') || command.startsWith('saída')) {
      const [, valor, ...desc] = command.split(' ')
      salvar('saida', valor, desc.join(' '), grupo)
      return enviar(sock, from, '❌ Saída registrada')
    }

    if (command === 'saldo') {
      const saldo = await calcularSaldo(grupo)
      return enviar(
        sock,
        from,
        `💰 Saldo atual: R$ ${saldo.toFixed(2)}`
      )
    }

    if (command === 'saldocompleto') {
      const texto = await gerarSaldoCompletoTexto(grupo)
      return enviar(sock, from, texto)
    }

    if (command === 'resetbanco') {
      if (!DEV_MODE) {
        return enviar(sock, from, '❌ Reset desativado')
      }

      aguardandoConfirmacaoReset = true

      return enviar(
        sock,
        from,
`⚠️ ATENÇÃO ⚠️

Este comando APAGA TODO O BANCO DESTE GRUPO.

Para confirmar, envie exatamente:
${PREFIXO}confirmar ${FRASE_RESET}`
      )
    }

    if (command === `confirmar ${FRASE_RESET.toLowerCase()}`) {
      if (!DEV_MODE || !aguardandoConfirmacaoReset) return

      aguardandoConfirmacaoReset = false
      await limparBanco(grupo)

      return enviar(sock, from, '🧹 Banco limpo com sucesso')
    }

    // ❓ fallback (não grava no banco)
    enviar(
      sock,
      from,
`❓ Comandos:
${PREFIXO}entrada valor descrição
${PREFIXO}saida valor descrição
${PREFIXO}saldo
${PREFIXO}saldocompleto`
    )
  })
}

// ================= FUNÇÕES =================

async function finalizarMensagem(msg, grupo) {
  const messageId = msg.key.id
  if (await jaProcessada(messageId, grupo)) return false
  marcarComoProcessada(messageId, grupo)
  return true
}

function salvar(tipo, valor, descricao, grupo) {
  db.run(
    'INSERT INTO movimentacoes (grupo, tipo, valor, descricao) VALUES (?, ?, ?, ?)',
    [grupo, tipo, Number(valor), descricao]
  )
}

function calcularSaldo(grupo) {
  return new Promise(resolve => {
    db.all(
      'SELECT tipo, valor FROM movimentacoes WHERE grupo = ?',
      [grupo],
      (err, rows) => {
        let saldo = 0
        rows.forEach(r => {
          saldo += r.tipo === 'entrada' ? r.valor : -r.valor
        })
        resolve(saldo)
      }
    )
  })
}

async function gerarSaldoCompletoTexto(grupo) {
  const rows = await buscarMovimentacoes(grupo)

  let texto = '📊 *SALDO COMPLETO*\n\n'
  let saldo = 0
  let totalEntradas = 0
  let totalSaidas = 0

  for (const r of rows) {
    const data = new Date(r.data + 'Z').toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo'
    })

    if (r.tipo === 'entrada') {
      saldo += r.valor
      totalEntradas += r.valor
      texto += '🟢 *Entrada*\n'
    } else {
      saldo -= r.valor
      totalSaidas += r.valor
      texto += '🔴 *Saída*\n'
    }

    texto += `💵 Valor: R$ ${r.valor.toFixed(2)}\n`
    texto += `📝 Desc: ${r.descricao || '-'}\n`
    texto += `📅 Data: ${data}\n\n`
  }

  texto += '━━━━━━━━━━━━━━━\n'
  texto += `💰💵 *TOTAL ENTRADAS: R$ ${totalEntradas.toFixed(2)}*\n`
  texto += `💰💸 *TOTAL SAÍDAS: R$ ${totalSaidas.toFixed(2)}*\n`
  texto += `💰⚖️ *SALDO FINAL: R$ ${saldo.toFixed(2)}*`

  return texto
}

function buscarMovimentacoes(grupo) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT tipo, valor, descricao, data
       FROM movimentacoes
       WHERE grupo = ?
       ORDER BY data ASC`,
      [grupo],
      (err, rows) => {
        if (err) reject(err)
        else resolve(rows)
      }
    )
  })
}

function jaProcessada(id, grupo) {
  return new Promise(resolve => {
    db.get(
      'SELECT 1 FROM mensagens_processadas WHERE id = ? AND grupo = ?',
      [id, grupo],
      (err, row) => resolve(!!row)
    )
  })
}

function marcarComoProcessada(id, grupo) {
  db.run(
    'INSERT OR IGNORE INTO mensagens_processadas (id, grupo) VALUES (?, ?)',
    [id, grupo]
  )
}

function limparBanco(grupo) {
  return new Promise(resolve => {
    db.serialize(() => {
      db.run('DELETE FROM movimentacoes WHERE grupo = ?', [grupo])
      db.run('DELETE FROM mensagens_processadas WHERE grupo = ?', [grupo])
      resolve()
    })
  })
}

function enviar(sock, to, text) {
  return sock.sendMessage(to, { text })
}

startBot()
