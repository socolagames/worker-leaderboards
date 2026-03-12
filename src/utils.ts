// ── Pure utility functions (exported for testing) ─────────────────────────────

// Returns the Unix timestamp (seconds) of the most recent Friday at 00:00:00 UTC.
// This is used as the weekly leaderboard reset boundary.
export function getCurrentWeekId(): number {
	const now = new Date();
	const daysSinceFriday = (now.getUTCDay() + 2) % 7; // Fri=0 Sat=1 Sun=2 … Thu=6
	const friday = new Date(now);
	friday.setUTCDate(now.getUTCDate() - daysSinceFriday);
	friday.setUTCHours(0, 0, 0, 0);
	return Math.floor(friday.getTime() / 1000);
}

// ── HMAC helpers (Web Crypto API) ─────────────────────────────────────────────

export async function hmacSign(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
	return btoa(String.fromCharCode(...new Uint8Array(sig)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');
}

export async function hmacVerify(secret: string, message: string, token: string): Promise<boolean> {
	return (await hmacSign(secret, message)) === token;
}
