import { renderHtml } from "./renderHtml";

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// GET /leaderboard
		if (request.method === 'GET' && url.pathname === '/leaderboard') {
			const gameId = url.searchParams.get('game');
			const { results } = await env.DB.prepare(
				`SELECT player_name, player_score, created_at
				FROM scores
				WHERE game_id = ?
				ORDER BY score DESC LIMIT 10`
			).bind(gameId).all();
			return Response.json(results);
		}


		// POST /score { game_id, player_name, player_id, score, game_hash }
		if (request.method === 'POST' && url.pathname === '/score') {
			const { game_id, player_name, player_id, player_score, game_hash } = await request.json();

			const game = await env.DB.prepare(
				`SELECT id FROM games WHERE id = ?`
			).bind(game_id).first();

			if (!game) return new Response('Not found', { status: 404 });

			await env.DB.prepare(
				`INSERT INTO scores (game_id, player_name, player_id, player_score, game_hash)
				VALUES (?, ?. ?, ?, ?)`
			).bind(game_id, player_name, player_id, player_score, game_hash).run();
			return Response.json({ ok: true });
		}

		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
