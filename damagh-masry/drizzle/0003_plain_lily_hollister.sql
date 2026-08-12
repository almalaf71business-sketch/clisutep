CREATE TABLE `youtube_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`channelId` varchar(128) NOT NULL,
	`channelTitle` varchar(255) NOT NULL,
	`refreshToken` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `youtube_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `youtube_connections_userId_unique` UNIQUE(`userId`)
);
