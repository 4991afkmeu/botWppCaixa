// db.js
import sqlite3 from 'sqlite3'

const db = new sqlite3.Database('./caixa.db')

db.serialize(() => {

  // 🔹 Movimentações separadas por grupo
  db.run(`
    CREATE TABLE IF NOT EXISTS movimentacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grupo TEXT NOT NULL,
      tipo TEXT CHECK(tipo IN ('entrada','saida')) NOT NULL,
      valor REAL NOT NULL,
      descricao TEXT,
      data DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 🔹 Controle de duplicidade (mensagem + grupo)
  db.run(`
    CREATE TABLE IF NOT EXISTS mensagens_processadas (
      id TEXT NOT NULL,
      grupo TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, grupo)
    )
  `)

})

export default db

