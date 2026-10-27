DELETE FROM `payment`
WHERE `id` IN (
	SELECT `id`
	FROM (
		SELECT
			`id`,
			ROW_NUMBER() OVER (
				PARTITION BY `invoice_id`
				ORDER BY
					`paid` DESC,
					`updated_at` DESC,
					`created_at` DESC,
					`id` DESC
			) AS `duplicate_rank`
		FROM `payment`
		WHERE `invoice_id` IS NOT NULL
	)
	WHERE `duplicate_rank` > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `payment_invoice_id_unique` ON `payment` (`invoice_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `payment_user_id_idx` ON `payment` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `payment_customer_id_idx` ON `payment` (`customer_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `payment_subscription_id_idx` ON `payment` (`subscription_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `payment_session_id_idx` ON `payment` (`session_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `payment_invoice_id_idx` ON `payment` (`invoice_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `payment_paid_idx` ON `payment` (`paid`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `payment_user_paid_idx` ON `payment` (`user_id`,`paid`);
