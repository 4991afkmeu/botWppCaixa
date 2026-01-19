import sqlite3 from 'sqlite3'
const db = new sqlite3.Database('./caixa.db')

// ================= BLINDAGEM DE SCHEMA =================
db.serialize(() => {
  // -------- MOVIMENTAÇÕES --------
  db.run(`
    CREATE TABLE IF NOT EXISTS movimentacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grupo TEXT,
      tipo TEXT,
      valor REAL,
      descricao TEXT,
      autor TEXT,
      mensagem_id TEXT,
      data DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // -------- MENSAGENS PROCESSADAS --------
  db.run(`
    CREATE TABLE IF NOT EXISTS mensagens_processadas (
      id TEXT,
      grupo TEXT
    )
  `)

  // índice de segurança (anti-duplicação)
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_grupo
    ON mensagens_processadas (id, grupo)
  `)

  // -------- USUÁRIOS AUTORIZADOS --------
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios_autorizados (
      lid TEXT,
      grupo TEXT
    )
  `)

  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_grupo
    ON usuarios_autorizados (lid, grupo)
  `)

  // 🔧 MIGRAÇÃO AUTOMÁTICA (colunas faltantes)
  blindarColunas()
})

// ================= FUNÇÃO DE MIGRAÇÃO =================
function blindarColunas () {
  db.all(`PRAGMA table_info(mensagens_processadas)`, (err, cols) => {
    if (err) return console.error('❌ PRAGMA erro:', err)

    const colunas = cols.map(c => c.name)

    if (!colunas.includes('grupo')) {
      console.warn('⚠️ Coluna "grupo" ausente em mensagens_processadas. Migrando...')
      db.run(`ALTER TABLE mensagens_processadas ADD COLUMN grupo TEXT`)
    }
  })
}

export default db
