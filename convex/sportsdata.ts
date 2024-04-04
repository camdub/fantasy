import {
	internalAction,
	query,
	internalMutation,
	internalQuery,
} from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";

const SPORTSDATA_KEY = process.env.SPORTSDATA_KEY;

const urls = {
	seasons: (competition: string) =>
		`https://api.sportsdata.io/v4/soccer/scores/json/CompetitionDetails/${competition}?key=${SPORTSDATA_KEY}`,
	scheduleByDate: (date, competition) =>
		`https://api.sportsdata.io/v4/soccer/scores/json/GamesByDate/${competition}/${date}?key=$#{SPORTSDATA_KEY}`,
};

/**
 * All the API keys from sportsdata are in PascalCase, but we want to use camelCase
 */
function convertPascalToCamel(str: string) {
	return str.charAt(0).toLowerCase() + str.slice(1);
}

// --------------------------------------------------------
// ACTIONS
// --------------------------------------------------------

export let syncCurrentSeason = internalAction({
	args: { competition: v.literal("mls") },
	handler: async (ctx, { competition }) => {
		console.log(`Syncing data for current ${competition} regular season...`);

		let [{ _id }, data] = await Promise.all([
			ctx.runQuery(api.sportsdata.getCurrentSeason, {
				competition,
			}),
			fetch(urls.seasons(competition)).then((res) => res.json()),
		]);

		let seasonId = _id;
		let seasonName = `${data.CurrentSeason.CompetitionName} ${data.CurrentSeason.Name}`;

		/**
		 * Each Season has a list of Rounds that includes all types of competitions (e.g. Regular Season, Playoffs, etc.)
		 * Just sync "regular saeason", denoted by the type "Table" in a Round object
		 * https://sportsdata.io/developers/data-dictionary/soccer
		 **/
		let table = data.CurrentSeason.Rounds.find(
			// biome-ignore lint/suspicious/noExplicitAny: any b/c sportsdata.io response is huge and not typed
			(round: any) => round.Type.toLowerCase() === "table",
		);
		if (!table) {
			return `No current season data could be found for ${seasonName}`;
		}

		if (!seasonId) {
			console.log(`No current season found for ${seasonName}`);
			console.log(`Creating new season for ${seasonName}...`);
			seasonId = await ctx.runMutation(internal.sportsdata.createSeason, {
				startDate: table.StartDate,
				endDate: table.EndDate,
				seasonId: table.SeasonId,
				currentWeek: table.CurrentWeek,
				current: true,
				name: competition,
				season: table.Season.toString(),
			});
		}

		console.log(`Updating fixtures for ${seasonName}...`);
		let gamesByGameId = ctx.runQuery(internal.sportsdata.getGamesByGameId, {
			seasonId,
		});

		for (let game of table.Games) {
			// API has PascalCase keys, so convert to camelCase
			let transformedKeys = Object.keys(game).map((key) => [
				convertPascalToCamel(key),
				game[key],
			]);
			let gameData = Object.fromEntries(transformedKeys);
			gameData.seasonId = seasonId; // add convex season id to game data likely want to try and rely on convex not the API ids

			try {
				await ctx.runMutation(internal.sportsdata.patchFixture, {
					gameData,
					fixtureId: gamesByGameId[game.GameId]?._id,
				});
			} catch (error) {
				console.error(
					`Unable to update or create fixture for game ${game.GameId}:`,
					error,
				);
			}
		}
	},
});

export let syncMatchWeek = internalAction({
	args: { seasonId: v.id("season"), week: v.number() },
	handler: async (ctx, { seasonId, week }) => {
		let fixtures = await ctx.runQuery(api.sportsdata.getFixturesByMatchWeek, {
			seasonId,
			week,
		});
		fixtures = fixtures.sort((a, b) => a.gameId - b.gameId);

		// get unique dates for fixtures
		let dates = Array.from(new Set(fixtures.map((f) => f.day)));
		console.log("dates", dates);
		let matchWeek = await Promise.all(
			dates.map((date) =>
				fetch(urls.scheduleByDate((date as string).split("T")[0], "mls")).then(
					(res) => res.json(),
				),
			),
		);
		let apiFixtures = matchWeek
			.reduce((acc, res) => acc.concat(res), [])
			.sort((a, b) => a.gameId - b.gameId);
		if (apiFixtures.length !== fixtures.length) {
			console.warn("Mismatch between fixtures in convex and sportsdata.io");
		}

		console.log(
			"ids",
			fixtures.map((f) => f.gameId),
			apiFixtures.map((f) => f.gameId),
		);

		// technically the gameIds should match 1:1
		for (let i = 0; i < fixtures.length; i++) {
			let fixture = fixtures[i];
			let apiFixture = apiFixtures[i];

			// API has PascalCase keys, so convert to camelCase
			let transformedKeys = Object.keys(apiFixture).map((key) => [
				convertPascalToCamel(key),
				apiFixture[key],
			]);
			let gameData = Object.fromEntries(transformedKeys);
			gameData.seasonId = seasonId; // add convex season id to game data likely want to try and rely on convex not the API ids

			try {
				await ctx.runMutation(internal.sportsdata.patchFixture, {
					gameData,
					fixtureId: fixture._id,
				});
			} catch (error) {
				console.error(
					`Unable to update or create fixture for game ${apiFixture.GameId}:`,
					error,
				);
			}
		}
	},
});

// --------------------------------------------------------
// MUTATIONS
// --------------------------------------------------------

export let patchFixture = internalMutation({
	args: { gameData: v.any(), fixtureId: v.optional(v.id("fixture")) },
	handler: async (ctx, { gameData, fixtureId }) => {
		return fixtureId
			? ctx.db.patch(fixtureId, gameData)
			: ctx.db.insert("fixture", gameData);
	},
});

export let createSeason = internalMutation({
	args: {
		startDate: v.string(),
		endDate: v.string(),
		seasonId: v.number(),
		currentWeek: v.number(),
		current: v.boolean(),
		name: v.string(),
		season: v.string(),
	},
	handler: async (ctx, season) => {
		return await ctx.db.insert("season", season);
	},
});

// --------------------------------------------------------
// QUERIES
// --------------------------------------------------------

export let getGamesByGameId = internalQuery({
	args: { seasonId: v.id("season") },
	handler: async (ctx, { seasonId }) => {
		let games = await ctx.db
			.query("fixture")
			.filter((q) => q.eq(q.field("seasonId"), seasonId))
			.collect();

		// "group" games by sportsdata.io gameId
		let gamesByGameId = Object.fromEntries(
			games.map((game) => [game.gameId, game]),
		);

		return gamesByGameId;
	},
});

export let getCurrentSeason = query({
	args: { competition: v.literal("mls") },
	handler: async (ctx, { competition }) => {
		return await ctx.db
			.query("season")
			.filter((q) =>
				q.and(
					q.eq(q.field("name"), competition),
					q.eq(q.field("current"), true),
				),
			)
			.first();
	},
});

export let getFixturesByMatchWeek = query({
	args: { seasonId: v.id("season"), week: v.number() },
	handler: async (ctx, { seasonId, week }) => {
		return await ctx.db
			.query("fixture")
			.filter((q) =>
				q.and(q.eq(q.field("seasonId"), seasonId), q.eq(q.field("week"), week)),
			)
			.collect();
	},
});
