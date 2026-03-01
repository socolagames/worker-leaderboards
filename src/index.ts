// ── CORS ──────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': 'https://words.socolagames.com',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

// ── HMAC helpers (Web Crypto API) ─────────────────────────────────────────────
async function hmacSign(secret: string, message: string): Promise<string> {
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

async function hmacVerify(secret: string, message: string, token: string): Promise<boolean> {
	return (await hmacSign(secret, message)) === token;
}

// ── Turnstile verification ────────────────────────────────────────────────────
async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
	const fd = new FormData();
	fd.append('secret', secret);
	fd.append('response', token);
	fd.append('remoteip', ip);
	const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
		method: 'POST',
		body: fd,
	});
	return ((await res.json()) as { success: boolean }).success;
}

// ── Worker ────────────────────────────────────────────────────────────────────
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// OPTIONS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		// GET /leaderboard?game=<game_id>
		if (request.method === 'GET' && url.pathname === '/leaderboard') {
			const gameId = url.searchParams.get('game');
			const { results } = await env.DB.prepare(
				`SELECT player_name, player_score, created_at
				FROM scores
				WHERE game_id = ?
				ORDER BY player_score DESC LIMIT 10`,
			)
				.bind(gameId)
				.all();
			return Response.json(results, { headers: CORS_HEADERS });
		}

		// GET /session?game_id=<id>&player_id=<id>
		// Issues a short-lived HMAC token proving this session was legitimately started.
		if (request.method === 'GET' && url.pathname === '/session') {
			const game_id = url.searchParams.get('game_id');
			const player_id = url.searchParams.get('player_id');
			if (!game_id || !player_id) {
				return new Response('Bad Request', { status: 400, headers: CORS_HEADERS });
			}
			const tw = Math.floor(Date.now() / 180000); // 180-second windows
			
			const token = await hmacSign(env.SESSION_HMAC_SECRET, `${game_id}:${player_id}:${tw}`);
			return Response.json({ token }, { headers: CORS_HEADERS });
		}

		// POST /score { game_id, player_name, player_id, player_score, session_token, turnstile_token }
		if (request.method === 'POST' && url.pathname === '/score') {
			const body = await request.json() as {
				game_id: unknown;
				player_name: unknown;
				player_id: unknown;
				player_score: unknown;
				session_token: unknown;
				turnstile_token: unknown;
			};
			const { game_id, player_name, player_id, player_score, session_token, turnstile_token } = body;

			// 1. Basic type / bounds validation
			if (
				typeof game_id !== 'number' ||
				typeof player_name !== 'string' || !player_name.trim() ||
				typeof player_id !== 'string' || !player_id.trim() ||
				typeof player_score !== 'number' || player_score < 0 || player_score > 1000 ||
				typeof session_token !== 'string' ||
				typeof turnstile_token !== 'string'
			) {
				return new Response('Bad Request', { status: 400, headers: CORS_HEADERS });
			}

			// 2. Session token — accept current and previous 180-second window
			const tw = Math.floor(Date.now() / 180000);
			const sessionValid =
				await hmacVerify(env.SESSION_HMAC_SECRET, `${game_id}:${player_id}:${tw}`, session_token) ||
				await hmacVerify(env.SESSION_HMAC_SECRET, `${game_id}:${player_id}:${tw - 1}`, session_token);
			if (!sessionValid) {
				return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
			}

			// 3. Turnstile — proves a real browser submitted this
			const ip = request.headers.get('CF-Connecting-IP') ?? '';
			const turnstileValid = await verifyTurnstile(env.TURNSTILE_SECRET, turnstile_token, ip);
			if (!turnstileValid) {
				return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
			}

			// 4. Confirm game exists
			const game = await env.DB.prepare(`SELECT game_id FROM games WHERE game_id = ?`)
				.bind(game_id)
				.first();
			if (!game) {
				return new Response('Not found', { status: 404, headers: CORS_HEADERS });
			}

			// 5. Insert score
			const timestamp = new Date().toISOString();
			await env.DB.prepare(
				`INSERT INTO scores (game_id, player_name, player_id, player_score, created_at)
				VALUES (?, ?, ?, ?, ?)`,
			)
				.bind(game_id, player_name.trim(), player_id.trim(), player_score, timestamp)
				.run();

			return Response.json({ ok: true }, { headers: CORS_HEADERS });
		}

		return new Response('Not found', { status: 404, headers: CORS_HEADERS });
	},
} satisfies ExportedHandler<Env>;
