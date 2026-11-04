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

### Relaciones entre módulos

- Las cotizaciones nuevas guardan `cliente_id` y seleccionan el cliente desde
  la tabla `clientes`.
- Los transportes nuevos guardan `cotizacion_id` y heredan el cliente, origen y
  destino de la cotización seleccionada.
- `transportes.cliente_id` mantiene la referencia directa al cliente.
- Los contenedores nuevos requieren `cliente_id` y pueden asociarse a un
  transporte; si se selecciona uno, el cliente se hereda y la API valida que
  ambas referencias coincidan.
- Las columnas de texto antiguas se conservan para leer datos históricos, pero
  los registros nuevos no duplican el nombre del cliente.
- Los estados operativos disponibles son `Pendiente`, `Aprobado`, `En Proceso`
  y `Finalizado`. Se pueden actualizar con `PATCH
  /:modulo/:id/estado` enviando `{ "estado": "..." }`.
- El workflow se valida secuencialmente: una cotización comienza Pendiente y
  debe aprobarse antes de crear su transporte; el transporte debe avanzar a
  En Proceso antes de crear contenedores; el transporte debe finalizar antes
  de completar sus contenedores.
- Cada alta y transición de estado se guarda en `historial_estados`, disponible
  mediante `GET /historial_estados`, además de los registros de `actividad` y
  `auditoria`.

### Administración

La sección `/administracion-app` gestiona usuarios, roles, configuración,
registro de actividad y auditoría de cambios. Sus datos se guardan en las
tablas `usuarios`, `roles`, `configuracion`, `actividad` y `auditoria`.
Las APIs disponibles son `GET/POST /usuarios`, `/roles`, `/configuracion`,
`/actividad` y `/auditoria`. Las altas y actualizaciones de Administración
generan automáticamente registros de actividad y auditoría.

El acceso SaaS usa sesiones SQLite con cookies `HttpOnly`. El usuario inicial
es `admin@mitransporte.local`; en desarrollo su contraseña predeterminada es
`admin123` y puede cambiarse mediante la variable de entorno `ADMIN_PASSWORD`
antes de inicializar una base nueva. Los permisos se asignan con
`PUT /roles/:id/permisos`.

### API REST y CRUD

Los módulos `clientes`, `cotizaciones`, `transportes`, `contenedores`,
`mensajes`, `usuarios`, `roles` y `configuracion` exponen:

- `GET /modulo` para listar registros.
- `POST /modulo` para crear registros.
- `PUT` o `PATCH /modulo/:id` para actualizar registros.
- `DELETE /modulo/:id` para eliminar registros.

Las referencias de negocio se validan en el servidor: las cotizaciones
requieren un `cliente_id`, los transportes un `cotizacion_id` y los
contenedores un `transporte_id`. `GET /dashboard-data` devuelve indicadores
calculados desde SQLite y los últimos 10 eventos de actividad. Las tablas
`actividad` y `auditoria` son inmutables desde la API para preservar la
trazabilidad.

### Reportes empresariales

`GET /reports` devuelve métricas agregadas desde SQLite para clientes,
cotizaciones, transportes, contenedores y mensajes. Incluye distribución por
provincia, estado y canal, además del valor total y promedio de cotizaciones.
La vista `/reportes-app` presenta estos datos con gráficos de barras y tarjetas
de métricas. El dashboard consume el mismo resumen para mostrar volumen por
módulo y estados operativos sin valores fijos.
