-- credenciales.sql
-- Crear base de datos credenciales, tabla usuarios, alumnos y planteles

CREATE DATABASE IF NOT EXISTS credenciales;
USE credenciales;

-- Tabla usuarios para login
CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(64) NOT NULL, -- SHA-256 hash
  nombre_completo VARCHAR(120) NOT NULL,
  rol ENUM('admin','capturista','consulta') NOT NULL DEFAULT 'consulta',
  plantel_id INT NULL,
  FOREIGN KEY (plantel_id) REFERENCES planteles(id)
);

-- Tabla planteles
CREATE TABLE IF NOT EXISTS planteles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  cct VARCHAR(20) NOT NULL UNIQUE,
  telefono VARCHAR(20)
);

-- Tabla carreras
CREATE TABLE IF NOT EXISTS carreras (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre_carrera VARCHAR(120) NOT NULL UNIQUE
);

-- Tabla turno
CREATE TABLE IF NOT EXISTS turno (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre_turno VARCHAR(30) NOT NULL UNIQUE
);

-- Tabla alumnos
CREATE TABLE IF NOT EXISTS alumnos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombres VARCHAR(100) NOT NULL,
  apellido_paterno VARCHAR(50) NOT NULL,
  apellido_materno VARCHAR(50) NOT NULL,
  carrera_id INT NOT NULL,
  turno VARCHAR(20) NOT NULL,
  plantel_id INT NOT NULL,
  curp VARCHAR(20) NOT NULL,
  no_control VARCHAR(20) NOT NULL,
  clave VARCHAR(20) NOT NULL,
  no_foto VARCHAR(20),
  foto VARCHAR(255),
  contacto_emergencia VARCHAR(100),
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  created_by VARCHAR(120) NULL,
  updated_by VARCHAR(120) NULL,
  FOREIGN KEY (carrera_id) REFERENCES carreras(id),
  FOREIGN KEY (plantel_id) REFERENCES planteles(id)
);

-- Tabla empleados
CREATE TABLE IF NOT EXISTS empleados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombres VARCHAR(100) NOT NULL,
  apellido_paterno VARCHAR(50) NOT NULL,
  apellido_materno VARCHAR(50) NOT NULL,
  puesto VARCHAR(100) NOT NULL,
  turno VARCHAR(20) NOT NULL,
  plantel_id INT NOT NULL,
  curp VARCHAR(20) NOT NULL,
  numero_empleado VARCHAR(30) NOT NULL,
  telefono VARCHAR(20) NOT NULL,
  foto VARCHAR(255),
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  created_by VARCHAR(120) NULL,
  updated_by VARCHAR(120) NULL,
  FOREIGN KEY (plantel_id) REFERENCES planteles(id)
);

-- Tabla registros de exportacion
CREATE TABLE IF NOT EXISTS registros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre_archivo VARCHAR(255) NOT NULL,
  cantidad_registros INT NOT NULL,
  tipo_exportacion ENUM('ALUMNOS','EMPLEADOS') NOT NULL,
  usuario_creador VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insertar usuario demo (admin/admin)
INSERT INTO usuarios (username, password, nombre_completo, rol, plantel_id)
VALUES ('admin', '8c6976e5b5410415bde908bd4dee15dfb16a7a60', 'Administrador General', 'admin', 1);

-- Insertar planteles demo
INSERT INTO planteles (nombre, cct, telefono) VALUES ('Plantel Central', 'CCT001', '5551000001');
INSERT INTO planteles (nombre, cct, telefono) VALUES ('Plantel Norte', 'CCT002', '5551000002');

-- Insertar carreras demo
INSERT INTO carreras (nombre_carrera) VALUES ('INGENIERIA EN SISTEMAS');
INSERT INTO carreras (nombre_carrera) VALUES ('ADMINISTRACION');

-- Insertar turnos demo
INSERT INTO turno (nombre_turno) VALUES ('MATUTINO');
INSERT INTO turno (nombre_turno) VALUES ('VESPERTINO');

-- Insertar alumno demo
INSERT INTO alumnos (nombres, apellido_paterno, apellido_materno, carrera_id, turno, plantel_id, curp, no_control, clave, no_foto, foto, contacto_emergencia)
VALUES ('Juan', 'Pérez', 'López', 1, 'MATUTINO', 1, 'CURP123456', 'NC001', 'CLAVE001', 'FOTO001', 'juan.jpg', '555-1234');

-- Insertar empleado demo
INSERT INTO empleados (nombres, apellido_paterno, apellido_materno, puesto, turno, plantel_id, curp, numero_empleado, telefono, foto)
VALUES ('Laura', 'Gomez', 'Ramirez', 'Coordinadora', 'MATUTINO', 1, 'CURPLEMPL001', 'EMP001', '5552000001', '');
