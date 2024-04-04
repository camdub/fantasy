import { internalMutation } from './_generated/server'
import { v } from 'convex/values'

export let createFixture = internalMutation({
	args: {
		fixture: v.any(),
	},
	handler: async (ctx, { fixture }) => {
		await ctx.db.insert('fixture', {
			gameId: fixture.GameId,
			week: fixture.Week,
			status: fixture.Status,
			date: fixture.DateTime,
			homeTeam: fixture.HomeTeamKey,
			awayTeam: fixture.AwayTeamKey,
		})
	},
})
