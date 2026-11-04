const http = require('http');
const fs = require('fs');
const path = require('path');

const database = require('./database');

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function reportQuery(url) {
    return {
        from: url.searchParams.get('from') || '',
        to: url.searchParams.get('to') || '',
        status: url.searchParams.get('status') || ''
    };
}

function csvEscape(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
}

function reportsCsv(rows) {
    const sections = [];
    for (const [module, records] of Object.entries(rows)) {
        sections.push([csvEscape('Reporte'), csvEscape(module)].join(','));
        const columns = records.length ? Object.keys(records[0]) : ['Sin registros'];
        sections.push(columns.map(csvEscape).join(','));
        records.forEach((record) => sections.push(columns.map((column) => csvEscape(record[column])).join(',')));
        sections.push('');
    }
    return `\uFEFF${sections.join('\r\n')}`;
}

function xmlEscape(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function reportsExcel(rows) {
    const sheets = Object.entries(rows).map(([module, records]) => {
        const columns = records.length ? Object.keys(records[0]) : ['Sin registros'];
        const header = columns.map((column) => `<Cell><Data ss:Type="String">${xmlEscape(column)}</Data></Cell>`).join('');
        const body = records.map((record) => `<Row>${columns.map((column) => {
            const value = record[column];
            const type = typeof value === 'number' ? 'Number' : 'String';
            return `<Cell><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`;
        }).join('')}</Row>`).join('');
        return `<Worksheet ss:Name="${xmlEscape(module.slice(0, 31))}"><Table><Row>${header}</Row>${body}</Table></Worksheet>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default"
 ss:Name="Normal"><Alignment ss:Vertical="Bottom"/></Style></Styles>${sheets}</Workbook>`;
}

function pdfEscape(value) {
    return String(value ?? '').replace(/[^\x20-\x7E]/g, '?').replace(/([\\()])/g, '\\$1');
}

function reportsPdf(rows) {
    const lines = ['MiTransporte IA - Reportes empresariales', `Generado: ${new Date().toISOString()}`];
    for (const [module, records] of Object.entries(rows)) {
        lines.push('', module);
        if (!records.length) {
            lines.push('Sin registros');
            continue;
        }
        records.forEach((record) => {
            const summary = Object.entries(record).map(([key, value]) => `${key}: ${value ?? ''}`).join(' | ');
            lines.push(summary.slice(0, 115));
        });
    }
    const content = ['BT', '/F1 9 Tf', '50 800 Td', ...lines.map((line, index) => `${index ? '0 -13 Td ' : ''}(${pdfEscape(line)}) Tj`), 'ET'].join('\n');
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets[index + 1] = Buffer.byteLength(pdf, 'latin1');
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, 'latin1');
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024) {
                reject(new Error('El cuerpo de la solicitud es demasiado grande'));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                reject(new Error('JSON inválido'));
            }
        });
        req.on('error', reject);
    });
}

function awaitRequestBody(req) {
    return readJsonBody(req);
}

function cookies(req) {
    return Object.fromEntries((req.headers.cookie || '').split(';')
        .map((part) => part.trim().split('='))
        .filter(([name, value]) => name && value)
        .map(([name, ...value]) => [name, decodeURIComponent(value.join('='))]));
}

function setSessionCookie(res, token) {
    res.setHeader('Set-Cookie', `session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function permissionForResource(resource, method = 'GET') {
    if (['empresas', 'sucursales', 'roles', 'usuarios', 'configuracion', 'actividad', 'auditoria', 'permisos', 'rol_permisos', 'historial_estados'].includes(resource)) {
        return 'administracion.manage';
    }
    return method === 'GET' ? `${resource}.read` : `${resource}.manage`;
}

function hasPermission(user, permission) {
    return user && (user.rol === 'Administrador' || user.permissions.includes(permission));
}

function denyAccess(res, statusCode, message) {
    sendJson(res, statusCode, { error: message });
    return false;
}

const server = http.createServer((req, res) => {

    if (req.method === 'POST' && req.url === '/api/login') {
        awaitRequestBody(req).then((body) => {
            const result = database.authenticate(body.email, body.password);
            if (!result) {
                sendJson(res, 401, { error: 'Correo o contraseña incorrectos' });
                return;
            }
            setSessionCookie(res, result.token);
            sendJson(res, 200, result.user);
        }).catch((error) => sendJson(res, 400, { error: error.message }));
        return;
    }

    if (req.method === 'POST' && req.url === '/api/logout') {
        const user = database.sessionUser(cookies(req).session);
        if (user) database.recordAudit?.('Autenticación', 'Logout', user.id, `Cierre de sesión: ${user.correo}`, user.id, user.empresa_id);
        database.revokeSession(cookies(req).session);
        clearSessionCookie(res);
        sendJson(res, 200, { success: true });
        return;
    }

    if (req.method === 'GET' && req.url === '/api/session') {
        const user = database.sessionUser(cookies(req).session);
        sendJson(res, user ? 200 : 401, user || { error: 'Sesión no válida' });
        return;
    }

    if (req.url === '/login' || req.url === '/sidebar.css' || req.url === '/sidebar.js'
        || req.url === '/api.js' || req.url.startsWith('/api/login')) {
        // Public authentication and shared assets.
    } else {
        const actor = database.sessionUser(cookies(req).session);
        if (!actor) {
            if (req.method === 'GET' && !req.url.startsWith('/api/')) {
                res.writeHead(302, { Location: '/login' });
                res.end();
            } else {
                denyAccess(res, 401, 'Debe iniciar sesión');
            }
            return;
        }
        req.actor = actor;
    }

    const pagePermissions = {
        '/': 'dashboard.read',
        '/dashboard': 'dashboard.read',
        '/transportes-app': 'transportes.read',
        '/clientes-app': 'clientes.read',
        '/contenedores-app': 'contenedores.read',
        '/cotizaciones-app': 'cotizaciones.read',
        '/mensajes-app': 'mensajes.read',
        '/facturas-app': 'facturas.read',
        '/seguimiento-app': 'transportes.read',
        '/reportes-app': 'reports.read',
        '/administracion-app': 'administracion.manage'
    };
    const pagePath = req.url.split('?')[0];
    if (pagePermissions[pagePath] && !hasPermission(req.actor, pagePermissions[pagePath])) {
        if (req.method === 'GET' && !req.url.startsWith('/api/')) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('No tiene permisos para acceder a este módulo');
        } else {
            denyAccess(res, 403, 'No tiene permisos para acceder a este módulo');
        }
        return;
    }

    const rolePermissionsMatch = req.url.match(/^\/roles\/(\d+)\/permisos$/);
    const auditTrailMatch = req.url.match(/^\/auditoria\/([a-z_]+)\/(\d+)$/);
    if (auditTrailMatch) {
        const resource = auditTrailMatch[1];
        if (!hasPermission(req.actor, `${resource}.read`)) {
            denyAccess(res, 403, 'No tiene permisos para consultar la auditoría');
            return;
        }
        if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'Método no permitido' });
            return;
        }
        try {
            sendJson(res, 200, database.auditTrail(resource, auditTrailMatch[2], req.actor.empresa_id));
        } catch (error) {
            sendJson(res, error.statusCode || 500, { error: error.message });
        }
        return;
    }
    const traceabilityMatch = req.url.match(/^\/trazabilidad\/(clientes|cotizaciones|transportes|contenedores|facturas)\/(\d+)$/);
    if (traceabilityMatch) {
        const tracePermission = traceabilityMatch[1] === 'facturas'
            ? 'facturas.read'
            : `${traceabilityMatch[1]}.read`;
        if (!hasPermission(req.actor, tracePermission)) {
            denyAccess(res, 403, 'No tiene permisos para consultar la trazabilidad');
            return;
        }
        if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'Método no permitido' });
            return;
        }
        try {
            sendJson(res, 200, database.traceability(traceabilityMatch[1], traceabilityMatch[2], req.actor.empresa_id));
        } catch (error) {
            sendJson(res, error.statusCode || 500, { error: error.message });
        }
        return;
    }
    if (rolePermissionsMatch) {
        if (!hasPermission(req.actor, 'administracion.manage')) {
            denyAccess(res, 403, 'No tiene permisos para administrar roles');
            return;
        }

        if (req.method !== 'PUT' && req.method !== 'PATCH') {
            sendJson(res, 405, { error: 'Método no permitido' });
            return;
        }
        awaitRequestBody(req)
            .then((body) => sendJson(res, 200, database.setRolePermissions(rolePermissionsMatch[1], body.permisos, req.actor.id)))
            .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message }));
        return;
    }

    // RECURSOS COMPARTIDOS DE LA INTERFAZ
    if (req.url === '/sidebar.css' || req.url === '/sidebar.js' || req.url === '/api.js') {
        const archivo = path.join(__dirname, '../frontend', req.url.slice(1));
        const contentType = req.url.endsWith('.css') ? 'text/css' : 'application/javascript';

        fs.readFile(archivo, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error cargando recurso de interfaz');
                return;
            }

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
        return;
    }

    const resourceMatch = req.url.match(/^\/(empresas|sucursales|transportes|clientes|contenedores|cotizaciones|mensajes|facturas|usuarios|roles|configuracion|actividad|auditoria|permisos|rol_permisos|historial_estados)$/);
    if (resourceMatch) {
        const resource = resourceMatch[1];
        if (!hasPermission(req.actor, permissionForResource(resource, req.method))) {
            denyAccess(res, 403, 'No tiene permisos para este módulo');
            return;
        }
        try {
            if (req.method === 'GET') {
                sendJson(res, 200, database.list(resource, req.actor.empresa_id));
                return;
            }

            if (req.method === 'POST') {
                if (resource === 'actividad' || resource === 'auditoria' || resource === 'historial_estados') {
                    sendJson(res, 405, { error: 'Recurso de solo lectura' });
                    return;
                }
                const payload = awaitRequestBody(req);
                payload
                    .then((body) => sendJson(res, 201, database.create(resource, body, req.actor.id, req.actor.empresa_id)))
                    .catch((error) => sendJson(res, error.statusCode || (error.message === 'JSON inválido' ? 400 : 500), {
                        error: error.message
                    }));
                return;
            }

            sendJson(res, 405, { error: 'Método no permitido' });
        } catch (error) {
            sendJson(res, error.statusCode || 500, { error: error.message });
        }
        return;
    }

    const crudMatch = req.url.match(/^\/(empresas|sucursales|transportes|clientes|contenedores|cotizaciones|mensajes|facturas|usuarios|roles|configuracion)\/(\d+)$/);
    if (crudMatch) {
        const resource = crudMatch[1];
        const id = crudMatch[2];
        if (!hasPermission(req.actor, permissionForResource(resource, req.method))) {
            denyAccess(res, 403, 'No tiene permisos para este módulo');
            return;
        }
        if (req.method === 'DELETE') {
            if (resource === 'actividad' || resource === 'auditoria') {
                sendJson(res, 405, { error: 'Recurso de solo lectura' });
                return;
            }
            try {
                sendJson(res, 200, database.remove(resource, id, req.actor.id, req.actor.empresa_id));
            } catch (error) {
                sendJson(res, error.statusCode || 500, { error: error.message });
            }
            return;
        }
        if (req.method === 'PUT' || req.method === 'PATCH') {
            if (resource === 'actividad' || resource === 'auditoria') {
                sendJson(res, 405, { error: 'Recurso de solo lectura' });
                return;
            }
            awaitRequestBody(req)
                .then((body) => sendJson(res, 200, database.update(resource, id, body, req.actor.id, req.actor.empresa_id)))
                .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message }));
            return;
        }
        sendJson(res, 405, { error: 'Método no permitido' });
        return;
    }

    const statusMatch = req.url.match(/^\/(transportes|contenedores|cotizaciones|mensajes|facturas)\/(\d+)\/estado$/);
    if (statusMatch) {
        if (!hasPermission(req.actor, `${statusMatch[1]}.manage`)) {
            denyAccess(res, 403, 'No tiene permisos para actualizar estados');
            return;
        }
        if (req.method !== 'PATCH') {
            sendJson(res, 405, { error: 'Método no permitido' });
            return;
        }
        awaitRequestBody(req)
            .then((body) => sendJson(res, 200, database.updateStatus(statusMatch[1], statusMatch[2], body.estado, req.actor.id, req.actor.empresa_id)))
            .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message }));
        return;
    }

    if (req.method === 'GET' && (req.url === '/dashboard-data' || req.url.startsWith('/dashboard-data?'))) {
        if (!hasPermission(req.actor, 'dashboard.read')) {
            denyAccess(res, 403, 'No tiene permisos para ver el dashboard');
            return;
        }
        try {
            const url = new URL(req.url, 'http://localhost');
            sendJson(res, 200, database.dashboardData(reportQuery(url), req.actor.empresa_id));
        } catch (error) {
            sendJson(res, error.statusCode || 500, { error: error.message });
        }
        return;
    }

    if (req.method === 'GET' && (req.url === '/reports' || req.url.startsWith('/reports?'))) {
        if (!hasPermission(req.actor, 'reports.read')) {
            denyAccess(res, 403, 'No tiene permisos para ver reportes');
            return;
        }
        try {
            const url = new URL(req.url, 'http://localhost');
            sendJson(res, 200, database.reportData(reportQuery(url), req.actor.empresa_id));
        } catch (error) {
            sendJson(res, error.statusCode || 500, { error: error.message });
        }
        return;
    }

    if (req.method === 'GET' && req.url.startsWith('/reports/export')) {
        if (!hasPermission(req.actor, 'reports.read')) {
            denyAccess(res, 403, 'No tiene permisos para exportar reportes');
            return;
        }
        try {
            const url = new URL(req.url, 'http://localhost');
            const format = url.searchParams.get('format') || 'csv';
            const rows = database.reportRows(reportQuery(url), req.actor.empresa_id);
            const exports = {
                csv: {
                    type: 'text/csv; charset=utf-8',
                    name: 'reportes-empresariales.csv',
                    body: reportsCsv(rows)
                },
                excel: {
                    type: 'application/vnd.ms-excel; charset=utf-8',
                    name: 'reportes-empresariales.xls',
                    body: reportsExcel(rows)
                },
                pdf: {
                    type: 'application/pdf',
                    name: 'reportes-empresariales.pdf',
                    body: reportsPdf(rows)
                }
            };
            const file = exports[format];
            if (!file) {
                sendJson(res, 400, { error: 'Formato de exportación no soportado' });
                return;
            }
            res.writeHead(200, {
                'Content-Type': file.type,
                'Content-Disposition': `attachment; filename="${file.name}"`
            });
            res.end(file.body);
        } catch (error) {
            sendJson(res, error.statusCode || 500, { error: error.message });
        }
        return;
    }

    // DASHBOARD
    if (req.url === '/login') {
        const archivo = path.join(__dirname, '../frontend/login.html');
        fs.readFile(archivo, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error cargando login');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    if (req.url === '/' || req.url === '/dashboard') {

        const archivo = path.join(
            __dirname,
            '../frontend/dashboard.html'
        );

        fs.readFile(archivo, (err, data) => {

            if (err) {
                res.writeHead(500);
                res.end('Error cargando dashboard');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html'
            });

            res.end(data);

        });

        return;
    }

    // TRANSPORTES APP
    if (req.url === '/transportes-app') {

        const archivo = path.join(
            __dirname,
            '../frontend/transportes.html'
        );

        fs.readFile(archivo, (err, data) => {

            if (err) {
                res.writeHead(500);
                res.end('Error cargando transportes');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html'
            });

            res.end(data);

        });

        return;
    }

    // CLIENTES APP
    if (req.url === '/clientes-app') {

        const archivo = path.join(
            __dirname,
            '../frontend/clientes.html'
        );

        fs.readFile(archivo, (err, data) => {

            if (err) {
                res.writeHead(500);
                res.end('Error cargando clientes');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html'
            });

            res.end(data);

        });

        return;
    }

    // CONTENEDORES APP
    if (req.url === '/contenedores-app') {

        const archivo = path.join(
            __dirname,
            '../frontend/contenedores.html'
        );

        fs.readFile(archivo, (err, data) => {

            if (err) {
                res.writeHead(500);
                res.end('Error cargando contenedores');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html'
            });

            res.end(data);

        });

        return;
    }

    // COTIZACIONES APP
    if (req.url === '/cotizaciones-app') {
        const archivo = path.join(
            __dirname,
            '../frontend/cotizaciones.html'
        );

        fs.readFile(archivo, (err, data) => {

            if (err) {
                res.writeHead(500);
                res.end('Error cargando cotizaciones');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html'
            });

            res.end(data);

        });

        return;
    }

    // MENSAJES APP
    if (req.url === '/mensajes-app') {

        const archivo = path.join(
            __dirname,
            '../frontend/mensajes.html'
        );

        fs.readFile(archivo, (err, data) => {

            if (err) {
                res.writeHead(500);
                res.end('Error cargando mensajes');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html'
            });

            res.end(data);

        });

        return;
    }

    // ADMINISTRACIÓN APP
    if (req.url === '/administracion-app') {
        const archivo = path.join(__dirname, '../frontend/administracion.html');
        fs.readFile(archivo, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error cargando administración');
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    if (req.url.split('?')[0] === '/facturas-app') {
        const archivo = path.join(__dirname, '../frontend/facturas.html');
        fs.readFile(archivo, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error cargando facturación');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    if (req.url.split('?')[0] === '/seguimiento-app') {
        const archivo = path.join(__dirname, '../frontend/seguimiento.html');
        fs.readFile(archivo, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error cargando seguimiento');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // REPORTES APP
    if (req.url === '/reportes-app') {
        const archivo = path.join(__dirname, '../frontend/reportes.html');
        fs.readFile(archivo, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error cargando reportes');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // 404
    res.writeHead(404, {
        'Content-Type': 'text/plain'
    });

    res.end('Ruta no encontrada');

});

server.listen(3000, () => {
    console.log('Servidor iniciado en puerto 3000');
});