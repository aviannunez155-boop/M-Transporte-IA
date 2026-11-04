const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const database = new DatabaseSync(
    path.join(__dirname, 'mitransporte.sqlite')
);
database.exec('PRAGMA foreign_keys = ON');

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

const adminDefinitions = {
    roles: {
        columns: ['nombre', 'descripcion'],
        seed: [{ nombre: 'Administrador', descripcion: 'Acceso completo al sistema' }]
    },
    usuarios: {
        columns: ['nombre', 'correo', 'rol_id', 'estado'],
        seed: [{ nombre: 'Admin General', correo: 'admin@mitransporte.local', rol_id: 1, estado: 'Activo' }]
    },
    configuracion: {
        columns: ['clave', 'valor', 'descripcion'],
        seed: [
            { clave: 'nombre_empresa', valor: 'MiTransporte IA', descripcion: 'Nombre visible de la empresa' },
            { clave: 'moneda', valor: 'USD', descripcion: 'Moneda predeterminada' }
        ]
    },
    actividad: {
        columns: ['usuario_id', 'modulo', 'accion', 'descripcion'],
        seed: []
    },
    auditoria: {
        columns: ['usuario_id', 'modulo', 'accion', 'registro_id', 'detalles'],
        seed: []
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

for (const [table, definition] of Object.entries(adminDefinitions)) {
    const columns = definition.columns.map((column) => {
        if (table === 'usuarios' && column === 'rol_id') return '"rol_id" INTEGER REFERENCES roles(id) ON DELETE SET NULL';
        if (table === 'configuracion' && column === 'clave') return '"clave" TEXT UNIQUE NOT NULL';
        return `"${column}" TEXT`;
    }).join(', ');
    database.exec(`
        CREATE TABLE IF NOT EXISTS "${table}" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ${columns},
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    const count = database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count;
    if (count === 0 && definition.seed.length > 0) {
        const columnsSql = definition.columns.map((column) => `"${column}"`).join(', ');
        const valuesSql = definition.columns.map(() => '?').join(', ');
        const insert = database.prepare(`INSERT INTO "${table}" (${columnsSql}) VALUES (${valuesSql})`);
        for (const row of definition.seed) {
            insert.run(...definition.columns.map((column) => row[column] ?? ''));
        }

    }
}

database.exec(`
    CREATE TABLE IF NOT EXISTS permisos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clave TEXT NOT NULL UNIQUE,
        descripcion TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS rol_permisos (
        rol_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permiso_id INTEGER NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
        PRIMARY KEY (rol_id, permiso_id)
    );
    CREATE TABLE IF NOT EXISTS sesiones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS historial_estados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        modulo TEXT NOT NULL,
        registro_id INTEGER NOT NULL,
        estado_anterior TEXT,
        estado_nuevo TEXT NOT NULL,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_historial_estados_registro
        ON historial_estados (modulo, registro_id, created_at);
`);

const defaultPermissions = [
    ['dashboard.read', 'Ver el dashboard'],
    ['clientes.manage', 'Gestionar clientes'],
    ['cotizaciones.manage', 'Gestionar cotizaciones'],
    ['transportes.manage', 'Gestionar transportes'],
    ['contenedores.manage', 'Gestionar contenedores'],
    ['mensajes.manage', 'Gestionar mensajes'],
    ['reports.read', 'Ver reportes'],
    ['administracion.manage', 'Gestionar administración']
];
const insertPermission = database.prepare(
    'INSERT OR IGNORE INTO permisos (clave, descripcion) VALUES (?, ?)'
);
for (const permission of defaultPermissions) insertPermission.run(...permission);
const adminRole = database.prepare('SELECT id FROM roles WHERE nombre = ?').get('Administrador');
if (adminRole) {
    database.prepare(`
        INSERT OR IGNORE INTO rol_permisos (rol_id, permiso_id)
        SELECT ?, id FROM permisos
    `).run(adminRole.id);
}

function addColumn(table, column, definition) {
    const columns = database.prepare(`PRAGMA table_info("${table}")`).all();
    if (!columns.some((item) => item.name === column)) {
        database.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
    }
}

addColumn('cotizaciones', 'cliente_id', 'INTEGER REFERENCES clientes(id) ON DELETE SET NULL');
addColumn('transportes', 'cliente_id', 'INTEGER REFERENCES clientes(id) ON DELETE SET NULL');
addColumn('transportes', 'cotizacion_id', 'INTEGER REFERENCES cotizaciones(id) ON DELETE SET NULL');
addColumn('contenedores', 'cliente_id', 'INTEGER REFERENCES clientes(id) ON DELETE SET NULL');
addColumn('contenedores', 'transporte_id', 'INTEGER REFERENCES transportes(id) ON DELETE SET NULL');
addColumn('usuarios', 'password_hash', 'TEXT');
database.exec(`
    CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente_id ON cotizaciones(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_transportes_cliente_id ON transportes(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_transportes_cotizacion_id ON transportes(cotizacion_id);
    CREATE INDEX IF NOT EXISTS idx_contenedores_cliente_id ON contenedores(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_contenedores_transporte_id ON contenedores(transporte_id);
`);

const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
const adminPasswordHash = hashPassword(adminPassword);
database.prepare(`
    UPDATE usuarios SET password_hash = ?
    WHERE correo = 'admin@mitransporte.local' AND (password_hash IS NULL OR password_hash = '')
`).run(adminPasswordHash);

database.exec(`
    INSERT INTO clientes (nombre, telefono, correo, provincia, observaciones)
    SELECT DISTINCT TRIM(origen.cliente), '', '', '', 'Cliente creado al migrar un registro histórico'
    FROM (
        SELECT cliente FROM cotizaciones
        UNION ALL SELECT cliente FROM transportes
        UNION ALL SELECT cliente FROM contenedores
    ) AS origen
    WHERE TRIM(COALESCE(origen.cliente, '')) <> ''
      AND NOT EXISTS (
          SELECT 1 FROM clientes
          WHERE lower(TRIM(clientes.nombre)) = lower(TRIM(origen.cliente))
      );
    UPDATE cotizaciones
    SET cliente_id = (
        SELECT id FROM clientes
        WHERE clientes.nombre = cotizaciones.cliente
        LIMIT 1
    )
    WHERE cliente_id IS NULL AND cliente IS NOT NULL AND cliente <> '';
    UPDATE transportes
    SET cotizacion_id = (
        SELECT cotizaciones.id
        FROM cotizaciones
        WHERE cotizaciones.cliente_id = transportes.cliente_id
          AND cotizaciones.origen = transportes.origen
          AND cotizaciones.destino = transportes.destino
        ORDER BY cotizaciones.id
        LIMIT 1
    )
    WHERE cotizacion_id IS NULL AND cliente_id IS NOT NULL;
    UPDATE transportes
    SET cliente_id = (
        SELECT id FROM clientes
        WHERE clientes.nombre = transportes.cliente
        LIMIT 1
    )
    WHERE cliente_id IS NULL AND cliente IS NOT NULL AND cliente <> '';
    UPDATE contenedores
    SET cliente_id = (
        SELECT id FROM clientes
        WHERE clientes.nombre = contenedores.cliente
        LIMIT 1
    )
    WHERE cliente_id IS NULL AND cliente IS NOT NULL AND cliente <> '';
    UPDATE cotizaciones SET estado = 'Aprobado' WHERE estado = 'Enviada';
    UPDATE cotizaciones SET estado = 'Pendiente' WHERE estado = 'Rechazada';
    UPDATE contenedores SET estado = 'En Proceso' WHERE estado = 'En extracción';
    UPDATE mensajes SET estado = 'Pendiente' WHERE estado = 'Nuevo';
`);

function list(table) {
    if (table === 'historial_estados') {
        return database.prepare(`
            SELECT historial_estados.*, usuarios.nombre AS usuario
            FROM historial_estados
            LEFT JOIN usuarios ON usuarios.id = historial_estados.usuario_id
            ORDER BY historial_estados.id DESC
        `).all();
    }
    if (table === 'permisos') {
        return database.prepare('SELECT * FROM permisos ORDER BY clave').all();
    }
    if (table === 'rol_permisos') {
        return database.prepare(`
            SELECT rol_permisos.rol_id, rol_permisos.permiso_id,
                   roles.nombre AS rol, permisos.clave AS permiso
            FROM rol_permisos
            JOIN roles ON roles.id = rol_permisos.rol_id
            JOIN permisos ON permisos.id = rol_permisos.permiso_id
            ORDER BY roles.nombre, permisos.clave
        `).all();
    }
    if (adminDefinitions[table]) {
        if (table === 'usuarios') {
            return database.prepare(`
                SELECT usuarios.id, usuarios.nombre, usuarios.correo,
                       usuarios.rol_id, usuarios.estado, usuarios.created_at,
                       roles.nombre AS rol
                FROM usuarios LEFT JOIN roles ON roles.id = usuarios.rol_id
                ORDER BY usuarios.id DESC
            `).all();
        }
        return database.prepare(`SELECT * FROM "${table}" ORDER BY id DESC`).all();
    }
    assertTable(table);
    if (table === 'cotizaciones') {
        return database.prepare(`
            SELECT cotizaciones.*, clientes.nombre AS cliente_nombre
            FROM cotizaciones
            LEFT JOIN clientes ON clientes.id = cotizaciones.cliente_id
            ORDER BY cotizaciones.id DESC
        `).all().map((row) => ({
            ...row,
            cliente: row.cliente_nombre || row.cliente
        }));
    }
    if (table === 'transportes') {
        return database.prepare(`
            SELECT transportes.*, clientes.nombre AS cliente_nombre,
                   cotizaciones.cliente_id AS cotizacion_cliente_id
            FROM transportes
            LEFT JOIN clientes ON clientes.id = transportes.cliente_id
            LEFT JOIN cotizaciones ON cotizaciones.id = transportes.cotizacion_id
            ORDER BY transportes.id DESC
        `).all().map((row) => ({
            ...row,
            cliente: row.cliente_nombre || row.cliente
        }));
    }
    if (table === 'contenedores') {
        return database.prepare(`
            SELECT contenedores.*, clientes.nombre AS cliente_nombre,
                   transportes.cotizacion_id,
                   transportes.origen AS transporte_origen,
                   transportes.destino AS transporte_destino
            FROM contenedores
            LEFT JOIN clientes ON clientes.id = contenedores.cliente_id
            LEFT JOIN transportes ON transportes.id = contenedores.transporte_id
            ORDER BY contenedores.id DESC
        `).all().map((row) => ({
            ...row,
            cliente: row.cliente_nombre || row.cliente
        }));
    }
    return database.prepare(`SELECT * FROM "${table}" ORDER BY id DESC`).all();
}

function create(table, payload) {
    if (adminDefinitions[table]) {
        if (table === 'actividad' || table === 'auditoria') {
            throw validationError('Los registros de actividad y auditoría son de solo lectura');
        }
        return createAdminRecord(table, payload);
    }
    assertTable(table);
    if (table === 'cotizaciones') {
        return createQuotation(payload);
    }

    if (table === 'transportes') {
        return createTransport(payload);
    }
    if (table === 'contenedores') {
        return createContainer(payload);
    }
    const definition = definitions[table];
    const normalizedPayload = payload.estado !== undefined
        ? { ...payload, estado: normalizeStatus(payload.estado) }
        : payload;
    const values = definition.columns.map((column) => normalizedPayload[column] ?? '');
    const columnsSql = definition.columns.map((column) => `"${column}"`).join(', ');
    const valuesSql = definition.columns.map(() => '?').join(', ');
    const result = database.prepare(
        `INSERT INTO "${table}" (${columnsSql}) VALUES (${valuesSql})`
    ).run(...values);

    const record = database
        .prepare(`SELECT * FROM "${table}" WHERE id = ?`)
        .get(Number(result.lastInsertRowid));
    recordAudit(table, 'Crear', record.id, `${table} #${record.id}`);
    return record;
}

function createAdminRecord(table, payload) {
    const definition = adminDefinitions[table];
    if (table === 'usuarios') {
        const role = database.prepare('SELECT id FROM roles WHERE id = ?').get(Number(payload.rol_id));
        if (!role) throw validationError('Debe seleccionar un rol válido');
    }
    if (table === 'configuracion') {
        const existing = database.prepare('SELECT id FROM configuracion WHERE clave = ?').get(payload.clave);
        if (existing) {
            database.prepare('UPDATE configuracion SET valor = ?, descripcion = ? WHERE id = ?')
                .run(payload.valor ?? '', payload.descripcion ?? '', existing.id);
            recordAudit('Administración', 'Actualizar', existing.id, `configuracion: ${payload.clave}`);
            return database.prepare('SELECT * FROM configuracion WHERE id = ?').get(existing.id);
        }
    }
    const insertPayload = table === 'usuarios'
        ? { ...payload, password_hash: hashPassword(payload.password || adminPassword) }
        : payload;
    const insertColumns = table === 'usuarios'
        ? [...definition.columns, 'password_hash']
        : definition.columns;
    const result = insertRecord(table, insertColumns, insertPayload);
    const record = database.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(Number(result.lastInsertRowid));
    if (table !== 'actividad' && table !== 'auditoria') {
        recordAudit('Administración', 'Crear', record.id, `${table}: ${record.nombre || record.clave || record.correo || ''}`);
    }
    return table === 'usuarios' ? list('usuarios').find((row) => row.id === record.id) : record;
}

function update(table, id, payload) {
    if (adminDefinitions[table]) {
        if (table === 'actividad' || table === 'auditoria') {
            throw validationError('Los registros de actividad y auditoría son de solo lectura');
        }
        return updateAdminRecord(table, id, payload);
    }
    assertTable(table);
    const recordId = Number(id);
    const current = database.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(recordId);
    if (!current) throw notFoundError();

    if (table === 'cotizaciones' && payload.cliente_id !== undefined) {
        assertReference('clientes', payload.cliente_id, 'cliente');
    }
    if (table === 'transportes' && payload.cotizacion_id !== undefined) {
        const quotation = database.prepare('SELECT cliente_id FROM cotizaciones WHERE id = ?')
            .get(Number(payload.cotizacion_id));
        if (!quotation) throw validationError('Debe seleccionar una cotización válida');
        payload = { ...payload, cliente_id: quotation.cliente_id };
    }
    if (table === 'transportes' && payload.cliente_id !== undefined
        && current.cotizacion_id) {
        const quotation = database.prepare('SELECT cliente_id FROM cotizaciones WHERE id = ?')
            .get(current.cotizacion_id);
        if (quotation && Number(payload.cliente_id) !== quotation.cliente_id) {
            throw validationError('El cliente no coincide con la cotización asociada');
        }
    }
    if (table === 'contenedores' && payload.transporte_id !== undefined) {
        const transport = database.prepare('SELECT cliente_id FROM transportes WHERE id = ?')
            .get(Number(payload.transporte_id));
        if (payload.transporte_id !== '' && !transport) {
            throw validationError('Debe seleccionar un transporte válido');
        }
        payload = transport
            ? { ...payload, cliente_id: transport.cliente_id }
            : payload;
    }
    if (table === 'contenedores' && payload.cliente_id !== undefined) {
        assertReference('clientes', payload.cliente_id, 'cliente');
        if (current.transporte_id && Number(payload.cliente_id) !== current.cliente_id) {
            throw validationError('El cliente no coincide con el transporte asociado');
        }
    }
    if (payload.estado !== undefined) {
        payload = { ...payload, estado: normalizeStatus(payload.estado) };
        validateTransition(table, current, payload.estado);
    }

    const columns = editableColumns(table).filter((column) => payload[column] !== undefined);
    if (!columns.length) throw validationError('No hay campos válidos para actualizar');
    const setSql = columns.map((column) => `"${column}" = ?`).join(', ');
    database.prepare(`UPDATE "${table}" SET ${setSql} WHERE id = ?`)
        .run(...columns.map((column) => payload[column]), recordId);
    const updated = list(table).find((row) => row.id === recordId);
    if (payload.estado !== undefined && payload.estado !== current.estado) {
        recordStatusHistory(table, recordId, current.estado, payload.estado);
    }
    recordAudit(table, 'Actualizar', recordId, `Registro #${recordId}`);
    return updated;
}

function remove(table, id) {
    if (table === 'actividad' || table === 'auditoria') {
        throw validationError('Los registros de actividad y auditoría son de solo lectura');
    }
    if (adminDefinitions[table]) assertAdminTable(table);
    else assertTable(table);
    const recordId = Number(id);
    const result = database.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(recordId);
    if (!result.changes) throw notFoundError();
    recordAudit(table, 'Eliminar', recordId, `Registro #${recordId}`);
    return { id: recordId, deleted: true };
}

function updateAdminRecord(table, id, payload) {
    assertAdminTable(table);
    const recordId = Number(id);
    const current = database.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(recordId);
    if (!current) throw notFoundError();
    if (table === 'usuarios' && payload.rol_id !== undefined) {
        assertReference('roles', payload.rol_id, 'rol');
    }
    const updatePayload = table === 'usuarios' && payload.password
        ? { ...payload, password_hash: hashPassword(payload.password) }
        : payload;
    const allowedColumns = table === 'usuarios'
        ? [...adminDefinitions[table].columns, 'password_hash']
        : adminDefinitions[table].columns;
    const columns = allowedColumns.filter((column) => updatePayload[column] !== undefined);
    if (!columns.length) throw validationError('No hay campos válidos para actualizar');
    const setSql = columns.map((column) => `"${column}" = ?`).join(', ');
    database.prepare(`UPDATE "${table}" SET ${setSql} WHERE id = ?`)
        .run(...columns.map((column) => updatePayload[column]), recordId);
    const updated = list(table).find((row) => row.id === recordId);
    recordAudit('Administración', 'Actualizar', recordId, `${table} #${recordId}`);
    return updated;
}

function editableColumns(table) {
    const relationColumns = {
        cotizaciones: ['cliente_id', 'telefono', 'origen', 'destino', 'servicio', 'importe', 'estado', 'observaciones'],
        transportes: ['cliente_id', 'cotizacion_id', 'origen', 'destino', 'tipo', 'estado'],
        contenedores: ['cliente_id', 'transporte_id', 'numero', 'tipo', 'puerto', 'estado']
    };
    return relationColumns[table] || definitions[table].columns;
}

function assertAdminTable(table) {
    if (!adminDefinitions[table]) throw notFoundError();
    return adminDefinitions[table];
}

function assertReference(table, id, label) {
    const record = database.prepare(`SELECT id FROM "${table}" WHERE id = ?`).get(Number(id));
    if (!record) throw validationError(`Debe seleccionar un ${label} válido`);
}

function notFoundError() {
    const error = new Error('Registro no encontrado');
    error.statusCode = 404;
    return error;
}

function recordAudit(modulo, accion, registroId, detalles) {
    insertRecord('auditoria', ['usuario_id', 'modulo', 'accion', 'registro_id', 'detalles'], {
        usuario_id: 1, modulo, accion, registro_id: registroId, detalles
    });
    insertRecord('actividad', ['usuario_id', 'modulo', 'accion', 'descripcion'], {
        usuario_id: 1, modulo, accion, descripcion: detalles
    });
}

function createQuotation(payload) {
    const client = database.prepare('SELECT id FROM clientes WHERE id = ?').get(Number(payload.cliente_id));
    if (!client) {
        throw validationError('Debe seleccionar un cliente válido');
    }
    const columns = [
        'cliente_id', 'telefono', 'origen', 'destino', 'servicio',
        'importe', 'estado', 'observaciones'
    ];
    const initialStatus = normalizeStatus(payload.estado);
    if (initialStatus !== 'Pendiente') {
        throw validationError('Una cotización nueva debe comenzar en estado Pendiente');
    }
    const result = insertRecord('cotizaciones', columns, {
        ...payload,
        estado: initialStatus
    });
    const record = list('cotizaciones').find((row) => row.id === Number(result.lastInsertRowid));
    recordStatusHistory('cotizaciones', record.id, null, record.estado);
    recordAudit('cotizaciones', 'Crear', record.id, `cotizaciones #${record.id}`);
    return record;
}

function createTransport(payload) {
    const quotation = database.prepare(`
        SELECT id, cliente_id, origen, destino, servicio, estado
        FROM cotizaciones WHERE id = ?
    `).get(Number(payload.cotizacion_id));
    if (!quotation) {
        throw validationError('Debe seleccionar una cotización válida');
    }
    if (!quotation.cliente_id) {
        throw validationError('La cotización seleccionada no tiene un cliente asociado');
    }
    if (quotation.estado !== 'Aprobado') {
        throw validationError('La cotización debe estar Aprobado antes de crear el transporte');
    }
    const columns = ['cliente_id', 'cotizacion_id', 'origen', 'destino', 'tipo', 'estado'];
    const transport = {
        ...payload,
        cliente_id: quotation.cliente_id,
        origen: payload.origen || quotation.origen,
        destino: payload.destino || quotation.destino,
        tipo: payload.tipo || quotation.servicio,
        estado: normalizeStatus(payload.estado)
    };
    const result = insertRecord('transportes', columns, transport);
    const record = list('transportes').find((row) => row.id === Number(result.lastInsertRowid));
    recordStatusHistory('transportes', record.id, null, record.estado);
    recordAudit('transportes', 'Crear', record.id, `transportes #${record.id}`);
    return record;
}

const workflowStatuses = ['Pendiente', 'Aprobado', 'En Proceso', 'Finalizado'];

function createContainer(payload) {
    let transport = null;
    if (payload.transporte_id !== undefined && payload.transporte_id !== '') {
        transport = database.prepare(
            'SELECT id, cliente_id, estado FROM transportes WHERE id = ?'
        ).get(Number(payload.transporte_id));
        if (!transport) {
            throw validationError('Debe seleccionar un transporte válido');
        }
        if (!['En Proceso', 'Finalizado'].includes(transport.estado)) {
            throw validationError('El transporte debe estar En Proceso antes de crear el contenedor');
        }
        if (payload.cliente_id !== undefined && payload.cliente_id !== ''
            && Number(payload.cliente_id) !== transport.cliente_id) {
            throw validationError('El cliente no coincide con el transporte seleccionado');
        }
    }
    const clienteId = transport
        ? transport.cliente_id
        : Number(payload.cliente_id);
    if (!clienteId) {
        throw validationError('Debe seleccionar un cliente');
    }
    const columns = ['cliente_id', 'transporte_id', 'numero', 'tipo', 'puerto', 'estado'];
    const container = {
        ...payload,
        cliente_id: clienteId,
        transporte_id: transport ? transport.id : null,
        estado: normalizeStatus(payload.estado)
    };
    const result = insertRecord('contenedores', columns, container);
    const record = list('contenedores').find((row) => row.id === Number(result.lastInsertRowid));
    recordStatusHistory('contenedores', record.id, null, record.estado);
    recordAudit('contenedores', 'Crear', record.id, `contenedores #${record.id}`);
    return record;
}

function updateStatus(table, id, status) {
    assertTable(table);
    const normalized = normalizeStatus(status);
    const current = database.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(Number(id));
    if (!current) {
        throw notFoundError();
    }
    validateTransition(table, current, normalized);
    const result = database.prepare(
        `UPDATE "${table}" SET estado = ? WHERE id = ?`
    ).run(normalized, Number(id));
    if (!result.changes) {
        const error = new Error('Registro no encontrado');
        error.statusCode = 404;
        throw error;
    }
    const record = list(table).find((row) => row.id === Number(id));
    if (current.estado !== normalized) {
        recordStatusHistory(table, record.id, current.estado, normalized);
    }
    recordAudit(table, 'Actualizar estado', record.id, `Estado: ${normalized}`);
    return record;
}

function validateTransition(table, record, nextStatus) {
    if (record.estado === nextStatus) return;
    const currentIndex = workflowStatuses.indexOf(record.estado);
    const nextIndex = workflowStatuses.indexOf(nextStatus);
    if (currentIndex < 0 || nextIndex !== currentIndex + 1) {
        throw validationError(`Transición inválida. ${table} debe avanzar en orden: ${workflowStatuses.join(' → ')}`);
    }
    if (table === 'transportes' && nextStatus === 'En Proceso') {
        const quotation = database.prepare('SELECT estado FROM cotizaciones WHERE id = ?').get(record.cotizacion_id);
        if (!quotation || quotation.estado !== 'Aprobado') {
            throw validationError('El transporte requiere una cotización aprobada');
        }
    }
    if (table === 'contenedores' && nextStatus === 'Finalizado') {
        const transport = database.prepare('SELECT estado FROM transportes WHERE id = ?').get(record.transporte_id);
        if (!transport || transport.estado !== 'Finalizado') {
            throw validationError('El transporte debe estar Finalizado antes de completar el contenedor');
        }
    }
}

function normalizeStatus(status) {
    const input = String(status || 'Pendiente').trim().toLowerCase();
    const value = workflowStatuses.find((item) => item.toLowerCase() === input);
    if (!value) {
        throw validationError(`Estado inválido. Use: ${workflowStatuses.join(', ')}`);
    }
    return value;
}

function insertRecord(table, columns, payload) {
    const columnSql = columns.map((column) => `"${column}"`).join(', ');
    const valuesSql = columns.map(() => '?').join(', ');
    return database.prepare(
        `INSERT INTO "${table}" (${columnSql}) VALUES (${valuesSql})`
    ).run(...columns.map((column) => payload[column] ?? ''));
}

function recordStatusHistory(modulo, registroId, estadoAnterior, estadoNuevo) {
    database.prepare(`
        INSERT INTO historial_estados
            (modulo, registro_id, estado_anterior, estado_nuevo, usuario_id)
        VALUES (?, ?, ?, ?, ?)
    `).run(modulo, registroId, estadoAnterior, estadoNuevo, 1);
}

function validationError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) return false;
    const [salt, expected] = storedHash.split(':');
    const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function authenticate(email, password) {
    const user = database.prepare(`
        SELECT usuarios.*, roles.nombre AS rol
        FROM usuarios LEFT JOIN roles ON roles.id = usuarios.rol_id
        WHERE lower(usuarios.correo) = lower(?) AND usuarios.estado = 'Activo'
    `).get(String(email || '').trim());
    if (!user || !verifyPassword(password, user.password_hash)) return null;
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    database.prepare('INSERT INTO sesiones (usuario_id, token_hash, expires_at) VALUES (?, ?, ?)')
        .run(user.id, tokenHash, expires);
    recordAudit('Autenticación', 'Login', user.id, `Inicio de sesión: ${user.correo}`);
    return {
        token,
        user: { id: user.id, nombre: user.nombre, correo: user.correo, rol: user.rol }
    };
}

function sessionUser(token) {
    if (!token) return null;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = database.prepare(`
        SELECT usuarios.id, usuarios.nombre, usuarios.correo, roles.nombre AS rol
        FROM sesiones
        JOIN usuarios ON usuarios.id = sesiones.usuario_id
        LEFT JOIN roles ON roles.id = usuarios.rol_id
        WHERE sesiones.token_hash = ? AND sesiones.expires_at > ?
              AND usuarios.estado = 'Activo'
    `).get(tokenHash, new Date().toISOString());
    return session || null;
}

function revokeSession(token) {
    if (!token) return;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    database.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(tokenHash);
}

function setRolePermissions(roleId, permissionKeys) {
    assertReference('roles', roleId, 'rol');
    const keys = Array.isArray(permissionKeys) ? permissionKeys : [];
    const permissions = keys.map((key) =>
        database.prepare('SELECT id FROM permisos WHERE clave = ?').get(String(key))
    );
    if (permissions.some((permission) => !permission)) {
        throw validationError('Uno o más permisos no existen');
    }
    database.prepare('DELETE FROM rol_permisos WHERE rol_id = ?').run(Number(roleId));
    const insert = database.prepare('INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (?, ?)');
    permissions.forEach((permission) => insert.run(Number(roleId), permission.id));
    recordAudit('Administración', 'Actualizar permisos', Number(roleId), `Permisos asignados: ${keys.join(', ')}`);
    return list('rol_permisos').filter((item) => item.rol_id === Number(roleId));
}

function dashboardData() {
    const tables = Object.keys(definitions);
    const counts = Object.fromEntries(
        tables.map((table) => [
            table,
            database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count
        ])
    );
    const activity = database.prepare(`
        SELECT * FROM (
            SELECT 'Clientes' AS module, 'Nuevo cliente registrado' AS action,
                   nombre AS subject, created_at
            FROM clientes
            UNION ALL
            SELECT 'Cotizaciones', 'Nueva cotización registrada',
                   cliente, created_at
            FROM cotizaciones
            UNION ALL
            SELECT 'Transportes', 'Nuevo transporte registrado',
                   cliente, created_at
            FROM transportes
            UNION ALL
            SELECT 'Contenedores', 'Nuevo contenedor registrado',
                   COALESCE(numero, cliente), created_at
            FROM contenedores
            UNION ALL
            SELECT 'Mensajes', 'Nuevo mensaje recibido',
                   cliente, created_at
            FROM mensajes
        )
        ORDER BY datetime(created_at) DESC
        LIMIT 10
    `).all();
    const recentRecords = database.prepare(`
        SELECT * FROM (
            SELECT 'Clientes' AS module, id, nombre AS subject, created_at FROM clientes
            UNION ALL
            SELECT 'Cotizaciones', id, cliente, created_at FROM cotizaciones
            UNION ALL
            SELECT 'Transportes', id, cliente, created_at FROM transportes
            UNION ALL
            SELECT 'Contenedores', id, COALESCE(numero, cliente), created_at FROM contenedores
            UNION ALL
            SELECT 'Mensajes', id, cliente, created_at FROM mensajes
        )
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 10
    `).all();

    return { counts, activity, recentRecords, reports: reportData() };
}

function reportData() {
    const status = (table) => database.prepare(`
        SELECT COALESCE(NULLIF(estado, ''), 'Sin estado') AS label, COUNT(*) AS value
        FROM "${table}" GROUP BY label ORDER BY value DESC
    `).all();
    const byProvince = database.prepare(`
        SELECT COALESCE(NULLIF(provincia, ''), 'Sin provincia') AS label, COUNT(*) AS value
        FROM clientes GROUP BY label ORDER BY value DESC
    `).all();
    const byChannel = database.prepare(`
        SELECT COALESCE(NULLIF(canal, ''), 'Sin canal') AS label, COUNT(*) AS value
        FROM mensajes GROUP BY label ORDER BY value DESC
    `).all();
    const quotationsValue = database.prepare(`
        SELECT COALESCE(SUM(CAST(importe AS REAL)), 0) AS total,
               COALESCE(AVG(CAST(importe AS REAL)), 0) AS average
        FROM cotizaciones
    `).get();
    return {
        clientes: {
            total: database.prepare('SELECT COUNT(*) AS value FROM clientes').get().value,
            byProvince
        },
        cotizaciones: {
            total: database.prepare('SELECT COUNT(*) AS value FROM cotizaciones').get().value,
            totalValue: quotationsValue.total,
            averageValue: quotationsValue.average,
            byStatus: status('cotizaciones')
        },
        transportes: {
            total: database.prepare('SELECT COUNT(*) AS value FROM transportes').get().value,
            byStatus: status('transportes')
        },
        contenedores: {
            total: database.prepare('SELECT COUNT(*) AS value FROM contenedores').get().value,
            byStatus: status('contenedores')
        },
        mensajes: {
            total: database.prepare('SELECT COUNT(*) AS value FROM mensajes').get().value,
            byChannel
        }
    };
}

function assertTable(table) {
    const definition = definitions[table] || adminDefinitions[table];
    if (!definition) {
        const error = new Error(`Recurso no soportado: ${table}`);
        error.statusCode = 404;
        throw error;
    }
    return definition;
}

module.exports = {
    authenticate, create, dashboardData, list, remove, reportData, revokeSession,
    sessionUser, setRolePermissions, update, updateStatus, workflowStatuses
};
