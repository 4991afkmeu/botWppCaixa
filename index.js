import makeWASocket, {
  useMultiFileAuthState
} from '@whiskeysockets/baileys'

import qrcode from 'qrcode-terminal'
import db from './db.js'

// ================= CONFIG =================
const MEU_LID = '149770056265729@lid'

const USUARIOS_ADMIN = [
  MEU_LID
]

const GRUPOS_AUTORIZADOS = [
  '120363422819250668@g.us',
  '120363422795378941@g.us',
  '120363423088236492@g.us'
]

const PREFIXO = '!'

// 🔐 Segurança
const DEV_MODE = true
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
    if (connection === 'open') console.log('✅ WhatsApp conectado')
    if (connection === 'close') startBot()
  })

  // 📩 MENSAGENS
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg?.message) return

    const from = msg.key.remoteJid
    if (!from.endsWith('@g.us')) return
    if (!GRUPOS_AUTORIZADOS.includes(from)) return

    const grupo = from

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text

    if (!text || !text.startsWith(PREFIXO)) return

    // 🔁 ignora respostas do bot
    if (
      msg.key.fromMe &&
      (text.includes('✅') || text.includes('❌') || text.includes('💰'))
    ) return

    // 👤 autor (LID)
    const autor = normalizarAutor(
      msg.key.fromMe ? MEU_LID : msg.key.participant
    )


    console.log('Autor detectado:', autor)

    // 🛡️ ADMIN SEMPRE PASSA
    if (USUARIOS_ADMIN.includes(autor)) {
      autorizarUsuario(autor, grupo)
    } else {
      if (!(await usuarioAutorizado(autor, grupo))) return
    }

    // 🔁 evita duplicidade
    if (!(await finalizarMensagem(msg, grupo))) return

    const command = text
      .slice(PREFIXO.length)
      .toLowerCase()
      .trim()

    // ============ COMANDOS ============

    if (command.startsWith('entrada')) {
      const [, valor, ...desc] = command.split(' ')
      const valorNum = parseValor(valor)

    if (valorNum === null) {
      return enviar(sock, from, '❌ Valor inválido. Ex: 5,50 ou 5.50')
    }

    salvar('entrada', valorNum, desc.join(' '), grupo)
    return enviar(sock, from, '✅ Entrada registrada')

    }

    if (command.startsWith('saida') || command.startsWith('saída')) {
      const [, valor, ...desc] = command.split(' ')
      const valorNum = parseValor(valor)

    if (valorNum === null) {
      return enviar(sock, from, '❌ Valor inválido. Ex: 5,50 ou 5.50')
    }

    salvar('entrada', valorNum, desc.join(' '), grupo)
    return enviar(sock, from, '✅ Saída registrada')
    }

    if (command === 'saldo') {
      const saldo = await calcularSaldo(grupo)
      return enviar(sock, from, `💰 Saldo atual: ${saldo}`)
    }

    if (command === 'saldocompleto') {
      const texto = await gerarSaldoCompletoTexto(grupo)
      return enviar(sock, from, texto)
    }

    // 🔥 RESET
    if (command === 'resetbanco') {
      if (!DEV_MODE || !USUARIOS_ADMIN.includes(autor)) {
        return enviar(sock, from, '❌ Apenas administradores')
      }

      aguardandoConfirmacaoReset = true

      return enviar(
        sock,
        from,
`⚠️ ATENÇÃO ⚠️

Este comando APAGA TODO O BANCO DESTE GRUPO.

Para confirmar:
${PREFIXO}confirmar ${FRASE_RESET}`
      )
    }

    if (command === `confirmar ${FRASE_RESET.toLowerCase()}`) {
      if (!DEV_MODE || !aguardandoConfirmacaoReset) return
      if (!USUARIOS_ADMIN.includes(autor)) return

      aguardandoConfirmacaoReset = false
      await limparBanco(grupo)

      return enviar(sock, from, '🧹 Banco limpo com sucesso')
    }

    // ❓ fallback
    return enviar(
      sock,
      from,
`❓ Comandos:
${PREFIXO}entrada valor descrição
${PREFIXO}saida valor descrição
${PREFIXO}saldo
${PREFIXO}saldocompleto`
    )
  })

  // 👥 AUTORIZAÇÃO AUTOMÁTICA AO ENTRAR NO GRUPO
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    if (!GRUPOS_AUTORIZADOS.includes(id)) return

    if (action !== 'add') return

    for (const lid of participants) {
      const lidNormalizado = normalizarAutor(lid)
      autorizarUsuario(lidNormalizado, id)
      console.log('✅ Usuário autorizado automaticamente:', lid)
    }
  })
}

// ================= FUNÇÕES =================

async function finalizarMensagem(msg, grupo) {
  const id = msg.key.id
  if (await jaProcessada(id, grupo)) return false
  marcarComoProcessada(id, grupo)
  return true
}

function salvar(tipo, valor, descricao, grupo) {
  db.run(
    'INSERT INTO movimentacoes (grupo, tipo, valor, descricao) VALUES (?, ?, ?, ?)',
    [grupo, tipo, valor, descricao]
  )
}


function calcularSaldo(grupo) {
  return new Promise(resolve => {
    db.all(
      'SELECT tipo, valor FROM movimentacoes WHERE grupo = ?',
      [grupo],
      (_, rows) => {
        let saldo = 0
        rows.forEach(r => saldo += r.tipo === 'entrada' ? r.valor : -r.valor)
        resolve(formatarMoeda(saldo))
      }
    )
  })
}

async function gerarSaldoCompletoTexto(grupo) {
  const rows = await buscarMovimentacoes(grupo)

  let texto = '📊 *SALDO COMPLETO*\n\n'
  let saldo = 0

  for (const r of rows) {
    const data = new Date(r.data + 'Z').toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo'
    })

    saldo += r.tipo === 'entrada' ? r.valor : -r.valor
    texto += `${r.tipo === 'entrada' ? '🟢 Entrada' : '🔴 Saída'}\n`
    texto += `💵 ${formatarMoeda(r.valor)}\n`
    texto += `📝 ${r.descricao || '-'}\n`
    texto += `📅 ${data}\n\n`
  }

  texto += `━━━━━━━━━━━━━━━\n💰 *SALDO FINAL: R$ ${formatarMoeda(saldo)}*`
  return texto
}

function buscarMovimentacoes(grupo) {
  return new Promise(resolve => {
    db.all(
      'SELECT tipo, valor, descricao, data FROM movimentacoes WHERE grupo = ? ORDER BY data ASC',
      [grupo],
      (_, rows) => resolve(rows)
    )
  })
}

function jaProcessada(id, grupo) {
  return new Promise(resolve => {
    db.get(
      'SELECT 1 FROM mensagens_processadas WHERE id = ? AND grupo = ?',
      [id, grupo],
      (_, row) => resolve(!!row)
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

function autorizarUsuario(lid, grupo) {
  db.run(
    'INSERT OR IGNORE INTO usuarios_autorizados (lid, grupo) VALUES (?, ?)',
    [lid, grupo]
  )
}

function usuarioAutorizado(lid, grupo) {
  return new Promise(resolve => {
    db.get(
      'SELECT 1 FROM usuarios_autorizados WHERE lid = ? AND grupo = ?',
      [lid, grupo],
      (_, row) => resolve(!!row)
    )
  })
}

function normalizarAutor(id) {
  if (!id) return null

  // Se vier objeto (Baileys às vezes manda assim)
  if (typeof id === 'object') {
    if (id.id) id = id.id
    else return null
  }

  // Garante string
  id = String(id)

  // Já é LID
  if (id.endsWith('@lid')) return id

  // Número normal
  if (id.endsWith('@s.whatsapp.net')) {
    return id.split('@')[0] + '@lid'
  }

  return id
}

function parseValor(valorStr) {
  if (!valorStr) return null

  // remove R$, espaços e pontos de milhar
  let v = valorStr
    .replace(/\s/g, '')
    .replace('R$', '')
    .replace(/\./g, '')   // remove separador de milhar
    .replace(',', '.')    // troca vírgula por ponto

  const numero = Number(v)

  return isNaN(numero) ? null : numero
}

function formatarMoeda(v) {
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}



startBot()
