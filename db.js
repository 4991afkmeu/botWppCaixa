// db.js
const sqlite3 = require('sqlite3').verbose()

const db = new sqlite3.Database('./caixa.db')

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS movimentacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT,
      valor REAL,
      descricao TEXT,
      data DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS mensagens_processadas (
      id TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  
})

module.exports = db
