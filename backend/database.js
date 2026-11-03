const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const database = new DatabaseSync(
    path.join(__dirname, 'mitransporte.sqlite')
);

const definitions = {
    clientes: {
        columns: ['nombre', 'telefono', 'correo', 'provincia', 'observaciones'],
        seed: require('./routes/clientes')
    },
    cotizaciones: {
        columns: [
            'cliente', 'telefono', 'origen', 'destino', 'servicio',
            'importe', 'estado', 'observaciones'
        ],
        seed: require('./routes/cotizaciones')
    },
    transportes: {
        columns: ['cliente', 'origen', 'destino', 'tipo', 'estado'],
        seed: require('./routes/transportes')
    },
    contenedores: {
        columns: ['numero', 'cliente', 'tipo', 'puerto', 'estado'],
        seed: require('./routes/contenedores')
    },
    mensajes: {
        columns: ['canal', 'cliente', 'mensaje', 'estado'],
        seed: require('./routes/mensajes')
    }
};

for (const [table, definition] of Object.entries(definitions)) {
    const columns = definition.columns
        .map((column) => `"${column}" TEXT`)
        .join(', ');

    database.exec(`
        CREATE TABLE IF NOT EXISTS "${table}" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ${columns},
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const count = database
        .prepare(`SELECT COUNT(*) AS count FROM "${table}"`)
        .get().count;

    if (count === 0 && definition.seed.length > 0) {
        const columnsSql = definition.columns.map((column) => `"${column}"`).join(', ');
        const valuesSql = definition.columns.map(() => '?').join(', ');
        const insert = database.prepare(
            `INSERT INTO "${table}" (${columnsSql}) VALUES (${valuesSql})`
        );

        for (const row of definition.seed) {
            insert.run(...definition.columns.map((column) => row[column] ?? ''));
        }
    }
}

function list(table) {
    assertTable(table);
    return database.prepare(`SELECT * FROM "${table}" ORDER BY id DESC`).all();
}

function create(table, payload) {
    const definition = assertTable(table);
    const values = definition.columns.map((column) => payload[column] ?? '');
    const columnsSql = definition.columns.map((column) => `"${column}"`).join(', ');
    const valuesSql = definition.columns.map(() => '?').join(', ');
    const result = database.prepare(
        `INSERT INTO "${table}" (${columnsSql}) VALUES (${valuesSql})`
    ).run(...values);

    return database
        .prepare(`SELECT * FROM "${table}" WHERE id = ?`)
        .get(Number(result.lastInsertRowid));
}

function assertTable(table) {
    const definition = definitions[table];
    if (!definition) {
        const error = new Error(`Recurso no soportado: ${table}`);
        error.statusCode = 404;
        throw error;
    }
    return definition;
}

module.exports = { create, list };
