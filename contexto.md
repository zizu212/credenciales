# Proyecto: Sistema de Credenciales

## Descripción
"Credenciales" es una aplicación de escritorio desarrollada con **Electron**, **Bootstrap 5** y **MySQL local**. Su propósito principal es la gestión de credenciales para estudiantes (alumnos) y empleados, permitiendo su registro, actualización, eliminación y exportación.

## Tecnologías Principales (Tech Stack)
*   **Frontend**: HTML5, CSS3, JavaScript (Vanilla), Bootstrap 5 (UI).
*   **Backend / Escritorio**: Electron.js (Node.js).
*   **Base de Datos**: MySQL (manejado vía módulo `mysql` de Node).
*   **Manejo de Archivos**: `fs`, `adm-zip` (para compresión ZIP), `xlsx` (para exportación de datos a Excel).

## Arquitectura y Flujo
La aplicación sigue la arquitectura clásica de Electron con un proceso principal (`main.js`) y varios procesos de renderizado (`renderer_*.js`).
*   **Main Process**: Maneja el ciclo de vida de la aplicación, ventanas (BrowserWindow), diálogos, ipcMain (comunicación interprocesos) y la lógica de exportaciones y ruteo, delegando las interacciones de BD a `backend.js`.
*   **Renderer Process**: Son los archivos HTML y sus correspondientes scripts `renderer_*.js` que consumen la API local expuesta mediante `preload.js` usando `ipcRenderer`.
*   **Backend (Capa de Datos)**: `backend.js` contiene todas las consultas SQL (CRUD) y la lógica de conexión, configuración inicial y auditoría en la base de datos MySQL local.

## Estructura de Archivos Clave
*   **`main.js`**: Punto de entrada de la aplicación Electron. Define los manejadores IPC (canales) para vistas y lógica de negocio.
*   **`backend.js`**: Controlador principal de la base de datos MySQL. Se encarga de la configuración, inicialización y todas las consultas SQL a tablas como `alumnos`, `empleados`, `usuarios`, `planteles`, `carreras`, etc.
*   **`preload.js`**: Puente seguro (Context Isolation) entre el Main Process y los Renderer Processes.
*   **`package.json`**: Define metadatos del proyecto, dependencias (`electron`, `mysql`, `xlsx`, `adm-zip`) y scripts de compilación (usando `electron-builder`).
*   **`init.sql` / `migracion_usuarios_roles.sql`**: Scripts SQL de inicialización o actualización de la estructura de la base de datos.
*   **Vistas (HTML)**:
    *   `login.html`, `index.html`, `dashboard.css`, `sidebar.html`.
    *   Módulos principales: `alumnos.html`, `empleados.html`.
    *   Configuración: `config_carreras.html`, `config_planteles.html`, `config_usuarios.html`, `mysql_setup.html`.
    *   Utilidades: `exportar.html`, `exportar_empleados.html`, `reportes.html`.
*   **Lógica de Vistas (Renderers)**: `renderer_login.js`, `renderer_empleados.js`, `renderer_exportar.js`, etc. (controlan la interacción en el DOM e invocan métodos de Electron).
*   **Directorios `fotos` / `fotos_empleados`**: Almacenan de manera local las fotografías que se asocian a cada estudiante o empleado.

## Base de Datos
Las tablas clave identificadas son:
*   `usuarios`: Acceso al sistema (roles: admin, capturista, consulta).
*   `alumnos`: Información de estudiantes (incluyendo la ruta de la fotografía).
*   `empleados`: Información del personal y trabajadores.
*   `planteles`: Catálogos de planteles/campus.
*   `carreras`: Catálogo de carreras disponibles.
*   `turno`: Catálogo de turnos.
*   `registros`: Tabla de auditoría para exportaciones de archivos.

## Funcionalidades Principales
1.  **Gestión de Usuarios y Base de Datos**: Interfaz para configurar la conexión MySQL inicial (`mysql_setup.html`) y crear un usuario administrador base si no existe.
2.  **CRUD de Alumnos y Empleados**: Crear, leer, actualizar y eliminar registros, además del procesamiento y almacenamiento local de fotografías (incluso recortes).
3.  **Catálogos (Configuración)**: Módulo de administración para planteles y carreras restringido a administradores.
4.  **Exportación masiva**: Funcionalidad para exportar registros seleccionados a un archivo `.zip` que contiene los metadatos en un Excel (`.xlsx`) y las imágenes correspondientes organizadas, registrando la acción en el historial (reportes).
