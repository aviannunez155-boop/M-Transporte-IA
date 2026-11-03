const http = require('http');
const fs = require('fs');
const path = require('path');

const transportes = require('./routes/transportes');
const clientes = require('./routes/clientes');
const contenedores = require('./routes/contenedores');
const cotizaciones = require('./routes/cotizaciones');
const mensajes = require('./routes/mensajes');

const server = http.createServer((req, res) => {

    // RECURSOS COMPARTIDOS DE LA INTERFAZ
    if (req.url === '/sidebar.css' || req.url === '/sidebar.js') {
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

    // API TRANSPORTES
    if (req.url === '/transportes') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(transportes));
        return;
    }

    // API CLIENTES
    if (req.url === '/clientes') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(clientes));
        return;
    }

    // API CONTENEDORES
    if (req.url === '/contenedores') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(contenedores));
        return;
    }

    // API COTIZACIONES
    if (req.url === '/cotizaciones') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cotizaciones));
        return;
    }

    // API MENSAJES
    if (req.url === '/mensajes') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mensajes));
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