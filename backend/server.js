const http = require('http');
const fs = require('fs');
const path = require('path');

const transportes = require('./routes/transportes');
const clientes = require('./routes/clientes');
const contenedores = require('./routes/contenedores');
const cotizaciones = require('./routes/cotizaciones');
const mensajes = require('./routes/mensajes');

const server = http.createServer((req, res) => {

    if (req.url === '/transportes') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(transportes));
        return;
    }

    if (req.url === '/clientes') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(clientes));
        return;
    }

    if (req.url === '/contenedores') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(contenedores));
        return;
    }

    if (req.url === '/cotizaciones') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cotizaciones));
        return;
    }

    if (req.url === '/mensajes') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mensajes));
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

    res.writeHead(404, {
        'Content-Type': 'text/plain'
    });

    res.end('Ruta no encontrada');

});

server.listen(3000, () => {
    console.log('Servidor iniciado en puerto 3000');
});