const http = require('http');
const fs = require('fs');
const path = require('path');

const database = require('./database');

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
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

    const rolePermissionsMatch = req.url.match(/^\/roles\/(\d+)\/permisos$/);
    if (rolePermissionsMatch) {
        if (req.method !== 'PUT' && req.method !== 'PATCH') {
            sendJson(res, 405, { error: 'Método no permitido' });
            return;
        }
        awaitRequestBody(req)
            .then((body) => sendJson(res, 200, database.setRolePermissions(rolePermissionsMatch[1], body.permisos)))
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

    const resourceMatch = req.url.match(/^\/(transportes|clientes|contenedores|cotizaciones|mensajes|usuarios|roles|configuracion|actividad|auditoria|permisos|rol_permisos|historial_estados)$/);
    if (resourceMatch) {
        const resource = resourceMatch[1];
        try {
            if (req.method === 'GET') {
                sendJson(res, 200, database.list(resource));
                return;
            }

            if (req.method === 'POST') {
                if (resource === 'actividad' || resource === 'auditoria' || resource === 'historial_estados') {
                    sendJson(res, 405, { error: 'Recurso de solo lectura' });
                    return;
                }
                const payload = awaitRequestBody(req);
                payload
                    .then((body) => sendJson(res, 201, database.create(resource, body)))
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

    const crudMatch = req.url.match(/^\/(transportes|clientes|contenedores|cotizaciones|mensajes|usuarios|roles|configuracion)\/(\d+)$/);
    if (crudMatch) {
        const resource = crudMatch[1];
        const id = crudMatch[2];
        if (req.method === 'DELETE') {
            if (resource === 'actividad' || resource === 'auditoria') {
                sendJson(res, 405, { error: 'Recurso de solo lectura' });
                return;
            }
            try {
                sendJson(res, 200, database.remove(resource, id));
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
                .then((body) => sendJson(res, 200, database.update(resource, id, body)))
                .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message }));
            return;
        }
        sendJson(res, 405, { error: 'Método no permitido' });
        return;
    }

    const statusMatch = req.url.match(/^\/(transportes|contenedores|cotizaciones|mensajes)\/(\d+)\/estado$/);
    if (statusMatch) {
        if (req.method !== 'PATCH') {
            sendJson(res, 405, { error: 'Método no permitido' });
            return;
        }
        awaitRequestBody(req)
            .then((body) => sendJson(res, 200, database.updateStatus(statusMatch[1], statusMatch[2], body.estado)))
            .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message }));
        return;
    }

    if (req.method === 'GET' && req.url === '/dashboard-data') {
        try {
            sendJson(res, 200, database.dashboardData());
        } catch (error) {
            sendJson(res, 500, { error: error.message });
        }
        return;
    }

    if (req.method === 'GET' && req.url === '/reports') {
        try {
            sendJson(res, 200, database.reportData());
        } catch (error) {
            sendJson(res, 500, { error: error.message });
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