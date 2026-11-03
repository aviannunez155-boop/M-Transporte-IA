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

const server = http.createServer((req, res) => {

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

    const resourceMatch = req.url.match(/^\/(transportes|clientes|contenedores|cotizaciones|mensajes)$/);
    if (resourceMatch) {
        const resource = resourceMatch[1];
        try {
            if (req.method === 'GET') {
                sendJson(res, 200, database.list(resource));
                return;
            }

            if (req.method === 'POST') {
                const payload = awaitRequestBody(req);
                payload
                    .then((body) => sendJson(res, 201, database.create(resource, body)))
                    .catch((error) => sendJson(res, error.message === 'JSON inválido' ? 400 : 500, {
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

    // DASHBOARD
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

    // 404
    res.writeHead(404, {
        'Content-Type': 'text/plain'
    });

    res.end('Ruta no encontrada');

});

server.listen(3000, () => {
    console.log('Servidor iniciado en puerto 3000');
});