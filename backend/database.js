const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const database = new DatabaseSync(
    path.join(__dirname, 'mitransporte.sqlite')
);
database.exec('PRAGMA foreign_keys = ON');
const tenantTables = ['clientes', 'cotizaciones', 'transportes', 'contenedores', 'mensajes', 'facturas',
    'usuarios', 'configuracion', 'actividad', 'auditoria', 'historial_estados', 'sucursales'];
const saasTables = ['empresas', 'sucursales'];

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
    },
    facturas: {
        columns: [
            'cliente_id', 'cotizacion_id', 'transporte_id', 'contenedor_id', 'numero',
            'moneda', 'importe', 'estado', 'fecha_emision', 'fecha_vencimiento', 'fecha_pago',
            'observaciones'
        ],
        seed: []
    }
};

const adminDefinitions = {
    roles: {
        columns: ['nombre', 'descripcion'],
        seed: [
            { nombre: 'Administrador', descripcion: 'Acceso completo al sistema' },
            { nombre: 'Operador', descripcion: 'Gestiona la operación logística' },
            { nombre: 'Comercial', descripcion: 'Gestiona clientes y cotizaciones' },
            { nombre: 'Consulta', descripcion: 'Consulta dashboards y reportes' }
        ]
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
    CREATE TABLE IF NOT EXISTS empresas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        identificador TEXT NOT NULL UNIQUE,
        estado TEXT NOT NULL DEFAULT 'Activa',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sucursales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        direccion TEXT NOT NULL DEFAULT '',
        estado TEXT NOT NULL DEFAULT 'Activa',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
`);
for (const table of tenantTables) {
    const columns = database.prepare(`PRAGMA table_info("${table}")`).all();
    if (!columns.some((column) => column.name === 'empresa_id')) {
        database.exec(`ALTER TABLE "${table}" ADD COLUMN empresa_id INTEGER REFERENCES empresas(id)`);
    }
}
for (const table of ['clientes', 'cotizaciones', 'transportes', 'contenedores', 'mensajes', 'facturas']) {
    const columns = database.prepare(`PRAGMA table_info("${table}")`).all();
    if (!columns.some((column) => column.name === 'sucursal_id')) {
        database.exec(`ALTER TABLE "${table}" ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id)`);
    }
}
const configurationSql = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'configuracion'"
).get()?.sql || '';
if (configurationSql.includes('clave" TEXT UNIQUE') || configurationSql.includes('clave TEXT UNIQUE')) {
    database.exec(`
        CREATE TABLE configuracion_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clave TEXT NOT NULL,
            valor TEXT NOT NULL DEFAULT '',
            descripcion TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            empresa_id INTEGER REFERENCES empresas(id),
            UNIQUE (empresa_id, clave)
        );
        INSERT INTO configuracion_new (id, clave, valor, descripcion, created_at, empresa_id)
        SELECT id, clave, valor, descripcion, created_at, empresa_id FROM configuracion;
        DROP TABLE configuracion;
        ALTER TABLE configuracion_new RENAME TO configuracion;
    `);
}
const defaultCompany = database.prepare('SELECT id FROM empresas ORDER BY id LIMIT 1').get()
    || (() => {
        const result = database.prepare(
            'INSERT INTO empresas (nombre, identificador) VALUES (?, ?)'
        ).run('MiTransporte IA', 'mitransporte-default');
        return { id: Number(result.lastInsertRowid) };
    })();
database.prepare('UPDATE empresas SET identificador = ? WHERE id = ?')
    .run('mitransporte-default', defaultCompany.id);
for (const table of tenantTables) {
    database.prepare(`UPDATE "${table}" SET empresa_id = ? WHERE empresa_id IS NULL`)
        .run(defaultCompany.id);
}
database.exec(`
    CREATE INDEX IF NOT EXISTS idx_sucursales_empresa ON sucursales(empresa_id);
    CREATE INDEX IF NOT EXISTS idx_usuarios_empresa ON usuarios(empresa_id);
    CREATE INDEX IF NOT EXISTS idx_clientes_empresa ON clientes(empresa_id);
    CREATE INDEX IF NOT EXISTS idx_cotizaciones_empresa ON cotizaciones(empresa_id);
    CREATE INDEX IF NOT EXISTS idx_transportes_empresa ON transportes(empresa_id);
    CREATE INDEX IF NOT EXISTS idx_contenedores_empresa ON contenedores(empresa_id);
    CREATE INDEX IF NOT EXISTS idx_facturas_empresa ON facturas(empresa_id);
`);

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

const defaultRoles = [
    ['Administrador', 'Acceso completo al sistema'],
    ['Operador', 'Gestiona la operación logística'],
    ['Comercial', 'Gestiona clientes y cotizaciones'],
    ['Consulta', 'Consulta dashboards y reportes']
];
for (const [name, description] of defaultRoles) {
    let roles = database.prepare('SELECT id FROM roles WHERE nombre = ? ORDER BY id').all(name);
    if (!roles.length) {
        database.prepare('INSERT INTO roles (nombre, descripcion) VALUES (?, ?)').run(name, description);
        roles = database.prepare('SELECT id FROM roles WHERE nombre = ? ORDER BY id').all(name);
    }
    const canonicalId = roles[0].id;
    for (const duplicate of roles.slice(1)) {
        database.prepare(`
            INSERT OR IGNORE INTO rol_permisos (rol_id, permiso_id)
            SELECT ?, permiso_id FROM rol_permisos WHERE rol_id = ?
        `).run(canonicalId, duplicate.id);
        database.prepare('UPDATE usuarios SET rol_id = ? WHERE rol_id = ?').run(canonicalId, duplicate.id);
        database.prepare('DELETE FROM rol_permisos WHERE rol_id = ?').run(duplicate.id);
        database.prepare('DELETE FROM roles WHERE id = ?').run(duplicate.id);
    }
}
database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_nombre ON roles(nombre)');

const defaultPermissions = [
    ['dashboard.read', 'Ver el dashboard'],
    ['clientes.read', 'Consultar clientes'],
    ['clientes.manage', 'Gestionar clientes'],
    ['cotizaciones.read', 'Consultar cotizaciones'],
    ['cotizaciones.manage', 'Gestionar cotizaciones'],
    ['transportes.read', 'Consultar transportes'],
    ['transportes.manage', 'Gestionar transportes'],
    ['contenedores.read', 'Consultar contenedores'],
    ['contenedores.manage', 'Gestionar contenedores'],
    ['mensajes.read', 'Consultar mensajes'],
    ['mensajes.manage', 'Gestionar mensajes'],
    ['facturas.read', 'Consultar facturas'],
    ['facturas.manage', 'Gestionar facturas'],
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
const rolePermissions = {
    Operador: ['dashboard.read', 'clientes.read', 'clientes.manage', 'cotizaciones.read', 'transportes.read', 'transportes.manage', 'contenedores.read', 'contenedores.manage', 'mensajes.read', 'mensajes.manage', 'facturas.read', 'facturas.manage'],
    Comercial: ['dashboard.read', 'clientes.read', 'clientes.manage', 'cotizaciones.read', 'cotizaciones.manage', 'mensajes.read', 'mensajes.manage', 'reports.read'],
    Consulta: ['dashboard.read', 'clientes.read', 'cotizaciones.read', 'transportes.read', 'contenedores.read', 'mensajes.read', 'facturas.read', 'reports.read']
};
for (const [roleName, permissionKeys] of Object.entries(rolePermissions)) {
    const role = database.prepare('SELECT id FROM roles WHERE nombre = ?').get(roleName);
    if (!role) continue;
    const insertRolePermission = database.prepare(`
        INSERT OR IGNORE INTO rol_permisos (rol_id, permiso_id)
        SELECT ?, id FROM permisos WHERE clave = ?
    `);
    permissionKeys.forEach((key) => insertRolePermission.run(role.id, key));
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
addColumn('facturas', 'cotizacion_id', 'INTEGER REFERENCES cotizaciones(id) ON DELETE SET NULL');
addColumn('facturas', 'fecha_vencimiento', 'TEXT');
addColumn('facturas', 'moneda', 'TEXT');
database.prepare("UPDATE facturas SET moneda = 'USD' WHERE moneda IS NULL OR moneda = ''").run();
database.prepare("UPDATE facturas SET estado = 'Cancelada' WHERE lower(estado) IN ('anulada', 'cancelada')").run();
database.exec(`
    UPDATE facturas
    SET cotizacion_id = (
        SELECT cotizacion_id FROM transportes
        WHERE transportes.id = facturas.transporte_id
    )
    WHERE cotizacion_id IS NULL AND transporte_id IS NOT NULL
`);
addColumn('usuarios', 'password_hash', 'TEXT');
database.exec(`
    CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente_id ON cotizaciones(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_transportes_cliente_id ON transportes(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_transportes_cotizacion_id ON transportes(cotizacion_id);
    CREATE INDEX IF NOT EXISTS idx_contenedores_cliente_id ON contenedores(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_contenedores_transporte_id ON contenedores(transporte_id);
    CREATE INDEX IF NOT EXISTS idx_facturas_cliente_id ON facturas(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_facturas_cotizacion_id ON facturas(cotizacion_id);
    CREATE INDEX IF NOT EXISTS idx_facturas_transporte_id ON facturas(transporte_id);
    CREATE INDEX IF NOT EXISTS idx_facturas_contenedor_id ON facturas(contenedor_id);
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

function tenantClause(empresaId, alias = '') {
    return empresaId ? {
        sql: `${alias ? `${alias}.` : ''}empresa_id = ?`,
        params: [Number(empresaId)]
    } : { sql: '', params: [] };
}

function assertTenantRecord(table, id, empresaId) {
    if (!empresaId || !tenantTables.includes(table)) return;
    const record = database.prepare(`SELECT id FROM "${table}" WHERE id = ? AND empresa_id = ?`)
        .get(Number(id), Number(empresaId));
    if (!record) throw notFoundError();
}

function list(table, empresaId = null) {
    if (table === 'empresas') {
        return database.prepare('SELECT * FROM empresas ORDER BY id DESC').all();
    }
    if (table === 'sucursales') {
        const scope = tenantClause(empresaId, 'sucursales');
        return database.prepare(`
            SELECT sucursales.*, empresas.nombre AS empresa
            FROM sucursales JOIN empresas ON empresas.id = sucursales.empresa_id
            ${scope.sql ? `WHERE ${scope.sql}` : ''}
            ORDER BY sucursales.id DESC
        `).all(...scope.params);
    }
    const scope = tenantClause(empresaId, table);
    if (table === 'historial_estados') {
        return database.prepare(`
            SELECT historial_estados.*, usuarios.nombre AS usuario
            FROM historial_estados
            LEFT JOIN usuarios ON usuarios.id = historial_estados.usuario_id
            ${scope.sql ? `WHERE ${scope.sql}` : ''}
            ORDER BY historial_estados.id DESC
        `).all(...scope.params);
    }
    if (table === 'actividad' || table === 'auditoria') {
        return database.prepare(`
            SELECT "${table}".*, usuarios.nombre AS usuario
            FROM "${table}"
            LEFT JOIN usuarios ON usuarios.id = "${table}".usuario_id
            ${scope.sql ? `WHERE ${scope.sql}` : ''}
            ORDER BY "${table}".id DESC
        `).all(...scope.params);
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
                ${scope.sql ? `WHERE ${scope.sql}` : ''}
                ORDER BY usuarios.id DESC
            `).all(...scope.params);
        }
        return database.prepare(`SELECT * FROM "${table}" ${scope.sql ? `WHERE ${scope.sql}` : ''} ORDER BY id DESC`)
            .all(...scope.params);
    }
    assertTable(table);
    if (table === 'cotizaciones') {
        return database.prepare(`
            SELECT cotizaciones.*, clientes.nombre AS cliente_nombre
            FROM cotizaciones
            LEFT JOIN clientes ON clientes.id = cotizaciones.cliente_id
            ${scope.sql ? `WHERE ${scope.sql}` : ''}
            ORDER BY cotizaciones.id DESC
        `).all(...scope.params).map((row) => ({
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
            ${scope.sql ? `WHERE ${scope.sql}` : ''}
            ORDER BY transportes.id DESC
        `).all(...scope.params).map((row) => ({
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
            ${scope.sql ? `WHERE ${scope.sql}` : ''}
            ORDER BY contenedores.id DESC
        `).all(...scope.params).map((row) => ({
            ...row,
            cliente: row.cliente_nombre || row.cliente
        }));
    }
    if (table === 'facturas') {
        return database.prepare(`
            SELECT facturas.*, clientes.nombre AS cliente,
                   transportes.origen, transportes.destino,
                   contenedores.numero AS contenedor_numero
            FROM facturas
            JOIN clientes ON clientes.id = facturas.cliente_id
            LEFT JOIN transportes ON transportes.id = facturas.transporte_id
            LEFT JOIN contenedores ON contenedores.id = facturas.contenedor_id
            ${scope.sql ? `WHERE ${scope.sql}` : ''}
            ORDER BY facturas.id DESC
        `).all(...scope.params);
    }
    return database.prepare(`SELECT * FROM "${table}" ${scope.sql ? `WHERE ${scope.sql}` : ''} ORDER BY id DESC`)
        .all(...scope.params);
}

function create(table, payload, usuarioId = 1, empresaId = defaultCompany.id) {
    if (table === 'empresas') {
        const name = String(payload.nombre || '').trim();
        const identifier = String(payload.identificador || '').trim();
        if (!name || !identifier) throw validationError('Empresa requiere nombre e identificador');
        const result = database.prepare(
            'INSERT INTO empresas (nombre, identificador, estado) VALUES (?, ?, ?)'
        ).run(name, identifier, payload.estado || 'Activa');
        recordAudit('Empresas', 'Crear', result.lastInsertRowid, `Empresa: ${name}`, usuarioId, empresaId);
        return database.prepare('SELECT * FROM empresas WHERE id = ?').get(Number(result.lastInsertRowid));
    }
    if (table === 'sucursales') {
        const name = String(payload.nombre || '').trim();
        if (!name) throw validationError('Sucursal requiere nombre');
        const targetCompany = Number(payload.empresa_id || empresaId);
        if (targetCompany !== Number(empresaId)) throw validationError('No puede crear sucursales de otra empresa');
        assertReference('empresas', targetCompany, 'empresa');
        const result = database.prepare(
            'INSERT INTO sucursales (empresa_id, nombre, direccion, estado) VALUES (?, ?, ?, ?)'
        ).run(targetCompany, name, payload.direccion || '', payload.estado || 'Activa');
        recordAudit('Sucursales', 'Crear', result.lastInsertRowid, `Sucursal: ${name}`, usuarioId, empresaId);
        return database.prepare('SELECT * FROM sucursales WHERE id = ?').get(Number(result.lastInsertRowid));
    }
    if (adminDefinitions[table]) {
        if (table === 'actividad' || table === 'auditoria') {
            throw validationError('Los registros de actividad y auditoría son de solo lectura');
        }
        return createAdminRecord(table, payload, usuarioId, empresaId);
    }
    assertTable(table);
    if (table === 'cotizaciones') {
        return createQuotation(payload, usuarioId, empresaId);
    }

    if (table === 'transportes') {
        return createTransport(payload, usuarioId, empresaId);
    }
    if (table === 'contenedores') {
        return createContainer(payload, usuarioId, empresaId);
    }
    if (table === 'facturas') {
        return createInvoice(payload, usuarioId, empresaId);
    }
    const definition = definitions[table];
    const normalizedPayload = payload.estado !== undefined && table !== 'facturas'
        ? { ...payload, estado: normalizeStatus(payload.estado) }
        : payload;
    const insertColumns = [...definition.columns, 'empresa_id'];
    const values = [...definition.columns.map((column) => normalizedPayload[column] ?? ''), empresaId];
    const columnsSql = insertColumns.map((column) => `"${column}"`).join(', ');
    const valuesSql = insertColumns.map(() => '?').join(', ');
    const result = database.prepare(
        `INSERT INTO "${table}" (${columnsSql}) VALUES (${valuesSql})`
    ).run(...values);

    const record = database
        .prepare(`SELECT * FROM "${table}" WHERE id = ?`)
        .get(Number(result.lastInsertRowid));
    recordAudit(table, 'Crear', record.id, `${table} #${record.id}`, usuarioId);
    return record;
}

function createAdminRecord(table, payload, usuarioId = 1, empresaId = defaultCompany.id) {
    const definition = adminDefinitions[table];
    const actorRole = database.prepare(`
        SELECT roles.nombre AS rol
        FROM usuarios JOIN roles ON roles.id = usuarios.rol_id
        WHERE usuarios.id = ?
    `).get(Number(usuarioId))?.rol;
    const targetEmpresaId = Number(payload.empresa_id || empresaId);
    if (targetEmpresaId !== Number(empresaId) && actorRole !== 'Administrador') {
        throw validationError('Sólo un Administrador puede operar sobre otra empresa');
    }
    if (table === 'usuarios') {
        const role = database.prepare('SELECT id FROM roles WHERE id = ?').get(Number(payload.rol_id));
        if (!role) throw validationError('Debe seleccionar un rol válido');
        if (String(payload.password || '').length < 8) {
            throw validationError('La contraseña debe tener al menos 8 caracteres');
        }
        const existingUser = database.prepare('SELECT id FROM usuarios WHERE lower(correo) = lower(?) AND empresa_id = ?')
            .get(String(payload.correo || '').trim(), targetEmpresaId);
        if (existingUser) throw validationError('Ya existe un usuario con ese correo');
    }
    if (table === 'configuracion') {
        const existing = database.prepare('SELECT id FROM configuracion WHERE clave = ? AND empresa_id = ?')
            .get(payload.clave, targetEmpresaId);
        if (existing) {
            database.prepare('UPDATE configuracion SET valor = ?, descripcion = ? WHERE id = ?')
                .run(payload.valor ?? '', payload.descripcion ?? '', existing.id);
            recordAudit('Administración', 'Actualizar', existing.id, `configuracion: ${payload.clave}`, usuarioId);
            return database.prepare('SELECT * FROM configuracion WHERE id = ?').get(existing.id);
        }
    }
    const insertPayload = table === 'usuarios'
        ? { ...payload, password_hash: hashPassword(payload.password || adminPassword), empresa_id: targetEmpresaId }
        : { ...payload, empresa_id: targetEmpresaId };
    const insertColumns = table === 'usuarios'
        ? [...definition.columns, 'password_hash', 'empresa_id']
        : [...definition.columns, 'empresa_id'];
    const result = insertRecord(table, insertColumns, insertPayload);
    const record = database.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(Number(result.lastInsertRowid));
    if (table !== 'actividad' && table !== 'auditoria') {
        recordAudit('Administración', 'Crear', record.id, `${table}: ${record.nombre || record.clave || record.correo || ''}`, usuarioId);
    }
    return table === 'usuarios' ? list('usuarios', targetEmpresaId).find((row) => row.id === record.id) : record;
}

function update(table, id, payload, usuarioId = 1, empresaId = defaultCompany.id) {
    if (saasTables.includes(table)) {
        const recordId = Number(id);
        if (table === 'sucursales') assertTenantRecord(table, recordId, empresaId);
        if (table === 'empresas' && Number(id) !== Number(empresaId)) {
            throw notFoundError();
        }
        const columns = table === 'empresas'
            ? ['nombre', 'identificador', 'estado']
            : ['nombre', 'direccion', 'estado'];
        const editable = columns.filter((column) => payload[column] !== undefined);
        if (!editable.length) throw validationError('No hay campos válidos para actualizar');
        database.prepare(`UPDATE ${table} SET ${editable.map((column) => `"${column}" = ?`).join(', ')} WHERE id = ?`)
            .run(...editable.map((column) => payload[column]), recordId);
        recordAudit(table, 'Actualizar', recordId, `Registro #${recordId}`, usuarioId, empresaId);
        return database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(recordId);
    }
    if (adminDefinitions[table]) {
        if (table === 'actividad' || table === 'auditoria') {
            throw validationError('Los registros de actividad y auditoría son de solo lectura');
        }
        return updateAdminRecord(table, id, payload, usuarioId, empresaId);
    }
    assertTable(table);
    const recordId = Number(id);
    assertTenantRecord(table, recordId, empresaId);
    const current = database.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(recordId);
    if (!current) throw notFoundError();

    if (table === 'facturas' && payload.estado !== undefined) {
        return updateInvoiceStatus(recordId, payload.estado, usuarioId, empresaId);
    }
    if (table === 'facturas') assertTenantRecord('facturas', recordId, empresaId);
    if (table === 'facturas') {
        if (payload.moneda !== undefined) {
            const currency = String(payload.moneda || '').trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(currency)) {
                throw validationError('La moneda debe ser un código ISO de tres letras');
            }
            payload = { ...payload, moneda: currency };
        }
        if (payload.importe !== undefined) {
            const amount = Number(payload.importe);
            if (!Number.isFinite(amount) || amount < 0) {
                throw validationError('El importe debe ser un número mayor o igual a cero');
            }
            payload = { ...payload, importe: amount };
        }
        if (payload.numero !== undefined) {
            const number = String(payload.numero || '').trim();
            if (!number) throw validationError('Debe indicar el número de factura');
            const duplicate = database.prepare(
                'SELECT id FROM facturas WHERE numero = ? AND id != ?'
            ).get(number, recordId);
            if (duplicate) throw validationError('Ya existe una factura con ese número');
            payload = { ...payload, numero: number };
        }
        if (payload.fecha_emision !== undefined) {
            payload = {
                ...payload,
                fecha_emision: validateInvoiceDate(payload.fecha_emision, 'La fecha de emisión', true)
            };
        }
        if (payload.fecha_pago !== undefined) {
            payload = {
                ...payload,
                fecha_pago: validateInvoiceDate(payload.fecha_pago, 'La fecha de pago')
            };
        }
        if (payload.fecha_vencimiento !== undefined) {
            payload = {
                ...payload,
                fecha_vencimiento: validateInvoiceDate(payload.fecha_vencimiento, 'La fecha de vencimiento')
            };
        }
    }

    if (table === 'cotizaciones' && payload.cliente_id !== undefined) {
        assertReference('clientes', payload.cliente_id, 'cliente');
        assertTenantRecord('clientes', payload.cliente_id, empresaId);
    }
    if (table === 'transportes' && payload.cotizacion_id !== undefined) {
        const quotation = database.prepare('SELECT cliente_id FROM cotizaciones WHERE id = ?')
            .get(Number(payload.cotizacion_id));
        if (!quotation) throw validationError('Debe seleccionar una cotización válida');
        assertTenantRecord('cotizaciones', payload.cotizacion_id, empresaId);
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
        if (payload.transporte_id !== '') assertTenantRecord('transportes', payload.transporte_id, empresaId);
        payload = transport
            ? { ...payload, cliente_id: transport.cliente_id }
            : payload;
    }
    if (table === 'contenedores' && payload.cliente_id !== undefined) {
        assertReference('clientes', payload.cliente_id, 'cliente');
        assertTenantRecord('clientes', payload.cliente_id, empresaId);
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
    const updated = list(table, empresaId).find((row) => row.id === recordId);
    if (payload.estado !== undefined && payload.estado !== current.estado) {
        recordStatusHistory(table, recordId, current.estado, payload.estado, usuarioId);
    }
    recordAudit(table, 'Actualizar', recordId, `Registro #${recordId}`, usuarioId);
    return updated;
}

function remove(table, id, usuarioId = 1, empresaId = defaultCompany.id) {
    if (saasTables.includes(table)) {
        if (table === 'sucursales') assertTenantRecord(table, id, empresaId);
        if (table === 'empresas' && Number(id) !== Number(empresaId)) throw notFoundError();
    }
    if (table === 'actividad' || table === 'auditoria') {
        throw validationError('Los registros de actividad y auditoría son de solo lectura');
    }
    if (adminDefinitions[table]) assertAdminTable(table);
    else if (!saasTables.includes(table)) assertTable(table);
    const recordId = Number(id);
    assertTenantRecord(table, recordId, empresaId);
    const result = database.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(recordId);
    if (!result.changes) throw notFoundError();
    recordAudit(table, 'Eliminar', recordId, `Registro #${recordId}`, usuarioId);
    return { id: recordId, deleted: true };
}

function updateAdminRecord(table, id, payload, usuarioId = 1, empresaId = defaultCompany.id) {
    assertAdminTable(table);
    const recordId = Number(id);
    assertTenantRecord(table, recordId, empresaId);
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
    recordAudit('Administración', 'Actualizar', recordId, `${table} #${recordId}`, usuarioId);
    return updated;
}

function editableColumns(table) {
    const relationColumns = {
        cotizaciones: ['cliente_id', 'telefono', 'origen', 'destino', 'servicio', 'importe', 'estado', 'observaciones'],
        transportes: ['cliente_id', 'cotizacion_id', 'origen', 'destino', 'tipo', 'estado'],
        contenedores: ['cliente_id', 'transporte_id', 'numero', 'tipo', 'puerto', 'estado'],
        facturas: ['numero', 'moneda', 'importe', 'estado', 'fecha_emision', 'fecha_vencimiento', 'fecha_pago', 'observaciones']
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

function recordAudit(modulo, accion, registroId, detalles, usuarioId = 1, empresaId = defaultCompany.id) {
    if (usuarioId) {
        const user = database.prepare('SELECT empresa_id FROM usuarios WHERE id = ?').get(Number(usuarioId));
        if (user?.empresa_id) empresaId = user.empresa_id;
    }
    insertRecord('auditoria', ['usuario_id', 'modulo', 'accion', 'registro_id', 'detalles'], {
        usuario_id: usuarioId, modulo, accion, registro_id: registroId, detalles, empresa_id: empresaId
    });
    insertRecord('actividad', ['usuario_id', 'modulo', 'accion', 'descripcion'], {
        usuario_id: usuarioId, modulo, accion, descripcion: detalles, empresa_id: empresaId
    });
}

function createQuotation(payload, usuarioId = 1, empresaId = defaultCompany.id) {
    assertTenantRecord('clientes', payload.cliente_id, empresaId);
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
    database.prepare('UPDATE cotizaciones SET empresa_id = ? WHERE id = ?').run(empresaId, Number(result.lastInsertRowid));
    const record = list('cotizaciones', empresaId).find((row) => row.id === Number(result.lastInsertRowid));
    recordStatusHistory('cotizaciones', record.id, null, record.estado, usuarioId);
    recordAudit('cotizaciones', 'Crear', record.id, `cotizaciones #${record.id}`, usuarioId);
    return record;
}

function createTransport(payload, usuarioId = 1, empresaId = defaultCompany.id) {
    assertTenantRecord('cotizaciones', payload.cotizacion_id, empresaId);
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
    database.prepare('UPDATE transportes SET empresa_id = ? WHERE id = ?').run(empresaId, Number(result.lastInsertRowid));
    const record = list('transportes', empresaId).find((row) => row.id === Number(result.lastInsertRowid));
    recordStatusHistory('transportes', record.id, null, record.estado, usuarioId);
    recordAudit('transportes', 'Crear', record.id, `transportes #${record.id}`, usuarioId);
    return record;
}

const workflowStatuses = ['Pendiente', 'Aprobado', 'En Proceso', 'Finalizado'];

function createContainer(payload, usuarioId = 1, empresaId = defaultCompany.id) {
    if (payload.transporte_id) assertTenantRecord('transportes', payload.transporte_id, empresaId);
    assertTenantRecord('clientes', payload.cliente_id, empresaId);
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
    database.prepare('UPDATE contenedores SET empresa_id = ? WHERE id = ?').run(empresaId, Number(result.lastInsertRowid));
    const record = list('contenedores', empresaId).find((row) => row.id === Number(result.lastInsertRowid));
    recordStatusHistory('contenedores', record.id, null, record.estado, usuarioId);
    recordAudit('contenedores', 'Crear', record.id, `contenedores #${record.id}`, usuarioId);
    return record;
}

const invoiceStatuses = ['Borrador', 'Pendiente', 'Pagada', 'Vencida', 'Cancelada'];

function normalizeInvoiceStatus(status) {
    const input = String(status || 'Pendiente').trim().toLowerCase();
    const value = invoiceStatuses.find((item) => item.toLowerCase() === input);
    if (!value) throw validationError(`Estado de factura inválido. Use: ${invoiceStatuses.join(', ')}`);
    return value;
}

function validateInvoiceDate(value, label, required = false) {
    const date = String(value || '').trim();
    if (!date && !required) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw validationError(`${label} inválida`);
    }
    return date;
}

function createInvoice(payload, usuarioId = 1, empresaId = defaultCompany.id) {
    if (!payload.contenedor_id) {
        throw validationError('Debe seleccionar un contenedor asociado a la factura');
    }
    assertTenantRecord('contenedores', payload.contenedor_id, empresaId);
    const container = database.prepare(`
        SELECT contenedores.id, contenedores.cliente_id, contenedores.transporte_id,
               transportes.estado AS transporte_estado,
               transportes.cotizacion_id,
               cotizaciones.importe AS cotizacion_importe
        FROM contenedores
        LEFT JOIN transportes ON transportes.id = contenedores.transporte_id
        LEFT JOIN cotizaciones ON cotizaciones.id = transportes.cotizacion_id
        WHERE contenedores.id = ?
    `).get(Number(payload.contenedor_id));
    if (!container || !container.transporte_id) {
        throw validationError('Debe seleccionar un contenedor asociado a un transporte');
    }
    if (!['En Proceso', 'Finalizado'].includes(container.transporte_estado)) {
        throw validationError('El transporte debe estar En Proceso antes de facturar');
    }
    const existing = database.prepare('SELECT id FROM facturas WHERE contenedor_id = ?').get(container.id);
    if (existing) throw validationError('El contenedor ya tiene una factura');
    const invoiceNumber = String(payload.numero || '').trim();
    if (!invoiceNumber) throw validationError('Debe indicar el número de factura');
    const duplicateNumber = database.prepare('SELECT id FROM facturas WHERE numero = ?').get(invoiceNumber);
    if (duplicateNumber) throw validationError('Ya existe una factura con ese número');
    const amount = Number(payload.importe ?? container.cotizacion_importe ?? 0);
    if (!Number.isFinite(amount) || amount < 0) {
        throw validationError('El importe debe ser un número mayor o igual a cero');
    }
    const currency = String(payload.moneda || 'USD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
        throw validationError('La moneda debe ser un código ISO de tres letras');
    }
    const invoice = {
        ...payload,
        cliente_id: container.cliente_id,
        cotizacion_id: container.cotizacion_id,
        transporte_id: container.transporte_id,
        numero: invoiceNumber,
        moneda: currency,
        importe: amount,
        estado: normalizeInvoiceStatus(payload.estado || 'Borrador'),
        fecha_emision: validateInvoiceDate(
            payload.fecha_emision || new Date().toISOString().slice(0, 10),
            'La fecha de emisión',
            true
        ),
        fecha_vencimiento: validateInvoiceDate(
            payload.fecha_vencimiento,
            'La fecha de vencimiento'
        )
    };
    if (invoice.fecha_vencimiento && invoice.fecha_vencimiento < invoice.fecha_emision) {
        throw validationError('La fecha de vencimiento no puede ser anterior a la fecha de emisión');
    }
    const columns = ['cliente_id', 'cotizacion_id', 'transporte_id', 'contenedor_id', 'numero', 'importe',
        'moneda', 'estado', 'fecha_emision', 'fecha_vencimiento', 'fecha_pago', 'observaciones'];
    const result = insertRecord('facturas', columns, invoice);
    database.prepare('UPDATE facturas SET empresa_id = ? WHERE id = ?').run(empresaId, Number(result.lastInsertRowid));
    const record = list('facturas', empresaId).find((row) => row.id === Number(result.lastInsertRowid));
    recordStatusHistory('facturas', record.id, null, record.estado, usuarioId);
    recordAudit('facturas', 'Crear', record.id, `Factura ${record.numero || `#${record.id}`}`, usuarioId);
    return record;
}

function updateInvoiceStatus(id, status, usuarioId = 1, empresaId = defaultCompany.id) {
    const next = normalizeInvoiceStatus(status);
    assertTenantRecord('facturas', id, empresaId);
    const current = database.prepare('SELECT * FROM facturas WHERE id = ?').get(Number(id));
    if (!current) throw notFoundError();
    if (current.estado === next) return list('facturas').find((row) => row.id === Number(id));
    const allowedTransitions = {
        Borrador: ['Pendiente', 'Cancelada'],
        Pendiente: ['Pagada', 'Vencida', 'Cancelada'],
        Vencida: ['Pagada', 'Cancelada'],
        Pagada: [],
        Cancelada: []
    };
    if (!allowedTransitions[current.estado]?.includes(next)) {
        throw validationError('Transición inválida. Una factura debe avanzar de Borrador a Pendiente, y luego a Pagada, Vencida o Cancelada');
    }
    const fechaPago = next === 'Pagada' ? new Date().toISOString().slice(0, 10) : current.fecha_pago;
    database.prepare('UPDATE facturas SET estado = ?, fecha_pago = ? WHERE id = ?')
        .run(next, fechaPago, Number(id));
    recordStatusHistory('facturas', Number(id), current.estado, next, usuarioId);
    recordAudit('facturas', 'Actualizar estado', Number(id), `Factura: ${next}`, usuarioId);
    if (next === 'Pagada') finalizeService(current, usuarioId);
    return list('facturas').find((row) => row.id === Number(id));
}

function finalizeService(invoice, usuarioId) {
    const transport = database.prepare('SELECT * FROM transportes WHERE id = ?').get(invoice.transporte_id);
    const container = database.prepare('SELECT * FROM contenedores WHERE id = ?').get(invoice.contenedor_id);
    if (transport && transport.estado !== 'Finalizado') {
        database.prepare("UPDATE transportes SET estado = 'Finalizado' WHERE id = ?").run(transport.id);
        recordStatusHistory('transportes', transport.id, transport.estado, 'Finalizado', usuarioId);
        recordAudit('transportes', 'Servicio finalizado', transport.id, `Factura #${invoice.id}`, usuarioId);
    }
    if (container && container.estado !== 'Finalizado') {
        database.prepare("UPDATE contenedores SET estado = 'Finalizado' WHERE id = ?").run(container.id);
        recordStatusHistory('contenedores', container.id, container.estado, 'Finalizado', usuarioId);
        recordAudit('contenedores', 'Servicio finalizado', container.id, `Factura #${invoice.id}`, usuarioId);
    }
}

function traceability(type, id, empresaId = null) {
    const resource = String(type || '').trim().toLowerCase();
    const recordId = Number(id);
    const supported = ['clientes', 'cotizaciones', 'transportes', 'contenedores', 'facturas'];
    if (!supported.includes(resource) || !Number.isInteger(recordId) || recordId <= 0) {
        throw notFoundError();
    }

    let transportId = null;
    if (resource === 'transportes') {
        assertTenantRecord('transportes', recordId, empresaId);
        transportId = recordId;
    } else if (resource === 'contenedores') {
        assertTenantRecord('contenedores', recordId, empresaId);
        transportId = database.prepare('SELECT transporte_id FROM contenedores WHERE id = ?').get(recordId)?.transporte_id;
    } else if (resource === 'facturas') {
        assertTenantRecord('facturas', recordId, empresaId);
        transportId = database.prepare('SELECT transporte_id FROM facturas WHERE id = ?').get(recordId)?.transporte_id;
    } else if (resource === 'cotizaciones') {
        assertTenantRecord('cotizaciones', recordId, empresaId);
        transportId = database.prepare(
            'SELECT id FROM transportes WHERE cotizacion_id = ? ORDER BY id DESC LIMIT 1'
        ).get(recordId)?.id;
    } else if (resource === 'clientes') {
        assertTenantRecord('clientes', recordId, empresaId);
        transportId = database.prepare(
            'SELECT id FROM transportes WHERE cliente_id = ? ORDER BY id DESC LIMIT 1'
        ).get(recordId)?.id;
    }

    if (!transportId) {
        return traceabilityWithoutTransport(resource, recordId, empresaId);
    }

    assertTenantRecord('transportes', transportId, empresaId);
    const transport = database.prepare(`
        SELECT transportes.*, clientes.nombre AS cliente,
               cotizaciones.id AS cotizacion_id, cotizaciones.estado AS cotizacion_estado
        FROM transportes
        JOIN clientes ON clientes.id = transportes.cliente_id
        LEFT JOIN cotizaciones ON cotizaciones.id = transportes.cotizacion_id
        WHERE transportes.id = ?
    `).get(transportId);
    if (!transport) throw notFoundError();
    const containerIds = database.prepare(
        'SELECT id FROM contenedores WHERE transporte_id = ?'
    ).all(transportId).map((item) => item.id);
    const invoiceIds = database.prepare(
        'SELECT id FROM facturas WHERE transporte_id = ?'
    ).all(transportId).map((item) => item.id);
    const quotationId = transport.cotizacion_id;
    const clientId = transport.cliente_id;
    const historyConditions = [
        `(modulo = 'clientes' AND registro_id = ?)`,
        `(modulo = 'cotizaciones' AND registro_id = ?)`,
        `(modulo = 'transportes' AND registro_id = ?)`,
        `(modulo = 'contenedores' AND registro_id IN (${containerIds.length ? containerIds.map(() => '?').join(',') : 'NULL'}))`,
        `(modulo = 'facturas' AND registro_id IN (${invoiceIds.length ? invoiceIds.map(() => '?').join(',') : 'NULL'}))`
    ];
    const relatedIds = [clientId, quotationId || 0, transportId, ...containerIds, ...invoiceIds];
    const auditRows = database.prepare(`
        SELECT auditoria.*, usuarios.nombre AS usuario
        FROM auditoria
        LEFT JOIN usuarios ON usuarios.id = auditoria.usuario_id
        WHERE auditoria.empresa_id = ?
          AND (${historyConditions.join(' OR ')})
        ORDER BY auditoria.created_at ASC, auditoria.id ASC
    `).all(Number(empresaId), ...relatedIds);
    const history = database.prepare(`
        SELECT historial_estados.*, usuarios.nombre AS usuario
        FROM historial_estados
        LEFT JOIN usuarios ON usuarios.id = historial_estados.usuario_id
        WHERE historial_estados.empresa_id = ?
          AND (modulo = 'transportes' AND registro_id = ?)
           OR (modulo = 'contenedores' AND registro_id IN
               (SELECT id FROM contenedores WHERE transporte_id = ?))
           OR (modulo = 'facturas' AND registro_id IN
               (SELECT id FROM facturas WHERE transporte_id = ?))
           OR (modulo = 'clientes' AND registro_id = ?)
           OR (modulo = 'cotizaciones' AND registro_id = ?)
        ORDER BY historial_estados.created_at ASC, historial_estados.id ASC
    `).all(Number(empresaId), transportId, transportId, transportId, clientId, quotationId || 0);
    const timeline = [
        ...history.map((event) => ({
            id: `estado-${event.id}`,
            tipo: 'estado',
            modulo: event.modulo,
            registro_id: event.registro_id,
            evento: event.estado_nuevo === 'Aprobado' && event.modulo === 'cotizaciones'
                ? 'Aprobación'
                : event.estado_nuevo === 'Pagada' && event.modulo === 'facturas'
                    ? 'Cobro'
                    : event.estado_nuevo === 'Finalizado'
                        ? 'Servicio Finalizado'
                        : event.estado_nuevo,
            estado_anterior: event.estado_anterior,
            estado_nuevo: event.estado_nuevo,
            usuario: event.usuario || 'Sistema',
            created_at: event.created_at
        })),
        ...auditRows.map((event) => ({
            id: `auditoria-${event.id}`,
            tipo: 'auditoria',
            modulo: event.modulo,
            registro_id: event.registro_id,
            evento: event.accion,
            detalles: event.detalles,
            usuario: event.usuario || 'Sistema',
            created_at: event.created_at
        }))
    ].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
    return {
        recurso_origen: resource,
        registro_origen: recordId,
        cliente: database.prepare('SELECT * FROM clientes WHERE id = ?').get(transport.cliente_id),
        cotizacion: transport.cotizacion_id
            ? database.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(transport.cotizacion_id) : null,
        transporte: transport,
        contenedores: database.prepare('SELECT * FROM contenedores WHERE transporte_id = ? ORDER BY id').all(transportId),
        facturas: database.prepare('SELECT * FROM facturas WHERE transporte_id = ? ORDER BY id').all(transportId),
        historial: history,
        auditoria: auditRows,
        timeline
    };
}

function traceabilityWithoutTransport(resource, recordId, empresaId) {
    let clientId = null;
    let quotationId = null;
    let containerId = null;
    let invoiceId = null;
    if (resource === 'clientes') clientId = recordId;
    if (resource === 'cotizaciones') {
        quotationId = recordId;
        clientId = database.prepare('SELECT cliente_id FROM cotizaciones WHERE id = ?').get(recordId)?.cliente_id;
    }
    if (resource === 'contenedores') {
        const container = database.prepare('SELECT * FROM contenedores WHERE id = ?').get(recordId);
        if (!container) throw notFoundError();
        containerId = recordId;
        clientId = container.cliente_id;
    }
    if (resource === 'facturas') {
        const invoice = database.prepare('SELECT * FROM facturas WHERE id = ?').get(recordId);
        if (!invoice) throw notFoundError();
        invoiceId = recordId;
        clientId = invoice.cliente_id;
        quotationId = invoice.cotizacion_id;
    }
    if (!clientId && !quotationId && !containerId && !invoiceId) throw notFoundError();
    const client = clientId
        ? database.prepare('SELECT * FROM clientes WHERE id = ?').get(clientId)
        : null;
    const quotation = quotationId
        ? database.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(quotationId)
        : null;
    const history = database.prepare(`
        SELECT historial_estados.*, usuarios.nombre AS usuario
        FROM historial_estados
        LEFT JOIN usuarios ON usuarios.id = historial_estados.usuario_id
        WHERE historial_estados.empresa_id = ?
          AND (modulo = 'clientes' AND registro_id = ?)
           OR (modulo = 'cotizaciones' AND registro_id = ?)
           OR (modulo = 'contenedores' AND registro_id = ?)
           OR (modulo = 'facturas' AND registro_id = ?)
        ORDER BY historial_estados.created_at ASC, historial_estados.id ASC
    `).all(Number(empresaId), clientId || 0, quotationId || 0, containerId || 0, invoiceId || 0);
    const auditRows = database.prepare(`
        SELECT auditoria.*, usuarios.nombre AS usuario
        FROM auditoria
        LEFT JOIN usuarios ON usuarios.id = auditoria.usuario_id
        WHERE auditoria.empresa_id = ?
          AND ((modulo = 'clientes' AND registro_id = ?)
            OR (modulo = 'cotizaciones' AND registro_id = ?)
            OR (modulo = 'contenedores' AND registro_id = ?)
            OR (modulo = 'facturas' AND registro_id = ?))
        ORDER BY auditoria.created_at ASC, auditoria.id ASC
    `).all(Number(empresaId), clientId || 0, quotationId || 0, containerId || 0, invoiceId || 0);
    const container = containerId
        ? database.prepare('SELECT * FROM contenedores WHERE id = ?').get(containerId)
        : null;
    const invoice = invoiceId
        ? database.prepare('SELECT * FROM facturas WHERE id = ?').get(invoiceId)
        : null;
    return {
        recurso_origen: resource,
        registro_origen: recordId,
        cliente: client,
        cotizacion: quotation,
        transporte: null,
        contenedores: container ? [container] : [],
        facturas: invoice ? [invoice] : [],
        historial: history,
        auditoria: auditRows,
        timeline: [
            ...history.map((event) => ({
                id: `estado-${event.id}`,
                tipo: 'estado',
                modulo: event.modulo,
                registro_id: event.registro_id,
                evento: event.estado_nuevo === 'Aprobado' ? 'Aprobación' : event.estado_nuevo,
                estado_anterior: event.estado_anterior,
                estado_nuevo: event.estado_nuevo,
                usuario: event.usuario || 'Sistema',
                created_at: event.created_at
            })),
            ...auditRows.map((event) => ({
                id: `auditoria-${event.id}`,
                tipo: 'auditoria',
                modulo: event.modulo,
                registro_id: event.registro_id,
                evento: event.accion,
                detalles: event.detalles,
                usuario: event.usuario || 'Sistema',
                created_at: event.created_at
            }))
        ].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
    };
}

function auditTrail(modulo, registroId, empresaId = null) {
    const table = String(modulo || '').trim().toLowerCase();
    if (!tenantTables.includes(table)) throw notFoundError();
    assertTenantRecord(table, registroId, empresaId);
    const scope = empresaId ? 'AND auditoria.empresa_id = ?' : '';
    const params = empresaId ? [table, Number(registroId), Number(empresaId)] : [table, Number(registroId)];
    return database.prepare(`
        SELECT auditoria.*, usuarios.nombre AS usuario
        FROM auditoria
        LEFT JOIN usuarios ON usuarios.id = auditoria.usuario_id
        WHERE lower(auditoria.modulo) = ? AND auditoria.registro_id = ? ${scope}
        ORDER BY auditoria.created_at ASC, auditoria.id ASC
    `).all(...params);
}

function updateStatus(table, id, status, usuarioId = 1, empresaId = defaultCompany.id) {
    if (table === 'facturas') return updateInvoiceStatus(id, status, usuarioId, empresaId);
    assertTable(table);
    assertTenantRecord(table, id, empresaId);
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
        recordStatusHistory(table, record.id, current.estado, normalized, usuarioId);
    }
    recordAudit(table, 'Actualizar estado', record.id, `Estado: ${normalized}`, usuarioId);
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

function recordStatusHistory(modulo, registroId, estadoAnterior, estadoNuevo, usuarioId = 1) {
    const user = database.prepare('SELECT empresa_id FROM usuarios WHERE id = ?').get(Number(usuarioId));
    database.prepare(`
        INSERT INTO historial_estados
            (modulo, registro_id, estado_anterior, estado_nuevo, usuario_id, empresa_id)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(modulo, registroId, estadoAnterior, estadoNuevo, usuarioId, user?.empresa_id || defaultCompany.id);
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
        SELECT usuarios.*, roles.nombre AS rol, empresas.nombre AS empresa,
               empresas.identificador AS empresa_identificador
        FROM usuarios LEFT JOIN roles ON roles.id = usuarios.rol_id
        JOIN empresas ON empresas.id = usuarios.empresa_id
        WHERE lower(usuarios.correo) = lower(?) AND usuarios.estado = 'Activo'
    `).get(String(email || '').trim());
    if (!user || !verifyPassword(password, user.password_hash)) return null;
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    database.prepare('INSERT INTO sesiones (usuario_id, token_hash, expires_at) VALUES (?, ?, ?)')
        .run(user.id, tokenHash, expires);
    recordAudit('Autenticación', 'Login', user.id, `Inicio de sesión: ${user.correo}`, user.id, user.empresa_id);
    const permissions = database.prepare(`
        SELECT permisos.clave
        FROM rol_permisos
        JOIN permisos ON permisos.id = rol_permisos.permiso_id
        WHERE rol_permisos.rol_id = ?
        ORDER BY permisos.clave
    `).all(user.rol_id).map((permission) => permission.clave);
    return {
        token,
        user: {
            id: user.id, nombre: user.nombre, correo: user.correo, rol: user.rol,
            empresa_id: user.empresa_id, empresa: user.empresa,
            empresa_identificador: user.empresa_identificador, permissions
        }
    };
}

function sessionUser(token) {
    if (!token) return null;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = database.prepare(`
        SELECT usuarios.id, usuarios.nombre, usuarios.correo, usuarios.empresa_id,
               empresas.nombre AS empresa, empresas.identificador AS empresa_identificador,
               roles.id AS rol_id, roles.nombre AS rol
        FROM sesiones
        JOIN usuarios ON usuarios.id = sesiones.usuario_id
        JOIN empresas ON empresas.id = usuarios.empresa_id
        LEFT JOIN roles ON roles.id = usuarios.rol_id
        WHERE sesiones.token_hash = ? AND sesiones.expires_at > ?
              AND usuarios.estado = 'Activo'
    `).get(tokenHash, new Date().toISOString());
    if (!session) return null;
    session.permissions = database.prepare(`
        SELECT permisos.clave
        FROM rol_permisos
        JOIN permisos ON permisos.id = rol_permisos.permiso_id
        WHERE rol_permisos.rol_id = ?
        ORDER BY permisos.clave
    `).all(session.rol_id).map((permission) => permission.clave);
    return session;
}

function revokeSession(token) {
    if (!token) return;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    database.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(tokenHash);
}

function setRolePermissions(roleId, permissionKeys, usuarioId = 1) {
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
    recordAudit('Administración', 'Actualizar permisos', Number(roleId), `Permisos asignados: ${keys.join(', ')}`, usuarioId);
    return list('rol_permisos').filter((item) => item.rol_id === Number(roleId));
}

function dashboardData(filters = {}, empresaId = null) {
    const { from, to } = reportFilters(filters);
    const reports = reportData(filters, empresaId);
    const dateCondition = (column = 'created_at') => {
        const clauses = [];
        const params = [];
        if (from) {
            clauses.push(`date(${column}) >= date(?)`);
            params.push(from);
        }
        if (to) {
            clauses.push(`date(${column}) <= date(?)`);
            params.push(to);
        }
        if (empresaId) {
            const tenantColumn = column.includes('.')
                ? `${column.split('.')[0]}.empresa_id`
                : 'empresa_id';
            clauses.push(`${tenantColumn} = ?`);
            params.push(Number(empresaId));
        }
        return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
    };
    const counts = {
        clientes: reports.clientes.total,
        cotizaciones: reports.cotizaciones.total,
        transportes: reports.transportes.total,
        contenedores: reports.contenedores.total,
        mensajes: reports.mensajes.total,
        facturas: reports.facturas.total,
        usuarios: database.prepare(`
            SELECT COUNT(*) AS count FROM usuarios
            ${dateCondition().sql}
        `).get(...dateCondition().params).count
    };
    const quoteDates = dateCondition('created_at');
    const transportDates = dateCondition('created_at');
    const activity = database.prepare(`
        SELECT * FROM (
            SELECT 'Clientes' AS module, 'Nuevo cliente registrado' AS action,
                   nombre AS subject, created_at
            FROM clientes ${dateCondition().sql}
            UNION ALL
            SELECT 'Cotizaciones', 'Nueva cotización registrada',
                   cliente, created_at
            FROM cotizaciones ${dateCondition().sql}
            UNION ALL
            SELECT 'Transportes', 'Nuevo transporte registrado',
                   cliente, created_at
            FROM transportes ${dateCondition().sql}
            UNION ALL
            SELECT 'Contenedores', 'Nuevo contenedor registrado',
                   COALESCE(numero, cliente), created_at
            FROM contenedores ${dateCondition().sql}
            UNION ALL
            SELECT 'Mensajes', 'Nuevo mensaje recibido',
                   cliente, created_at
            FROM mensajes ${dateCondition().sql}
            UNION ALL
            SELECT 'Facturas', 'Nueva factura registrada',
                   numero, created_at
            FROM facturas ${dateCondition().sql}
            UNION ALL
            SELECT 'Usuarios', 'Nuevo usuario registrado',
                   nombre, created_at
            FROM usuarios ${dateCondition().sql}
        )
        ORDER BY datetime(created_at) DESC
        LIMIT 10
    `).all(
        ...dateCondition().params, ...dateCondition().params,
        ...dateCondition().params, ...dateCondition().params,
        ...dateCondition().params, ...dateCondition().params,
        ...dateCondition().params
    );
    const recentRecords = database.prepare(`
        SELECT * FROM (
            SELECT 'Clientes' AS module, id, nombre AS subject, created_at FROM clientes ${dateCondition().sql}
            UNION ALL
            SELECT 'Cotizaciones', id, cliente, created_at FROM cotizaciones ${dateCondition().sql}
            UNION ALL
            SELECT 'Transportes', id, cliente, created_at FROM transportes ${dateCondition().sql}
            UNION ALL
            SELECT 'Contenedores', id, COALESCE(numero, cliente), created_at FROM contenedores ${dateCondition().sql}
            UNION ALL
            SELECT 'Mensajes', id, cliente, created_at FROM mensajes ${dateCondition().sql}
            UNION ALL
            SELECT 'Facturas', id, numero, created_at FROM facturas ${dateCondition().sql}
            UNION ALL
            SELECT 'Usuarios', id, nombre, created_at FROM usuarios ${dateCondition().sql}
        )
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 10
    `).all(
        ...dateCondition().params, ...dateCondition().params,
        ...dateCondition().params, ...dateCondition().params,
        ...dateCondition().params, ...dateCondition().params,
        ...dateCondition().params
    );
    const executive = database.prepare(`
        SELECT
            (SELECT COUNT(*) FROM cotizaciones ${quoteDates.sql ? `${quoteDates.sql} AND` : 'WHERE'} estado = 'Pendiente') AS pendingQuotes,
            (SELECT COUNT(*) FROM transportes ${transportDates.sql ? `${transportDates.sql} AND` : 'WHERE'} estado = 'En Proceso') AS transportsInProcess,
            (SELECT COUNT(*) FROM transportes ${transportDates.sql ? `${transportDates.sql} AND` : 'WHERE'} estado = 'Finalizado') AS finishedServices
    `).get(...quoteDates.params, ...transportDates.params, ...transportDates.params);
    const totalQuotations = reports.cotizaciones.total;
    const approvedQuotes = reports.cotizaciones.byStatus
        .filter((item) => ['Aprobada', 'Aprobado', 'Aceptada', 'Aceptado'].includes(item.label))
        .reduce((sum, item) => sum + item.value, 0);
    const countStatus = (items, labels) => items
        .filter((item) => labels.includes(item.label))
        .reduce((sum, item) => sum + Number(item.value || 0), 0);
    const kpis = {
        totalClients: counts.clientes,
        totalQuotes: counts.cotizaciones,
        pendingQuotes: countStatus(reports.cotizaciones.byStatus, ['Pendiente']),
        approvedQuotes,
        totalTransports: counts.transportes,
        transportsInProcess: countStatus(reports.transportes.byStatus, ['En Proceso']),
        transportsFinished: countStatus(reports.transportes.byStatus, ['Finalizado']),
        totalContainers: counts.contenedores,
        activeContainers: reports.contenedores.byStatus
            .filter((item) => !['Finalizado', 'Entregado'].includes(item.label))
            .reduce((sum, item) => sum + Number(item.value || 0), 0),
        totalMessages: counts.mensajes,
        totalUsers: counts.usuarios
    };
    const billingDates = dateCondition('fecha_emision');
    const billingByMonth = database.prepare(`
        SELECT strftime('%Y-%m', fecha_emision) AS label,
               COUNT(*) AS invoices,
               COALESCE(SUM(CAST(importe AS REAL)), 0) AS value
        FROM facturas
        ${billingDates.sql}
        GROUP BY label
        ORDER BY label
    `).all(...billingDates.params);
    const billingByYear = database.prepare(`
        SELECT strftime('%Y', fecha_emision) AS label,
               COUNT(*) AS invoices,
               COALESCE(SUM(CAST(importe AS REAL)), 0) AS value
        FROM facturas
        ${billingDates.sql}
        GROUP BY label
        ORDER BY label
    `).all(...billingDates.params);
    const clientDates = dateCondition('cotizaciones.created_at');
    const topClients = database.prepare(`
        SELECT clientes.id, clientes.nombre AS label,
               COUNT(cotizaciones.id) AS quotations,
               COALESCE(SUM(CAST(cotizaciones.importe AS REAL)), 0) AS quotedValue
        FROM clientes
        LEFT JOIN cotizaciones ON cotizaciones.cliente_id = clientes.id
            AND cotizaciones.empresa_id = clientes.empresa_id
        ${clientDates.sql}
        GROUP BY clientes.id, clientes.nombre
        HAVING quotations > 0
        ORDER BY quotedValue DESC, quotations DESC, clientes.nombre
        LIMIT 5
    `).all(...clientDates.params);
    const clientActivity = new Map(
        database.prepare(`
            SELECT clientes.id, clientes.nombre AS label, COUNT(cotizaciones.id) AS quotations
            FROM clientes LEFT JOIN cotizaciones
              ON cotizaciones.cliente_id = clientes.id
             AND cotizaciones.empresa_id = clientes.empresa_id
             ${clientDates.sql.replace(/^WHERE /, 'AND ')}
            ${tenantClause(empresaId, 'clientes').sql ? `WHERE ${tenantClause(empresaId, 'clientes').sql}` : ''}
            GROUP BY clientes.id, clientes.nombre
        `).all(...clientDates.params, ...tenantClause(empresaId, 'clientes').params)
            .map((item) => [item.id, { id: item.id, label: item.label, quotations: Number(item.quotations) }])
    );
    const transportActivityDates = dateCondition('created_at');
    database.prepare(`
        SELECT cliente_id, COUNT(*) AS transports
        FROM transportes ${transportActivityDates.sql}
        GROUP BY cliente_id
    `).all(...transportActivityDates.params).forEach((item) => {
        const client = clientActivity.get(item.cliente_id) || { id: item.cliente_id, label: `Cliente #${item.cliente_id}`, quotations: 0 };
        client.transports = Number(item.transports);
        clientActivity.set(item.cliente_id, client);
    });
    const messageActivityDates = dateCondition('created_at');
    database.prepare(`
        SELECT cliente, COUNT(*) AS messages
        FROM mensajes ${messageActivityDates.sql}
        GROUP BY cliente
    `).all(...messageActivityDates.params).forEach((item) => {
        const client = [...clientActivity.values()].find((candidate) => candidate.label === item.cliente);
        if (client) client.messages = Number(item.messages);
    });
    const commercialRankings = {
        topByQuotes: [...clientActivity.values()].sort((a, b) => b.quotations - a.quotations).slice(0, 5),
        topByTransports: [...clientActivity.values()].sort((a, b) => (b.transports || 0) - (a.transports || 0)).slice(0, 5),
        mostActive: [...clientActivity.values()]
            .map((item) => ({ ...item, activity: item.quotations + (item.transports || 0) + (item.messages || 0) }))
            .sort((a, b) => b.activity - a.activity).slice(0, 5)
    };
    const pendingServices = countStatus(reports.transportes.byStatus, ['Pendiente']);
    const inProgressServices = countStatus(reports.transportes.byStatus, ['En Proceso']);
    const finishedServices = countStatus(reports.transportes.byStatus, ['Finalizado']);
    const alerts = [];
    if (pendingServices) alerts.push({ level: 'warning', message: `${pendingServices} transporte(s) pendiente(s) de iniciar` });
    if (kpis.pendingQuotes) alerts.push({ level: 'info', message: `${kpis.pendingQuotes} cotización(es) esperan aprobación` });
    if (kpis.activeContainers > inProgressServices + finishedServices) {
        alerts.push({ level: 'warning', message: 'Hay contenedores activos sin servicio finalizado' });
    }

    return {
        filters: { from, to },
        counts,
        kpis,
        executive,
        commercial: {
            quotedValue: reports.cotizaciones.totalValue,
            averageQuote: reports.cotizaciones.averageValue,
            approvedQuotes,
            conversionRate: totalQuotations ? Math.round((approvedQuotes / totalQuotations) * 100) : 0,
            rankings: commercialRankings
        },
        operational: {
            transportsInProcess: executive.transportsInProcess,
            finishedServices: executive.finishedServices,
            containersByStatus: reports.contenedores.byStatus,
            monitoring: {
                pendingQuotes: countStatus(reports.cotizaciones.byStatus, ['Pendiente']),
                approvedQuotes,
                transportsInProcess: countStatus(reports.transportes.byStatus, ['En Proceso']),
                transportsFinished: countStatus(reports.transportes.byStatus, ['Finalizado']),
                activeContainers: reports.contenedores.byStatus
                    .filter((item) => !['Finalizado', 'Entregado'].includes(item.label))
                    .reduce((sum, item) => sum + Number(item.value || 0), 0),
                deliveredContainers: countStatus(reports.contenedores.byStatus, ['Finalizado', 'Entregado']),
                pendingInvoices: countStatus(reports.facturas.byStatus, ['Pendiente']),
                overdueInvoices: countStatus(reports.facturas.byStatus, ['Vencida']),
                paidInvoices: countStatus(reports.facturas.byStatus, ['Pagada']),
                pendingServices,
                inProgressServices,
                finishedServices,
                alerts
            },
            alerts
        },
        charts: {
            clientsByProvince: reports.clientes.byProvince,
            quotationsByStatus: reports.cotizaciones.byStatus,
            transportsByStatus: reports.transportes.byStatus,
            billingByMonth,
            billingByYear,
            topClients,
            activityByMonth: database.prepare(`
                SELECT strftime('%Y-%m', created_at) AS label, COUNT(*) AS value
                FROM actividad ${dateCondition().sql}
                GROUP BY label ORDER BY label
            `).all(...dateCondition().params)
        },
        financial: {
            billingByMonth,
            billingByYear,
            pendingInvoices: countStatus(reports.facturas.byStatus, ['Pendiente']),
            paidInvoices: countStatus(reports.facturas.byStatus, ['Pagada']),
            overdueInvoices: countStatus(reports.facturas.byStatus, ['Vencida']),
            totalInvoiced: reports.facturas.totalValue,
            totalPending: reports.facturas.pendingValue,
            paidValue: reports.facturas.paidValue,
            overdueValue: reports.facturas.overdueValue
        },
        activity,
        recentRecords,
        reports
    };
}

function reportFilters(filters = {}) {
    const from = String(filters.from || '').trim();
    const to = String(filters.to || '').trim();
    const status = String(filters.status || '').trim();
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw validationError('Fecha inicial inválida');
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw validationError('Fecha final inválida');
    if (from && to && from > to) throw validationError('La fecha inicial no puede ser posterior a la fecha final');
    const clauses = [];
    const params = [];
    if (from) {
        clauses.push('date(created_at) >= date(?)');
        params.push(from);
    }
    if (to) {
        clauses.push('date(created_at) <= date(?)');
        params.push(to);
    }
    return {
        from,
        to,
        status,
        where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
        params
    };
}

function reportData(filters = {}, empresaId = null) {
    const { status: statusFilter, where, params } = reportFilters(filters);
    const filtered = (table, extra = '') => {
        const conditions = [where ? where.replace(/\bcreated_at\b/g, `"${table}".created_at`) : '', extra].filter(Boolean);
        const sql = conditions.length ? `WHERE ${conditions.map((item) => item.replace(/^WHERE\s+/i, '')).join(' AND ')}` : '';
        const conditionsWithTenant = [...conditions];
        const values = [...params];
        if (extra && statusFilter) values.push(statusFilter);
        if (empresaId && tenantTables.includes(table)) {
            conditionsWithTenant.push(`"${table}".empresa_id = ?`);
            values.push(Number(empresaId));
        }
        const sqlWithTenant = conditionsWithTenant.length
            ? `WHERE ${conditionsWithTenant.map((item) => item.replace(/^WHERE\s+/i, '')).join(' AND ')}`
            : '';
        return { sql: sqlWithTenant, values };
    };
    const status = (table) => {
        const filter = filtered(table, statusFilter ? `"${table}".estado = ?` : '');
        return database.prepare(`
            SELECT COALESCE(NULLIF(estado, ''), 'Sin estado') AS label, COUNT(*) AS value
            FROM "${table}" ${filter.sql} GROUP BY label ORDER BY value DESC
        `).all(...filter.values);
    };
    const clientsFilter = filtered('clientes');
    const byProvince = database.prepare(`
        SELECT COALESCE(NULLIF(provincia, ''), 'Sin provincia') AS label, COUNT(*) AS value
        FROM clientes ${clientsFilter.sql} GROUP BY label ORDER BY value DESC
    `).all(...clientsFilter.values);
    const messagesFilter = filtered('mensajes', statusFilter ? 'mensajes.estado = ?' : '');
    const byChannel = database.prepare(`
        SELECT COALESCE(NULLIF(canal, ''), 'Sin canal') AS label, COUNT(*) AS value
        FROM mensajes ${messagesFilter.sql} GROUP BY label ORDER BY value DESC
    `).all(...messagesFilter.values);
    const quotationsFilter = filtered('cotizaciones', statusFilter ? 'cotizaciones.estado = ?' : '');
    const quotationsValue = database.prepare(`
        SELECT COALESCE(SUM(CAST(importe AS REAL)), 0) AS total,
               COALESCE(AVG(CAST(importe AS REAL)), 0) AS average
        FROM cotizaciones ${quotationsFilter.sql}
    `).get(...quotationsFilter.values);
    const invoicesFilter = filtered('facturas', statusFilter ? 'facturas.estado = ?' : '');
    const invoicesValue = database.prepare(`
        SELECT COALESCE(SUM(CASE WHEN estado IN ('Pendiente', 'Pagada', 'Vencida') THEN CAST(importe AS REAL) ELSE 0 END), 0) AS total,
               COALESCE(SUM(CASE WHEN estado IN ('Pendiente', 'Vencida') THEN CAST(importe AS REAL) ELSE 0 END), 0) AS pending
        FROM facturas ${invoicesFilter.sql}
    `).get(...invoicesFilter.values);
    const invoiceStatusValues = database.prepare(`
        SELECT
            COALESCE(SUM(CASE WHEN estado = 'Pagada' THEN CAST(importe AS REAL) ELSE 0 END), 0) AS paid,
            COALESCE(SUM(CASE WHEN estado = 'Vencida' THEN CAST(importe AS REAL) ELSE 0 END), 0) AS overdue
        FROM facturas ${invoicesFilter.sql}
    `).get(...invoicesFilter.values);
    const invoiceCurrencies = database.prepare(`
        SELECT COALESCE(NULLIF(moneda, ''), 'USD') AS label,
               COALESCE(SUM(CASE WHEN estado IN ('Pendiente', 'Pagada', 'Vencida') THEN CAST(importe AS REAL) ELSE 0 END), 0) AS total,
               COALESCE(SUM(CASE WHEN estado = 'Pendiente' OR estado = 'Vencida' THEN CAST(importe AS REAL) ELSE 0 END), 0) AS pending,
               COUNT(*) AS invoices
        FROM facturas ${invoicesFilter.sql}
        GROUP BY label ORDER BY total DESC
    `).all(...invoicesFilter.values);
    const total = (table) => {
        const filter = filtered(table, statusFilter && ['cotizaciones', 'transportes', 'contenedores', 'mensajes', 'facturas'].includes(table)
            ? `"${table}".estado = ?` : '');
        return database.prepare(`SELECT COUNT(*) AS value FROM "${table}" ${filter.sql}`).get(...filter.values).value;
    };
    return {
        clientes: {
            total: total('clientes'),
            byProvince
        },
        cotizaciones: {
            total: total('cotizaciones'),
            totalValue: quotationsValue.total,
            averageValue: quotationsValue.average,
            byStatus: status('cotizaciones')
        },
        transportes: {
            total: total('transportes'),
            byStatus: status('transportes')
        },
        contenedores: {
            total: total('contenedores'),
            byStatus: status('contenedores')
        },
        mensajes: {
            total: total('mensajes'),
            byChannel
        },
        facturas: {
            total: total('facturas'),
            totalValue: invoicesValue.total,
            pendingValue: invoicesValue.pending,
            paidValue: invoiceStatusValues.paid,
            overdueValue: invoiceStatusValues.overdue,
            byCurrency: invoiceCurrencies,
            byStatus: status('facturas')
        }
    };
}

function reportRows(filters = {}, empresaId = null) {
    const { status: statusFilter, where, params } = reportFilters(filters);
    const rows = (table, columns, statusColumn = false) => {
        const conditions = [where ? where.replace(/\bcreated_at\b/g, `"${table}".created_at`).replace(/^WHERE\s+/i, '') : ''];
        const values = [...params];
        if (empresaId && tenantTables.includes(table)) {
            conditions.push(`"${table}".empresa_id = ?`);
            values.push(Number(empresaId));
        }
        if (statusColumn && statusFilter) {
            conditions.push(`"${table}".estado = ?`);
            values.push(statusFilter);
        }
        const sql = conditions.filter(Boolean).length
            ? `WHERE ${conditions.filter(Boolean).join(' AND ')}`
            : '';
        return database.prepare(`SELECT ${columns} FROM "${table}" ${sql} ORDER BY created_at DESC, id DESC`)
            .all(...values);
    };
    return {
        Clientes: rows('clientes', 'id, nombre, telefono, correo, provincia, created_at'),
        Cotizaciones: rows('cotizaciones', 'id, cliente, cliente_id, origen, destino, servicio, importe, estado, created_at', true),
        Transportes: rows('transportes', 'id, cliente, cliente_id, cotizacion_id, origen, destino, tipo, estado, created_at', true),
        Contenedores: rows('contenedores', 'id, numero, cliente, cliente_id, transporte_id, tipo, puerto, estado, created_at', true),
        Mensajes: rows('mensajes', 'id, canal, cliente, mensaje, estado, created_at', true),
        Facturas: rows('facturas', 'id, numero, cliente_id, cotizacion_id, transporte_id, contenedor_id, moneda, importe, estado, fecha_emision, fecha_vencimiento, fecha_pago, created_at', true)
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
    authenticate, auditTrail, create, dashboardData, list, recordAudit, remove, reportData, reportRows,
    revokeSession, sessionUser, setRolePermissions, traceability, update, updateStatus,
    workflowStatuses
};
