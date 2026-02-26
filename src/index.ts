import { renderHtml } from "./renderHtml";

// TODO: will need logic to generate the correct Access-Control-Allow-Origin domain based on the incoming request. For now, just using words.socolagames.com.
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': 'https://words.socolagames.com',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// OPTIONS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		// GET /leaderboard
		if (request.method === 'GET' && url.pathname === '/leaderboard') {
			const gameId = url.searchParams.get('game');
			const { results } = await env.DB.prepare(
				`SELECT player_name, player_score, created_at
				FROM scores
				WHERE game_id = ?
				ORDER BY player_score DESC LIMIT 10`
			).bind(gameId).all();
			return Response.json(results, { headers: CORS_HEADERS });
		}

		// POST /score { game_id, player_name, player_id, score, game_hash }
		if (request.method === 'POST' && url.pathname === '/score') {
			const { game_id, player_name, player_id, player_score, game_hash } = await request.json();

			const game = await env.DB.prepare(
				`SELECT game_id FROM games WHERE game_id = ?`
			).bind(game_id).first();

			if (!game) return new Response('Not found', { status: 404, headers: CORS_HEADERS });

			const timestamp = new Date().toISOString();
		await env.DB.prepare(
				`INSERT INTO scores (game_id, player_name, player_id, player_score, game_hash, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`
			).bind(game_id, player_name, player_id, player_score, game_hash, timestamp).run();
			return Response.json({ ok: true }, { headers: CORS_HEADERS });
		}

		return new Response('Not found', { status: 404, headers: CORS_HEADERS });
	},
} satisfies ExportedHandler<Env>;
