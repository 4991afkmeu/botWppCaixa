const parseNumber = (jid) => {
    if (!jid) return '';
    // Pega só os números antes do @ e remove o "9" se for brasileiro e tiver 11 dígitos
    let num = jid.split('@')[0].replace(/\D/g, '');
    if (num.startsWith('55') && num.length === 13) {
        num = num.slice(0, 4) + num.slice(5); // Remove o 5º dígito (o 9)
    }
    return num;
};


import Database from 'better-sqlite3';

const db = new Database('financeiro.db');

// Otimização para concorrência e segurança
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

export const initDb = () => {
    // Grupos Autorizados (Governança)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS authorized_groups (
            jid TEXT PRIMARY KEY,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Usuários (Hierarquia: owner, admin, mod)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            jid TEXT PRIMARY KEY,
            role TEXT CHECK(role IN ('owner', 'admin', 'mod')),
            added_by TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Movimentações Financeiras (Valor em centavos para evitar erros de float)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_jid TEXT,
            user_jid TEXT,
            type TEXT CHECK(type IN ('IN', 'OUT')),
            amount_cents INTEGER,
            description TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Tabela de Auditoria (Histórico de alterações e deleções)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT,
            original_data TEXT,
            performed_by TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Anti-duplicação de mensagens
    db.prepare(`
        CREATE TABLE IF NOT EXISTS processed_messages (
            msg_id TEXT PRIMARY KEY,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
};

export const GroupRepo = {
    isAuthorized: (jid) => !!db.prepare('SELECT 1 FROM authorized_groups WHERE jid = ?').get(jid),
    add: (jid) => db.prepare('INSERT OR IGNORE INTO authorized_groups (jid) VALUES (?)').run(jid),
    remove: (jid) => db.prepare('DELETE FROM authorized_groups WHERE jid = ?').run(jid)
};

export const UserRepo = {
    getRole: (jid, ownerId) => {
        // Compara os números limpos, sem depender de @s.whatsapp.net ou do dígito 9
        if (parseNumber(jid) === parseNumber(ownerId)) return 'owner';
        
        const user = db.prepare('SELECT role FROM users WHERE jid = ?').get(jid);
        return user ? user.role : null;
    },
    setRole: (jid, role, addedBy) => {
        db.prepare('INSERT OR REPLACE INTO users (jid, role, added_by) VALUES (?, ?, ?)').run(jid, role, addedBy);
    },
    remove: (jid) => db.prepare('DELETE FROM users WHERE jid = ?').run(jid)
};

export const FinanceRepo = {
    add: (groupJid, userJid, type, amount, desc) => 
        db.prepare('INSERT INTO transactions (group_jid, user_jid, type, amount_cents, description) VALUES (?,?,?,?,?)').run(groupJid, userJid, type, amount, desc),
    
    getBalance: (groupJid) => {
        const rows = db.prepare('SELECT type, SUM(amount_cents) as total FROM transactions WHERE group_jid = ? GROUP BY type').all(groupJid);
        let balance = 0;
        rows.forEach(r => balance += (r.type === 'IN' ? r.total : -r.total));
        return balance;
    },

    deleteN: (groupJid, n, performedBy) => {
        const tx = db.transaction(() => {
            const records = db.prepare('SELECT * FROM transactions WHERE group_jid = ? ORDER BY id DESC LIMIT ?').all(groupJid, n);
            for (const r of records) {
                db.prepare('INSERT INTO audit_logs (action, original_data, performed_by) VALUES (?,?,?)').run('DELETE', JSON.stringify(r), performedBy);
                db.prepare('DELETE FROM transactions WHERE id = ?').run(r.id);
            }
            return records.length;
        });
        return tx();
    },

    deleteById: (id, performedBy) => {
        const tx = db.transaction(() => {
            const r = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
            if (!r) return false;
            db.prepare('INSERT INTO audit_logs (action, original_data, performed_by) VALUES (?,?,?)').run('DELETE_BY_ID', JSON.stringify(r), performedBy);
            db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
            return true;
        });
        return tx();
    },

    editById: (id, amount, desc, performedBy) => {
        const tx = db.transaction(() => {
            const r = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
            if (!r) return false;
            db.prepare('INSERT INTO audit_logs (action, original_data, performed_by) VALUES (?,?,?)').run('EDIT', JSON.stringify(r), performedBy);
            db.prepare('UPDATE transactions SET amount_cents = ?, description = ? WHERE id = ?').run(amount, desc, id);
            return true;
        });
        return tx();
    },

    // Gera o relatório de todas as transações do grupo
    getFullReport: (groupJid) => {
        return db.prepare(`
            SELECT id, user_jid, type, amount_cents, description, timestamp 
            FROM transactions 
            WHERE group_jid = ? 
            ORDER BY timestamp ASC
        `).all(groupJid);
    },

    // Filtra transações por descrição (busca parcial)
    filterByDesc: (groupJid, search) => {
        return db.prepare(`
            SELECT id, user_jid, type, amount_cents, description, timestamp 
            FROM transactions 
            WHERE group_jid = ? AND description LIKE ? 
            ORDER BY timestamp DESC
        `).all(groupJid, `%${search}%`);
    }
};

export const MessageGuard = {
    isNew: (id) => {
        try { db.prepare('INSERT INTO processed_messages (msg_id) VALUES (?)').run(id); return true; }
        catch { return false; }
    }
};