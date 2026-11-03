<img width="3250" height="2268" alt="image" src="https://github.com/user-attachments/assets/353c8ad0-ef97-43d0-a561-bd53115c38e8" />
## MiTransporte IA

### Persistencia SQLite

La aplicación guarda Clientes, Cotizaciones, Transportes, Contenedores y
Mensajes en `backend/mitransporte.sqlite`. La base de datos se crea
automáticamente al iniciar el servidor y se inicializa con los registros
demostrativos existentes cuando las tablas están vacías.

```bash
node backend/server.js
```

La API devuelve los registros con `GET` y crea registros con `POST` en:

- `/clientes`
- `/cotizaciones`
- `/transportes`
- `/contenedores`
- `/mensajes`

Las pantallas utilizan estos endpoints directamente; ya no dependen de
`localStorage`.
