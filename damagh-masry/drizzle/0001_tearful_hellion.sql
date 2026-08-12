CREATE TABLE `video_contents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`idea` text NOT NULL,
	`title` varchar(255) NOT NULL,
	`category` enum('technology','ai','useful_info') NOT NULL,
	`status` enum('idea','draft','review','ready','published') NOT NULL DEFAULT 'idea',
	`script` text,
	`description` text,
	`keywords` text,
	`scheduledAt` timestamp,
	`publishSlot` varchar(80),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_contents_id` PRIMARY KEY(`id`)
);
