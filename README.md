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

El sistema incluye los roles `Administrador`, `Operador`, `Comercial` y
`Consulta`. Las APIs y páginas validan los permisos del rol en cada solicitud:
los módulos distinguen permisos de lectura y gestión, mientras que
Administración requiere `administracion.manage`. El login crea sesiones
SQLite con cookies `HttpOnly`; el logout revoca la sesión y registra el evento
en auditoría. Los cambios de datos y las transiciones de estado guardan el
usuario responsable en `auditoria` e `historial_estados`.

### Facturación y seguimiento

El flujo operativo es `Cliente → Cotización → Aprobación → Transporte →
Contenedor → Factura → Servicio Finalizado`. Las facturas se almacenan en
SQLite relacionadas con cliente, transporte y contenedor. Sólo se puede
facturar un contenedor asociado a un transporte en proceso o finalizado. Cada
factura conserva número, fecha de emisión y fecha de pago, con los estados
`Pendiente`, `Pagada` y `Vencida`. Una factura
`Pagada` finaliza automáticamente el transporte y el contenedor, registrando
cada transición en `historial_estados` y `auditoria`.

Las pantallas `/facturas-app` y `/seguimiento-app` permiten gestionar facturas
y consultar la trazabilidad completa de un transporte. La API
`GET /trazabilidad/transportes/:id` (o `/trazabilidad/contenedores/:id`)
devuelve cliente, cotización, transporte, contenedores, facturas e historial.

El acceso SaaS usa sesiones SQLite con cookies `HttpOnly`. El usuario inicial
es `admin@mitransporte.local`; en desarrollo su contraseña predeterminada es
`admin123` y puede cambiarse mediante la variable de entorno `ADMIN_PASSWORD`
antes de inicializar una base nueva. Los permisos se asignan con
`PUT /roles/:id/permisos`.

### Arquitectura SaaS multiempresa

SQLite incluye las entidades `empresas` y `sucursales`. Los usuarios tienen
`empresa_id` y cada sesión devuelve el contexto de empresa; los módulos
operativos, configuración, actividad, auditoría e historial se filtran por
ese contexto. Los endpoints `GET/POST /empresas` y `GET/POST /sucursales`
permiten administrar la estructura empresarial desde Administración.

La columna `empresa_id` está indexada en los módulos principales y las
relaciones de sucursal usan claves foráneas. El acceso a datos se concentra en
la capa de `database.js`, de modo que reemplazar `DatabaseSync` por un
adaptador PostgreSQL con consultas parametrizadas no requiere cambiar la API
HTTP ni la interfaz.

### API REST y CRUD

Los módulos `clientes`, `cotizaciones`, `transportes`, `contenedores`,
`mensajes`, `usuarios`, `roles` y `configuracion` exponen:

- `GET /modulo` para listar registros.
- `POST /modulo` para crear registros.
- `PUT` o `PATCH /modulo/:id` para actualizar registros.
- `DELETE /modulo/:id` para eliminar registros.

Las referencias de negocio se validan en el servidor: las cotizaciones
requieren un `cliente_id`, los transportes un `cotizacion_id` y los
contenedores un `transporte_id`. `GET /dashboard-data` devuelve, con filtros
opcionales `from` y `to`, KPIs de clientes, cotizaciones, transportes,
contenedores, mensajes y usuarios; rankings comerciales, estados operativos,
actividad mensual y facturación mensual/anual, todo calculado desde SQLite.
También incluye los últimos 10 eventos de actividad y alertas operativas. La
vista `/dashboard` permite los periodos Hoy, Esta semana, Este mes, Este año
y personalizado, con actualización automática cada 30 segundos. Las tablas
`actividad` y `auditoria` son inmutables desde la API para preservar la
trazabilidad. `GET /trazabilidad/transportes/:id` devuelve el flujo completo,
la línea temporal de estados y la auditoría de cliente, cotización,
transporte, contenedores y facturas relacionadas. También se puede consultar
la auditoría puntual con `GET /auditoria/:modulo/:id`.

### Facturación

El módulo `/facturas-app` gestiona facturas relacionadas con cliente,
cotización, transporte y contenedor. Cada factura conserva número, importe,
fecha de emisión, vencimiento, pago y observaciones. Sus estados son
`Pendiente`, `Pagada`, `Vencida` y `Cancelada`; el pago registra la fecha,
actualiza la trazabilidad y finaliza el servicio asociado. La API REST expone
`GET/POST /facturas`, `PUT/PATCH /facturas/:id` y
`PATCH /facturas/:id/estado`, con aislamiento por empresa y permisos
`facturas.read`/`facturas.manage`. El dashboard y los reportes incluyen total
facturado, total pendiente, facturas pendientes, pagadas, vencidas y
canceladas.

### Reportes empresariales

`GET /reports` devuelve métricas agregadas desde SQLite para clientes,
cotizaciones, transportes, contenedores y mensajes. Acepta `from`, `to` y
`status` para filtrar por fechas de creación y estado. La vista
`/reportes-app` presenta estos datos con gráficos de barras, tarjetas de
métricas y exportación de todos los reportes mediante
`GET /reports/export?format=csv|excel|pdf` con los mismos filtros.
