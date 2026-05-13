import express from "express";
import cors from "cors";
import "dotenv/config";

import { z } from "zod";
import { chromium } from "playwright";

const app = express();

// ----- middleware base -----
app.use(express.json({ limit: "2mb" }));

// CORS (MVP)
// Nota: como vais chamar isto a partir do Retool (server-side proxy),
// CORS normalmente não é um problema. Mas deixamos aberto para testes.
app.use(cors({ origin: "*" }));

// ----- health check -----
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "betedge-backend" });
});

// ------------------------------------------------------------
//  POST /v1/flashscore/detect
//  Recebe: { urls: [ ... ] }
//  Devolve: jogos detetados (MVP via page.title + mid=)
// ------------------------------------------------------------
const DetectBodySchema = z.object({
  urls: z.array(z.string().url()).min(1),
});

function extractMid(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get("mid");
  } catch {
    return null;
  }
}

app.post("/v1/flashscore/detect", async (req, res) => {
  const parsed = DetectBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid body",
      details: parsed.error.issues,
    });
  }

  const { urls } = parsed.data;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const games = [];
  const warnings = [];

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

      const title = await page.title();
      const mid = extractMid(url);

      // MVP parse: tenta "Home - Away"
      let homeTeam = null;
      let awayTeam = null;

      // Alguns títulos vêm como "Getafe - Mallorca | ..."
      // Vamos só pegar na parte antes do "|"
      const titleLeft = title.split("|")[0].trim();

      // separador mais comum
      const parts = titleLeft.split(" - ").map((s) => s.trim());
      if (parts.length >= 2) {
        homeTeam = parts[0];
        awayTeam = parts[1];
      }

      games.push({
        id: mid ? `flashscore:${mid}` : `flashscore_url:${url}`,
        flashscoreUrl: url,
        competition: null,
        competitionId: null,
        kickoff: null,
        homeTeam,
        awayTeam,
        debug: { pageTitle: title },
      });
    } catch (e) {
      warnings.push(`Failed to parse ${url}: ${e?.message || String(e)}`);
      games.push({
        id: `flashscore_url:${url}`,
        flashscoreUrl: url,
        competition: null,
        competitionId: null,
        kickoff: null,
        homeTeam: null,
        awayTeam: null,
        error: "parse_failed",
      });
    }
  }

  await page.close();
  await browser.close();

  res.json({ games, warnings });
});

// ------------------------------------------------------------
// POST /v1/model/analyze  (MOCK)
// Recebe lista de jogos + settings e devolve recomendações (1 por jogo)
// ------------------------------------------------------------
const AnalyzeSchema = z.object({
  games: z
    .array(
      z.object({
        gameId: z.string(),
        homeTeam: z.string().optional(),
        awayTeam: z.string().optional(),
        competitionId: z.string().optional(),
        kickoff: z.string().optional(),
        odds: z.any().optional(), // por agora aceitamos qualquer coisa
      })
    )
    .min(1),
  settings: z
    .object({
      bankroll: z.number().default(2000),
      dailyRiskLimit: z.number().default(100),
      riskProfile: z
        .enum(["conservative", "balanced", "aggressive"])
        .default("balanced"),
      minEdge: z.number().default(0.01),
      maxStakePerBet: z.number().default(40),
    })
    .optional(),
});

app.post("/v1/model/analyze", async (req, res) => {
  const parsed = AnalyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid body",
      details: parsed.error.issues,
    });
  }

  const { games } = parsed.data;
  const settings = parsed.data.settings || {
    bankroll: 2000,
    dailyRiskLimit: 100,
    riskProfile: "balanced",
    minEdge: 0.01,
    maxStakePerBet: 40,
  };

  // MOCK: 1 recomendação por jogo
  const recommendations = games.map((g, idx) => {
    const matchLabel = `${g.homeTeam || "Home"} vs ${g.awayTeam || "Away"}`;

    // stake simples só para testes de UI e daily limit
    const stake = Math.min(settings.maxStakePerBet, idx === 0 ? 25 : 10);

    return {
      gameId: g.gameId,
      matchLabel,
      competitionId: g.competitionId || null,
      kickoff: g.kickoff || null,
      market: "1X2",
      selection: "1",
      odds: 2.0,
      modelProb: 0.52,
      impliedProb: 0.5,
      edge: 0.02,
      stake,
      notes: "Mock analysis. Next step: Dixon-Coles + xG + market pricing.",
    };
  });

  const dailyStakeTotal = recommendations.reduce(
    (sum, r) => sum + (Number(r.stake) || 0),
    0
  );

  res.json({
    recommendations,
    summary: {
      numGames: games.length,
      numRecommendations: recommendations.length,
      dailyStakeTotal,
      dailyRiskLimit: settings.dailyRiskLimit,
      riskProfile: settings.riskProfile,
    },
    warnings: [],
  });
});

// ----- start server -----
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
