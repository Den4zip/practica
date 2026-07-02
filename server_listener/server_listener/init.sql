CREATE DATABASE IF NOT EXISTS `ErrorLogsDB`;

USE `ErrorLogsDB`;

CREATE TABLE IF NOT EXISTS `WindowsErrors` (
  `Id` INT AUTO_INCREMENT PRIMARY KEY,
  `EventID` INT,
  `MachineName` VARCHAR(255),
  `Source` VARCHAR(255),
  `LevelDisplayName` VARCHAR(100),
  `LogName` VARCHAR(100),
  `TimeCreated` DATETIME,
  `Message` TEXT
);
