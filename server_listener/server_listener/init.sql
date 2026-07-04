CREATE DATABASE IF NOT EXISTS `ErrorLogsDB`;

USE `ErrorLogsDB`;

-- Удаляем старую таблицу, если она существует, для чистого создания новой
DROP TABLE IF EXISTS `WindowsErrors`;
DROP TABLE IF EXISTS `SystemLogs`;

-- Новая, более универсальная таблица для всех типов системных логов
CREATE TABLE IF NOT EXISTS `SystemLogs` (
  `Id` INT AUTO_INCREMENT PRIMARY KEY,
  `MachineName` VARCHAR(255) NOT NULL,
  `EventType` VARCHAR(50) NOT NULL, -- 'WindowsError', 'Metric', 'Security', 'Service'
  `Source` VARCHAR(255),
  `LevelDisplayName` VARCHAR(100),
  `LogName` VARCHAR(100),
  `EventID` INT,
  `TimeCreated` DATETIME NOT NULL,
  `Message` TEXT NOT NULL
);
